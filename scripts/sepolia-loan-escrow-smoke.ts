import hre, { ethers } from "hardhat";
import type { Contract } from "ethers";
import type { ERC7984CreditAdapter } from "../types";

const PRINCIPAL = 10n;
const TOTAL_DUE = 10n;
const TRANSFER_WINDOW_SECONDS = 86_400;
const MIN_LENDER_ETH = ethers.parseEther("0.015");
const LENDER_ETH_TOP_UP = ethers.parseEther("0.02");
const TOKEN_OPS_MANAGER_ABI = [
  "function getAllRecipientVestings(address recipient) view returns (bytes32[])",
  "function getPendingVestingTransfer(bytes32 vestingId) view returns (address newRecipient, uint48 initiatedAt, uint48 expiresAt)",
  "function getVestingInfo(bytes32 vestingId) view returns (address recipient,uint48 startTimestamp,uint48 endTimestamp,uint48 revokeTimestamp,uint48 cliffReleaseTimestamp,uint48 releaseIntervalSecs,uint48 timelock,uint16 initialUnlockBps,uint16 cliffAmountBps,bool isRevocable)",
  "function initiateVestingTransfer(bytes32 vestingId, address newRecipient, uint48 transferDurationSeconds)",
  "function cancelVestingTransfer(bytes32 vestingId)",
  "function acceptVestingTransfer(bytes32 vestingId)",
];

type SepoliaSigner = Awaited<ReturnType<typeof ethers.getSigners>>[number];

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
  const [borrower, lender] = await ethers.getSigners();
  if (!lender) {
    throw new Error("The Sepolia network config must expose at least two funded mnemonic accounts.");
  }

  const tokenAddress = ethers.getAddress(
    process.env.CVC_ERC7984_TOKEN_ADDRESS ?? manifest.assets.confidentialCreditToken,
  );
  const tokenOpsManagerAddress = ethers.getAddress(
    process.env.CVC_TOKENOPS_MANAGER_ADDRESS ?? manifest.assets.tokenOpsManager,
  );
  const vestingAdapterAddress = ethers.getAddress(
    process.env.CVC_TOKENOPS_ADAPTER_ADDRESS ?? manifest.contracts.TokenOpsVestingAdapter.address,
  );
  const loanFactoryAddress = ethers.getAddress(
    process.env.CVC_LOAN_ESCROW_FACTORY_ADDRESS ?? manifest.contracts.LoanEscrowFactory.address,
  );
  const creditAdapterAddress = ethers.getAddress(
    process.env.CVC_ERC7984_ADAPTER_ADDRESS ?? manifest.contracts.ERC7984CreditAdapter.address,
  );

  const token = new ethers.Contract(
    tokenAddress,
    [
      "function symbol() view returns (string)",
      "function confidentialBalanceOf(address account) view returns (bytes32)",
      "function confidentialTransfer(address to, bytes32 encryptedAmount, bytes inputProof) returns (bytes32)",
      "function confidentialTransferAndCall(address to, bytes32 encryptedAmount, bytes inputProof, bytes data) returns (bytes32)",
    ],
    borrower,
  ) as unknown as Contract;
  const tokenOpsManager = new ethers.Contract(tokenOpsManagerAddress, TOKEN_OPS_MANAGER_ABI, borrower) as Contract;
  const vestingAdapter = await ethers.getContractAt("TokenOpsVestingAdapter", vestingAdapterAddress, borrower);
  const loanFactory = await ethers.getContractAt("LoanEscrowFactory", loanFactoryAddress, borrower);
  const creditAdapter = (await ethers.getContractAt(
    "ERC7984CreditAdapter",
    creditAdapterAddress,
    borrower,
  )) as unknown as ERC7984CreditAdapter;

  const gas: GasLine[] = [];
  console.log("LoanEscrow Sepolia smoke");
  console.log(`borrower=${borrower.address}`);
  console.log(`lender=${lender.address}`);
  console.log(`cUSDC=${tokenAddress} ${await token.getFunction("symbol")()}`);
  console.log(`tokenOpsManager=${tokenOpsManagerAddress}`);
  console.log(`vestingAdapter=${vestingAdapterAddress}`);
  console.log(`loanEscrowFactory=${loanFactoryAddress}`);
  console.log(`erc7984CreditAdapter=${creditAdapterAddress}`);
  console.log(`borrowerBalanceHandleBefore=${await token.getFunction("confidentialBalanceOf")(borrower.address)}`);
  console.log(`lenderBalanceHandleBefore=${await token.getFunction("confidentialBalanceOf")(lender.address)}`);

  await fundLenderEthIfNeeded(borrower, lender.address, gas);

  const seedLenderCredit = await encryptedAmount(tokenAddress, borrower.address, PRINCIPAL);
  const seedCreditTx = await token.connect(borrower).getFunction("confidentialTransfer")(
    lender.address,
    seedLenderCredit.handle,
    seedLenderCredit.inputProof,
  );
  gas.push(await waitGas("seedLenderConfidentialCredit", seedCreditTx));
  console.log(`seedLenderConfidentialCreditTx=${seedCreditTx.hash}`);

  const vestingId = await reusableBorrowerVestingId(tokenOpsManager, borrower.address);
  console.log(`vestingId=${vestingId}`);
  await cancelPendingVestingTransferIfNeeded(tokenOpsManager, vestingId, gas);

  const initiateToAdapterTx = await tokenOpsManager.connect(borrower).getFunction("initiateVestingTransfer")(
    vestingId,
    vestingAdapterAddress,
    TRANSFER_WINDOW_SECONDS,
  );
  gas.push(await waitGas("initiateVestingTransferToAdapter", initiateToAdapterTx));
  console.log(`initiateVestingTransferToAdapterTx=${initiateToAdapterTx.hash}`);

  const acceptCustodyTx = await vestingAdapter.acceptPendingVestingTransfer(
    tokenOpsManagerAddress,
    vestingId,
    borrower.address,
  );
  gas.push(await waitGas("adapterAcceptPendingVestingTransfer", acceptCustodyTx));
  console.log(`adapterAcceptPendingVestingTransferTx=${acceptCustodyTx.hash}`);

  const now = BigInt(Math.floor(Date.now() / 1000));
  const fundingCommitmentHash = uniqueHash("loan-funding-commitment", borrower.address);
  const fundingAuthorizationHash = uniqueHash("loan-funding", borrower.address);
  const repaymentAuthorizationHash = uniqueHash("loan-repayment", borrower.address);
  const loanConfig = {
    borrower: borrower.address,
    lender: lender.address,
    vestingAdapter: vestingAdapterAddress,
    creditAdapter: creditAdapterAddress,
    tokenOpsManager: tokenOpsManagerAddress,
    vestingId,
    dueTimestamp: now + 3600n,
    gracePeriodSeconds: 300,
    activationDeadline: now + 900n,
    fundingCommitmentHash,
    fundingAuthorizationHash,
    repaymentAuthorizationHash,
    termsHash: uniqueHash("loan-terms", borrower.address),
    encryptedTermsHash: uniqueHash("loan-encrypted-terms", borrower.address),
  };

  const [loanId, escrowAddress] = await loanFactory.createLoanEscrow.staticCall(loanConfig);
  const createLoanTx = await loanFactory.createLoanEscrow(loanConfig);
  gas.push(await waitGas("createLoanEscrow", createLoanTx));
  console.log(`createLoanEscrowTx=${createLoanTx.hash}`);
  console.log(`loanId=${loanId}`);
  console.log(`escrow=${escrowAddress}`);

  const escrow = await ethers.getContractAt("LoanEscrow", escrowAddress, borrower);
  const registerCollateralTx = await escrow.registerVestingCollateral();
  gas.push(await waitGas("registerVestingCollateral", registerCollateralTx));
  const pledgeId = await escrow.pledgeId();
  console.log(`registerVestingCollateralTx=${registerCollateralTx.hash}`);
  console.log(`pledgeId=${pledgeId}`);

  const fundingAuth = {
    amount: PRINCIPAL,
    deadline: now + 1800n,
    authorizationHash: fundingAuthorizationHash,
  };
  const registerFundingTx = await escrow.registerFundingAuthorization(fundingAuth);
  gas.push(await waitGas("registerFundingAuthorization", registerFundingTx));
  console.log(`registerFundingAuthorizationTx=${registerFundingTx.hash}`);

  await transferCreditAndFinalize({
    token,
    tokenAddress,
    payer: lender,
    creditAdapter,
    creditAdapterAddress,
    authorizationHash: fundingAuthorizationHash,
    amount: PRINCIPAL,
    label: "funding",
    gas,
  });

  const escrowFundingTx = await escrow.escrowFunding(fundingAuth);
  gas.push(await waitGas("escrowFunding", escrowFundingTx));
  console.log(`escrowFundingTx=${escrowFundingTx.hash}`);

  const activateTx = await escrow.activate();
  gas.push(await waitGas("activateLoan", activateTx));
  console.log(`activateLoanTx=${activateTx.hash}`);

  const repaymentAuth = {
    amount: TOTAL_DUE,
    deadline: now + 2400n,
    authorizationHash: repaymentAuthorizationHash,
  };
  const registerPaymentTx = await escrow.registerPaymentAuthorization(repaymentAuth);
  gas.push(await waitGas("registerPaymentAuthorization", registerPaymentTx));
  console.log(`registerPaymentAuthorizationTx=${registerPaymentTx.hash}`);

  await transferCreditAndFinalize({
    token,
    tokenAddress,
    payer: borrower,
    creditAdapter,
    creditAdapterAddress,
    authorizationHash: repaymentAuthorizationHash,
    amount: TOTAL_DUE,
    label: "repayment",
    gas,
  });

  const repaymentTx = await escrow.makeLoanPayment(repaymentAuth);
  gas.push(await waitGas("makeLoanPayment", repaymentTx));
  console.log(`makeLoanPaymentTx=${repaymentTx.hash}`);

  const acceptReleaseTx = await tokenOpsManager.connect(borrower).getFunction("acceptVestingTransfer")(vestingId);
  gas.push(await waitGas("acceptCollateralRelease", acceptReleaseTx));
  console.log(`acceptCollateralReleaseTx=${acceptReleaseTx.hash}`);

  const completeReleaseTx = await vestingAdapter.completeRelease(pledgeId);
  gas.push(await waitGas("completeCollateralRelease", completeReleaseTx));
  console.log(`completeCollateralReleaseTx=${completeReleaseTx.hash}`);

  const finalState = await escrow.state();
  const vestingInfo = await tokenOpsManager.getFunction("getVestingInfo")(vestingId);
  console.log(`finalLoanState=${finalState.toString()}`);
  console.log(`finalVestingRecipient=${vestingInfo[0]}`);
  console.log(`borrowerBalanceHandleAfter=${await token.getFunction("confidentialBalanceOf")(borrower.address)}`);
  console.log(`lenderBalanceHandleAfter=${await token.getFunction("confidentialBalanceOf")(lender.address)}`);
  console.log("gasSummary=");
  console.log(JSON.stringify(gas, null, 2));
}

async function transferCreditAndFinalize({
  token,
  tokenAddress,
  payer,
  creditAdapter,
  creditAdapterAddress,
  authorizationHash,
  amount,
  label,
  gas,
}: {
  token: Contract;
  tokenAddress: string;
  payer: SepoliaSigner;
  creditAdapter: ERC7984CreditAdapter;
  creditAdapterAddress: string;
  authorizationHash: string;
  amount: bigint;
  label: string;
  gas: GasLine[];
}) {
  const encrypted = await encryptedAmount(tokenAddress, payer.address, amount);
  const data = ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [authorizationHash]);
  const transferTx = await token.connect(payer).getFunction("confidentialTransferAndCall")(
    creditAdapterAddress,
    encrypted.handle,
    encrypted.inputProof,
    data,
  );
  gas.push(await waitGas(`${label}ConfidentialTransferAndCall`, transferTx));
  console.log(`${label}ConfidentialTransferAndCallTx=${transferTx.hash}`);

  const authorization = await creditAdapter.getAuthorization(authorizationHash);
  const proof = await publicDecryptAcceptance(authorization.acceptanceHandle);
  console.log(`${label}Accepted=${proof.accepted}`);
  if (!proof.accepted) {
    throw new Error(`${label} transfer was not accepted by ERC7984CreditAdapter.`);
  }

  const finalizeTx = await creditAdapter.finalizeCreditAcceptance(
    authorizationHash,
    proof.accepted,
    proof.decryptionProof,
  );
  gas.push(await waitGas(`${label}FinalizeCreditAcceptance`, finalizeTx));
  console.log(`${label}FinalizeCreditAcceptanceTx=${finalizeTx.hash}`);
}

async function fundLenderEthIfNeeded(borrower: SepoliaSigner, lenderAddress: string, gas: GasLine[]) {
  const balance = await ethers.provider.getBalance(lenderAddress);
  console.log(`lenderEthBalanceBefore=${balance.toString()}`);
  if (balance >= MIN_LENDER_ETH) return;

  const tx = await borrower.sendTransaction({ to: lenderAddress, value: LENDER_ETH_TOP_UP });
  gas.push(await waitGas("fundLenderEth", tx));
  console.log(`fundLenderEthTx=${tx.hash}`);
}

async function reusableBorrowerVestingId(tokenOpsManager: Contract, borrowerAddress: string) {
  const vestingIds = await tokenOpsManager.getFunction("getAllRecipientVestings")(borrowerAddress);
  for (const vestingId of vestingIds) {
    const info = await tokenOpsManager.getFunction("getVestingInfo")(vestingId);
    const recipient = info[0] as string;
    if (recipient.toLowerCase() === borrowerAddress.toLowerCase()) {
      return vestingId as string;
    }
  }

  throw new Error(
    `No TokenOps vesting schedules are currently owned by ${borrowerAddress}. Run smoke:sepolia:tokenops-collateral first or create a borrower vesting.`,
  );
}

async function cancelPendingVestingTransferIfNeeded(tokenOpsManager: Contract, vestingId: string, gas: GasLine[]) {
  const pending = await tokenOpsManager.getFunction("getPendingVestingTransfer")(vestingId);
  const pendingRecipient = pending[0] as string;
  if (pendingRecipient === ethers.ZeroAddress) return;

  const tx = await tokenOpsManager.getFunction("cancelVestingTransfer")(vestingId);
  gas.push(await waitGas("cancelPendingVestingTransfer", tx));
  console.log(`cancelPendingVestingTransferTx=${tx.hash}`);
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

async function publicDecryptAcceptance(handle: string) {
  const relayer = await relayerInstance();
  const normalizedHandle = ethers.hexlify(handle) as `0x${string}`;
  const decrypted = await relayer.publicDecrypt([normalizedHandle]);
  return {
    accepted: Boolean(decrypted.clearValues[normalizedHandle]),
    decryptionProof: decrypted.decryptionProof,
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

function uniqueHash(label: string, actor: string) {
  return ethers.keccak256(
    ethers.solidityPacked(["string", "address", "uint256"], [`sepolia-${label}`, actor, Date.now()]),
  );
}

async function waitGas(
  action: string,
  tx: { hash: string; wait(confirmations?: number): Promise<{ gasUsed?: bigint } | null> },
) {
  const receipt = await tx.wait(1);
  return {
    action,
    hash: tx.hash,
    gasUsed: receipt?.gasUsed?.toString(),
  };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
