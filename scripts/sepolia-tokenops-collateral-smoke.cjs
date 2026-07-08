const fs = require("node:fs");
const hre = require("hardhat");
const { ethers: rpcEthers } = require("ethers");
const { createPublicClient, createWalletClient, getAddress, http, isAddress, parseEventLogs } = require("viem");
const { mnemonicToAccount, privateKeyToAccount } = require("viem/accounts");
const { sepolia } = require("viem/chains");
const {
  confidentialVestingManagerAbi,
  createConfidentialVestingManagerClient,
  erc7984OperatorAbi,
} = require("@tokenops/sdk/fhe-vesting");
const { createTestnetFaucetClient, requireConfidentialTestTokenAddress } = require("@tokenops/sdk/testnet-faucet");

const DEFAULT_MINT_AMOUNT = 2_000_000n; // 2 CTTT, 6 decimals.
const DEFAULT_VESTING_AMOUNT = 1_000_000n; // 1 CTTT, 6 decimals.
const TRANSFER_WINDOW_SECONDS = 86_400;
const FAR_FUTURE_OPERATOR_DEADLINE = 2_000_000_000;

async function main() {
  if (hre.network.name !== "sepolia") {
    throw new Error("Run this script with --network sepolia.");
  }

  const rpcUrl = resolveRpcUrl();
  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  const account = resolveAccount();
  const recipientAddress = resolveRecipientAddress();
  const walletClient = createWalletClient({ account, chain: sepolia, transport: http(rpcUrl) });
  const ethersSigner = resolveEthersSigner(new rpcEthers.JsonRpcProvider(rpcUrl, sepolia.id));
  if (ethersSigner.address.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(`Hardhat signer ${ethersSigner.address} does not match viem signer ${account.address}.`);
  }

  const chainId = await publicClient.getChainId();
  const manifest = readManifest();
  const collateralToken =
    envAddress("CVC_COLLATERAL_TOKEN_ADDRESS") ??
    manifestAddress(manifest, "assets.collateralToken") ??
    requireConfidentialTestTokenAddress(chainId);
  const managerAddress =
    envAddress("CVC_TOKENOPS_MANAGER_ADDRESS") ??
    manifestAddress(manifest, "assets.tokenOpsManager") ??
    readTokenOpsManagerRecord()?.manager;
  if (!managerAddress) {
    throw new Error("CVC_TOKENOPS_MANAGER_ADDRESS or manifest assets.tokenOpsManager is required.");
  }
  const adapterAddress =
    envAddress("CVC_TOKENOPS_ADAPTER_ADDRESS") ??
    manifestAddress(manifest, "contracts.TokenOpsVestingAdapter.address") ??
    (await hre.deployments.get("TokenOpsVestingAdapter")).address;

  const mintAmount = envBigInt("CVC_TOKENOPS_SMOKE_MINT_AMOUNT", DEFAULT_MINT_AMOUNT);
  const vestingAmount = envBigInt("CVC_TOKENOPS_SMOKE_VESTING_AMOUNT", DEFAULT_VESTING_AMOUNT);
  if (vestingAmount > mintAmount) {
    throw new Error("CVC_TOKENOPS_SMOKE_VESTING_AMOUNT cannot exceed CVC_TOKENOPS_SMOKE_MINT_AMOUNT.");
  }

  const faucet = createTestnetFaucetClient({
    publicClient,
    walletClient,
    address: collateralToken,
    chainId,
  });
  const manager = createConfidentialVestingManagerClient({
    publicClient,
    walletClient,
    address: managerAddress,
    chainId,
    encryptor: await relayerEncryptor(rpcUrl),
  });
  const adapter = new rpcEthers.Contract(
    adapterAddress,
    (await hre.artifacts.readArtifact("TokenOpsVestingAdapter")).abi,
    ethersSigner,
  );

  const gas = [];
  console.log("TokenOps collateral Sepolia smoke");
  console.log(`signerIndex=${signerIndex()}`);
  console.log(`deployer=${account.address}`);
  console.log(`recipient=${recipientAddress}`);
  console.log(`collateralToken=${collateralToken}`);
  console.log(`tokenOpsManager=${managerAddress}`);
  console.log(`vestingAdapter=${adapterAddress}`);

  const faucetResult = await faucet.mintConfidential({ amount: mintAmount, to: account.address });
  gas.push(await gasLine(publicClient, "mintConfidential", faucetResult.hash));
  console.log(`mintConfidentialTx=${faucetResult.hash}`);

  const operator = await publicClient.readContract({
    address: collateralToken,
    abi: erc7984OperatorAbi,
    functionName: "isOperator",
    args: [account.address, managerAddress],
  });
  if (!operator) {
    const operatorHash = await walletClient.writeContract({
      address: collateralToken,
      abi: erc7984OperatorAbi,
      functionName: "setOperator",
      args: [managerAddress, FAR_FUTURE_OPERATOR_DEADLINE],
      account,
    });
    gas.push(await gasLine(publicClient, "setOperator", operatorHash));
    console.log(`setOperatorTx=${operatorHash}`);
  } else {
    console.log("setOperatorTx=reused");
  }

  const vestingId = await createOrReuseVesting({
    publicClient,
    manager,
    managerAddress,
    account,
    recipientAddress,
    vestingAmount,
    gas,
  });

  await requireRecipient(manager, vestingId, recipientAddress, "after createVesting");
  if (process.env.CVC_TOKENOPS_SMOKE_CREATE_ONLY === "true") {
    console.log(`vestingId=${vestingId}`);
    console.log("gasSummary=");
    console.log(JSON.stringify(gas, null, 2));
    return;
  }
  if (recipientAddress.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error("A non-signer vesting recipient is supported only with CVC_TOKENOPS_SMOKE_CREATE_ONLY=true.");
  }
  await cancelPendingTransferIfNeeded({
    publicClient,
    walletClient,
    managerAddress,
    vestingId,
    account,
    gas,
  });

  const initiateToAdapterHash = await manager.initiateVestingTransfer({
    vestingId,
    newRecipient: adapterAddress,
    transferDurationSeconds: TRANSFER_WINDOW_SECONDS,
    account,
  });
  gas.push(await gasLine(publicClient, "initiateTransferToAdapter", initiateToAdapterHash));
  console.log(`initiateTransferToAdapterTx=${initiateToAdapterHash}`);

  const acceptCustodyTx = await adapter.acceptPendingVestingTransfer(managerAddress, vestingId, account.address);
  const acceptCustodyReceipt = await acceptCustodyTx.wait(1);
  gas.push({
    action: "adapterAcceptPendingTransfer",
    hash: acceptCustodyTx.hash,
    gasUsed: acceptCustodyReceipt?.gasUsed.toString(),
  });
  console.log(`adapterAcceptPendingTransferTx=${acceptCustodyTx.hash}`);
  await requireRecipient(manager, vestingId, adapterAddress, "after adapter custody acceptance");

  if (process.env.CVC_TOKENOPS_SMOKE_RECOVERY_ONLY === "true") {
    const recoverTx = await adapter.recoverUnpledgedVesting(managerAddress, vestingId);
    const recoverReceipt = await recoverTx.wait(1);
    gas.push({
      action: "recoverUnpledgedVesting",
      hash: recoverTx.hash,
      gasUsed: recoverReceipt?.gasUsed.toString(),
    });
    console.log(`recoverUnpledgedVestingTx=${recoverTx.hash}`);

    const acceptRecoveryHash = await manager.acceptVestingTransfer(vestingId, account);
    gas.push(await gasLine(publicClient, "acceptRecoveryTransfer", acceptRecoveryHash));
    console.log(`acceptRecoveryTransferTx=${acceptRecoveryHash}`);

    const completeRecoveryTx = await adapter.completeUnpledgedVestingRecovery(managerAddress, vestingId);
    const completeRecoveryReceipt = await completeRecoveryTx.wait(1);
    gas.push({
      action: "completeUnpledgedVestingRecovery",
      hash: completeRecoveryTx.hash,
      gasUsed: completeRecoveryReceipt?.gasUsed.toString(),
    });
    console.log(`completeUnpledgedVestingRecoveryTx=${completeRecoveryTx.hash}`);

    await requireRecipient(manager, vestingId, account.address, "after unpledged recovery");
    console.log("gasSummary=");
    console.log(JSON.stringify(gas, null, 2));
    return;
  }

  const pledgeId = await adapter.registerPledge.staticCall(managerAddress, vestingId, account.address);
  const registerPledgeTx = await adapter.registerPledge(managerAddress, vestingId, account.address);
  const registerPledgeReceipt = await registerPledgeTx.wait(1);
  gas.push({
    action: "registerPledge",
    hash: registerPledgeTx.hash,
    gasUsed: registerPledgeReceipt?.gasUsed.toString(),
  });
  console.log(`registerPledgeTx=${registerPledgeTx.hash}`);
  console.log(`pledgeId=${pledgeId}`);

  const releaseTx = await adapter.releasePledge(pledgeId, account.address);
  const releaseReceipt = await releaseTx.wait(1);
  gas.push({ action: "releasePledge", hash: releaseTx.hash, gasUsed: releaseReceipt?.gasUsed.toString() });
  console.log(`releasePledgeTx=${releaseTx.hash}`);

  const acceptReleaseHash = await manager.acceptVestingTransfer(vestingId, account);
  gas.push(await gasLine(publicClient, "acceptReleaseTransfer", acceptReleaseHash));
  console.log(`acceptReleaseTransferTx=${acceptReleaseHash}`);

  const completeTx = await adapter.completeRelease(pledgeId);
  const completeReceipt = await completeTx.wait(1);
  gas.push({ action: "completeRelease", hash: completeTx.hash, gasUsed: completeReceipt?.gasUsed.toString() });
  console.log(`completeReleaseTx=${completeTx.hash}`);

  await requireRecipient(manager, vestingId, account.address, "after release completion");
  const pledge = await adapter.getPledge(pledgeId);
  console.log(`finalPledgeStatus=${pledge.status.toString()}`);
  console.log("gasSummary=");
  console.log(JSON.stringify(gas, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function resolveRpcUrl() {
  const url = process.env.SEPOLIA_RPC_URL ?? hre.network.config.url;
  if (!url) throw new Error("SEPOLIA_RPC_URL or hardhat sepolia network URL is required.");
  return url;
}

function resolveAccount() {
  if (process.env.PRIVATE_KEY) return privateKeyToAccount(process.env.PRIVATE_KEY);
  const accounts = hre.network.config.accounts;
  const configuredMnemonic =
    typeof accounts === "object" && !Array.isArray(accounts) && "mnemonic" in accounts ? accounts.mnemonic : undefined;
  const mnemonic = process.env.MNEMONIC ?? configuredMnemonic;
  if (!mnemonic) throw new Error("PRIVATE_KEY or mnemonic-backed hardhat account config is required.");
  return mnemonicToAccount(mnemonic, { path: `m/44'/60'/0'/0/${signerIndex()}` });
}

function resolveRecipientAddress() {
  if (process.env.CVC_VESTING_RECIPIENT) {
    if (!isAddress(process.env.CVC_VESTING_RECIPIENT)) {
      throw new Error(`CVC_VESTING_RECIPIENT is not a valid address: ${process.env.CVC_VESTING_RECIPIENT}`);
    }
    return getAddress(process.env.CVC_VESTING_RECIPIENT);
  }
  const recipientIndex = process.env.CVC_VESTING_RECIPIENT_INDEX;
  if (recipientIndex === undefined) return resolveAccount().address;

  const accounts = hre.network.config.accounts;
  const configuredMnemonic =
    typeof accounts === "object" && !Array.isArray(accounts) && "mnemonic" in accounts ? accounts.mnemonic : undefined;
  const mnemonic = process.env.MNEMONIC ?? configuredMnemonic;
  if (!mnemonic) throw new Error("Mnemonic-backed hardhat account config is required for CVC_VESTING_RECIPIENT_INDEX.");
  return getAddress(mnemonicToAccount(mnemonic, { path: `m/44'/60'/0'/0/${nonNegativeIndex("CVC_VESTING_RECIPIENT_INDEX")}` }).address);
}

function resolveEthersSigner(provider) {
  if (process.env.PRIVATE_KEY) return new rpcEthers.Wallet(process.env.PRIVATE_KEY, provider);
  const accounts = hre.network.config.accounts;
  if (Array.isArray(accounts) && typeof accounts[0] === "string") {
    return new rpcEthers.Wallet(accounts[0], provider);
  }
  const configuredMnemonic =
    typeof accounts === "object" && !Array.isArray(accounts) && "mnemonic" in accounts ? accounts.mnemonic : undefined;
  const mnemonic = process.env.MNEMONIC ?? configuredMnemonic;
  if (!mnemonic) throw new Error("PRIVATE_KEY or mnemonic-backed hardhat account config is required.");
  return rpcEthers.HDNodeWallet.fromPhrase(mnemonic, undefined, `m/44'/60'/0'/0/${signerIndex()}`).connect(provider);
}

function signerIndex() {
  return nonNegativeIndex("CVC_SIGNER_INDEX", 0);
}

function nonNegativeIndex(name, fallback) {
  const raw = process.env[name] ?? String(fallback);
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer, got ${raw}.`);
  }
  return parsed;
}

function envAddress(name) {
  const value = process.env[name];
  if (!value) return null;
  if (!isAddress(value)) throw new Error(`${name} is not a valid address: ${value}`);
  return getAddress(value);
}

function envBigInt(name, fallback) {
  const value = process.env[name];
  return value ? BigInt(value) : fallback;
}

function readManifest() {
  try {
    return JSON.parse(fs.readFileSync("public/deployment-manifest.json", "utf8"));
  } catch {
    return null;
  }
}

function readTokenOpsManagerRecord() {
  try {
    return JSON.parse(fs.readFileSync("deployments/sepolia/TokenOpsManager.cvc.json", "utf8"));
  } catch {
    return null;
  }
}

function manifestAddress(manifest, path) {
  const value = path.split(".").reduce((cursor, key) => cursor?.[key], manifest);
  return value && isAddress(value) ? getAddress(value) : null;
}

async function relayerEncryptor(rpcUrl) {
  const sdk = await import("@zama-fhe/relayer-sdk/node");
  const relayer = await sdk.createInstance({ ...sdk.SepoliaConfig, network: rpcUrl });
  return {
    async encrypt({ values, contractAddress, userAddress }) {
      const input = relayer.createEncryptedInput(getAddress(contractAddress), getAddress(userAddress));
      for (const item of values) {
        if (item.type !== "euint64") {
          throw new Error(`Unsupported TokenOps smoke encryption type: ${item.type}`);
        }
        input.add64(item.value);
      }
      const encrypted = await input.encrypt();
      return {
        handles: encrypted.handles,
        inputProof: encrypted.inputProof,
      };
    },
  };
}

async function createOrReuseVesting({
  publicClient,
  manager,
  managerAddress,
  account,
  recipientAddress,
  vestingAmount,
  gas,
}) {
  const explicitVestingId = envBytes32("CVC_TOKENOPS_SMOKE_VESTING_ID");
  if (explicitVestingId) {
    console.log("createVestingTx=reused");
    console.log(`vestingId=${explicitVestingId}`);
    return explicitVestingId;
  }

  if (process.env.CVC_TOKENOPS_SMOKE_REUSE_EXISTING !== "false") {
    const existingIds = await publicClient.readContract({
      address: managerAddress,
      abi: confidentialVestingManagerAbi,
      functionName: "getAllRecipientVestings",
      args: [recipientAddress],
    });
    if (existingIds.length > 0) {
      const existingVestingId = existingIds[0];
      console.log("createVestingTx=reused");
      console.log(`vestingId=${existingVestingId}`);
      return existingVestingId;
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const createVestingHash = await manager.createVesting({
    params: {
      recipient: recipientAddress,
      startTimestamp: now,
      endTimestamp: now + 365 * 86_400,
      cliffSeconds: 0,
      releaseIntervalSecs: 86_400,
      timelockSeconds: 0,
      initialUnlockBps: 0,
      cliffAmountBps: 0,
      isRevocable: true,
    },
    amount: vestingAmount,
    account,
  });
  const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createVestingHash });
  gas.push({ action: "createVesting", hash: createVestingHash, gasUsed: createReceipt.gasUsed.toString() });
  const vestingId = extractVestingId(createReceipt);
  console.log(`createVestingTx=${createVestingHash}`);
  console.log(`vestingId=${vestingId}`);
  return vestingId;
}

function extractVestingId(receipt) {
  const events = parseEventLogs({
    abi: confidentialVestingManagerAbi,
    eventName: "VestingCreated",
    logs: receipt.logs,
  });
  const vestingId = events[0]?.args?.vestingId;
  if (!vestingId) {
    throw new Error("VestingCreated event not found in createVesting receipt.");
  }
  return vestingId;
}

async function cancelPendingTransferIfNeeded({ publicClient, walletClient, managerAddress, vestingId, account, gas }) {
  const pending = await publicClient.readContract({
    address: managerAddress,
    abi: confidentialVestingManagerAbi,
    functionName: "getPendingVestingTransfer",
    args: [vestingId],
  });
  const pendingRecipient = Array.isArray(pending) ? pending[0] : pending.newRecipient;
  if (!pendingRecipient || pendingRecipient === "0x0000000000000000000000000000000000000000") {
    return;
  }

  const cancelHash = await walletClient.writeContract({
    address: managerAddress,
    abi: confidentialVestingManagerAbi,
    functionName: "cancelVestingTransfer",
    args: [vestingId],
    account,
  });
  gas.push(await gasLine(publicClient, "cancelPendingTransfer", cancelHash));
  console.log(`cancelPendingTransferTx=${cancelHash}`);
}

async function requireRecipient(manager, vestingId, expected, label) {
  const info = await manager.getVestingInfo(vestingId);
  if (info.recipient.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`${label}: expected recipient ${expected}, got ${info.recipient}`);
  }
  console.log(`${label}Recipient=${info.recipient}`);
}

async function gasLine(publicClient, action, hash) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return {
    action,
    hash,
    gasUsed: receipt.gasUsed.toString(),
  };
}

function envBytes32(name) {
  const value = process.env[name];
  if (!value) return null;
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${name} must be a bytes32 hex string.`);
  }
  return value;
}
