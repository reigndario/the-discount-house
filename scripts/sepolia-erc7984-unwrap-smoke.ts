import hre, { ethers } from "hardhat";
import type { Contract, ContractTransactionResponse, TransactionResponse } from "ethers";

const DEFAULT_UNWRAP_AMOUNT = 1n;
const ERC7984_ERC20_WRAPPER_INTERFACE_ID = "0x1f1c62b2";

type GasLine = {
  action: string;
  hash: string;
  gasUsed: string | undefined;
};

async function main() {
  if (hre.network.name !== "sepolia") {
    throw new Error("Run this script with --network sepolia.");
  }

  const manifest = await readManifest();
  const [account] = await ethers.getSigners();
  const tokenAddress = resolveAddress(
    process.env.CVC_ERC7984_TOKEN_ADDRESS,
    manifest.assets.confidentialCreditToken,
    "confidential credit token",
  );
  const unwrapAmount = process.env.CVC_ERC7984_UNWRAP_AMOUNT
    ? BigInt(process.env.CVC_ERC7984_UNWRAP_AMOUNT)
    : DEFAULT_UNWRAP_AMOUNT;
  if (unwrapAmount <= 0n || unwrapAmount > 2n ** 64n - 1n) {
    throw new Error("CVC_ERC7984_UNWRAP_AMOUNT must be in uint64 range and greater than zero.");
  }

  const token = new ethers.Contract(
    tokenAddress,
    [
      "event UnwrapRequested(address indexed receiver, bytes32 indexed unwrapRequestId, bytes32 amount)",
      "event UnwrapFinalized(address indexed receiver, bytes32 indexed unwrapRequestId, bytes32 encryptedAmount, uint64 cleartextAmount)",
      "function supportsInterface(bytes4 interfaceId) view returns (bool)",
      "function symbol() view returns (string)",
      "function name() view returns (string)",
      "function confidentialBalanceOf(address account) view returns (bytes32)",
      "function underlying() view returns (address)",
      "function rate() view returns (uint256)",
      "function unwrap(address from, address to, bytes32 encryptedAmount, bytes inputProof) returns (bytes32)",
      "function unwrapAmount(bytes32 unwrapRequestId) view returns (bytes32)",
      "function finalizeUnwrap(bytes32 unwrapRequestId, uint64 unwrapAmountCleartext, bytes decryptionProof)",
    ],
    account,
  ) as unknown as Contract;
  const underlying = new ethers.Contract(
    await token.getFunction("underlying")(),
    [
      "function symbol() view returns (string)",
      "function decimals() view returns (uint8)",
      "function balanceOf(address account) view returns (uint256)",
    ],
    account,
  ) as unknown as Contract;

  const supportsWrapper = await token.getFunction("supportsInterface")(ERC7984_ERC20_WRAPPER_INTERFACE_ID);
  if (!supportsWrapper) {
    throw new Error(`${tokenAddress} does not support IERC7984ERC20Wrapper.`);
  }

  const gas: GasLine[] = [];
  const rate = BigInt(await token.getFunction("rate")());
  const underlyingBefore = BigInt(await underlying.getFunction("balanceOf")(account.address));
  console.log("ERC7984 unwrap Sepolia smoke");
  console.log(`account=${account.address}`);
  console.log(`cUSDC=${tokenAddress} ${await token.getFunction("symbol")()} ${await token.getFunction("name")()}`);
  console.log(`underlying=${await token.getFunction("underlying")()} ${await underlying.getFunction("symbol")()}`);
  console.log(`underlyingDecimals=${await underlying.getFunction("decimals")()}`);
  console.log(`rate=${rate.toString()}`);
  console.log(`unwrapAmount=${unwrapAmount.toString()}`);
  console.log(`confidentialBalanceHandleBefore=${await token.getFunction("confidentialBalanceOf")(account.address)}`);
  console.log(`underlyingBalanceBefore=${underlyingBefore.toString()}`);

  const encrypted = await encryptedAmount(tokenAddress, account.address, unwrapAmount);
  const unwrapTx = await token.connect(account).getFunction("unwrap")(
    account.address,
    account.address,
    encrypted.handle,
    encrypted.inputProof,
  );
  gas.push(await waitGas("unwrap", unwrapTx));
  console.log(`unwrapTx=${unwrapTx.hash}`);

  const unwrapRequestId = await unwrapRequestIdFromTx(token, unwrapTx);
  console.log(`unwrapRequestId=${unwrapRequestId}`);

  const unwrapAmountHandle = await token.getFunction("unwrapAmount")(unwrapRequestId);
  const proof = await publicDecryptUint64(unwrapAmountHandle);
  console.log(`publicDecryptUnwrapAmount=${proof.value.toString()}`);
  if (proof.value !== unwrapAmount) {
    throw new Error(
      `Expected unwrap amount ${unwrapAmount.toString()}, got ${proof.value.toString()}. The confidential balance may be insufficient.`,
    );
  }

  const finalizeTx = await token.getFunction("finalizeUnwrap")(unwrapRequestId, proof.value, proof.decryptionProof);
  gas.push(await waitGas("finalizeUnwrap", finalizeTx));
  console.log(`finalizeUnwrapTx=${finalizeTx.hash}`);

  const underlyingAfter = BigInt(await underlying.getFunction("balanceOf")(account.address));
  const expectedDelta = unwrapAmount * rate;
  console.log(`underlyingBalanceAfter=${underlyingAfter.toString()}`);
  console.log(`underlyingDelta=${(underlyingAfter - underlyingBefore).toString()}`);
  if (underlyingAfter - underlyingBefore !== expectedDelta) {
    throw new Error(`Expected underlying balance delta ${expectedDelta.toString()}.`);
  }
  console.log(`confidentialBalanceHandleAfter=${await token.getFunction("confidentialBalanceOf")(account.address)}`);
  console.log("gasSummary=");
  console.log(JSON.stringify(gas, null, 2));
}

async function encryptedAmount(contractAddress: string, userAddress: string, amount: bigint) {
  const relayer = await relayerInstance();
  const builder = relayer.createEncryptedInput(ethers.getAddress(contractAddress), ethers.getAddress(userAddress));
  builder.add64(amount);
  const encrypted = await builder.encrypt();
  return {
    handle: ethers.hexlify(encrypted.handles[0]),
    inputProof: ethers.hexlify(encrypted.inputProof),
  };
}

async function publicDecryptUint64(handle: string) {
  const relayer = await relayerInstance();
  const normalizedHandle = ethers.hexlify(handle) as `0x${string}`;
  const decrypted = await relayer.publicDecrypt([normalizedHandle]);
  return {
    value: BigInt(decrypted.clearValues[normalizedHandle]),
    decryptionProof: decrypted.decryptionProof,
  };
}

async function unwrapRequestIdFromTx(token: Contract, tx: ContractTransactionResponse) {
  const receipt = await tx.wait(1);
  for (const log of receipt?.logs ?? []) {
    try {
      const parsed = token.interface.parseLog(log);
      if (parsed?.name === "UnwrapRequested") {
        return parsed.args.unwrapRequestId as string;
      }
    } catch {
      // Ignore logs from contracts other than the wrapper.
    }
  }
  throw new Error("UnwrapRequested event not found.");
}

async function waitGas(action: string, tx: ContractTransactionResponse | TransactionResponse): Promise<GasLine> {
  const receipt = await tx.wait(1);
  return {
    action,
    hash: tx.hash,
    gasUsed: receipt?.gasUsed.toString(),
  };
}

let cachedRelayer: Awaited<ReturnType<typeof createRelayerInstance>> | undefined;

async function relayerInstance() {
  cachedRelayer ??= await createRelayerInstance();
  return cachedRelayer;
}

async function createRelayerInstance() {
  const sdk = await import("@zama-fhe/relayer-sdk/node");
  const rpcUrl = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
  return sdk.createInstance({
    ...sdk.SepoliaConfig,
    network: rpcUrl,
  });
}

async function readManifest() {
  return JSON.parse(
    await import("node:fs/promises").then((fs) => fs.readFile("public/deployment-manifest.json", "utf8")),
  );
}

function resolveAddress(primary: string | null | undefined, fallback: string | null | undefined, label: string) {
  const value = primary?.trim() || fallback?.trim();
  if (!value) {
    throw new Error(`${label} address is required in env or public/deployment-manifest.json.`);
  }
  return ethers.getAddress(value);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
