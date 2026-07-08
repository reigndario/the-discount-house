import hre, { ethers } from "hardhat";
import type { Contract, ContractTransactionResponse, TransactionResponse } from "ethers";
import type {
  BondManager,
  ConfidentialPreferenceBook,
  ERC7984CreditAdapter,
  LoanEscrow,
  MatchSettlementCoordinator,
  NashNegotiationEngine,
  TokenOpsVestingAdapter,
} from "../types";
import { TERM_FIELD_COUNT } from "../src/protocolSdk";

const BORROWER = 0;
const LENDER = 1;
const LOWER_IS_BETTER = 0;
const HIGHER_IS_BETTER = 1;
const NORMAL_PRIORITY = 2;
const PRINCIPAL = envBigInt("CVC_MATCH_SMOKE_PRINCIPAL", 100n);
const LENDER_COMMITMENT_AMOUNT = process.env.CVC_MATCH_SMOKE_COMMITMENT_AMOUNT
  ? BigInt(process.env.CVC_MATCH_SMOKE_COMMITMENT_AMOUNT)
  : PRINCIPAL;
const TOTAL_DUE = envBigInt("CVC_MATCH_SMOKE_TOTAL_DUE", PRINCIPAL);
const PRINCIPAL_BUCKET = process.env.CVC_MATCH_SMOKE_PRINCIPAL_BUCKET ?? "P<000150";
const DURATION_BUCKET = process.env.CVC_MATCH_SMOKE_DURATION_BUCKET ?? "D<000720";
const TRANSFER_WINDOW_SECONDS = 86_400;
const MIN_BORROWER_ETH = ethers.parseEther("0.1");
const BORROWER_ETH_TOP_UP = ethers.parseEther("0.12");
const MIN_LENDER_ETH = ethers.parseEther("0.03");
const LENDER_ETH_TOP_UP = ethers.parseEther("0.05");
const EXPECT_FAILED_MATCH = process.env.CVC_MATCH_SMOKE_EXPECT_FAILURE === "true";
const SEED_MODE = process.env.CVC_MATCH_SMOKE_SEED_MODE ?? "borrower-transfer";
const UNWRAP_BORROWER_PRINCIPAL = process.env.CVC_MATCH_SMOKE_UNWRAP_BORROWER_PRINCIPAL === "true";
const STOP_AFTER_UNWRAP = process.env.CVC_MATCH_SMOKE_STOP_AFTER_UNWRAP === "true";

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

type PlainField = readonly [bigint, bigint, bigint, number, number];

type PreferenceResult = {
  preferenceId: string;
  backingId: string;
};

type PreparedBacking = {
  borrowerPreferenceId: string;
  borrowerBackingId: string;
  lenderPreferenceId: string;
  lenderBackingId: string;
  vestingId: string;
  lenderCommitmentHash: string;
  commitmentExpiry: bigint;
};

type CoreAddresses = {
  preferenceBook: string;
  negotiationEngine: string;
  bondManager: string;
  settlementCoordinator: string;
  tokenOpsAdapter: string;
  erc7984CreditAdapter: string;
  tokenOpsManager: string;
  confidentialCreditToken: string;
  collateralToken: string;
};

async function main() {
  if (hre.network.name !== "sepolia") {
    throw new Error("Run this script with --network sepolia.");
  }

  const manifest = await readManifest();
  const { operator, borrower, lender, operatorIndex, borrowerIndex, lenderIndex } = await roleSigners();

  const addresses: CoreAddresses = {
    preferenceBook: ethers.getAddress(manifest.contracts.ConfidentialPreferenceBook.address),
    negotiationEngine: ethers.getAddress(manifest.contracts.NashNegotiationEngine.address),
    bondManager: ethers.getAddress(manifest.contracts.BondManager.address),
    settlementCoordinator: ethers.getAddress(manifest.contracts.MatchSettlementCoordinator.address),
    tokenOpsAdapter: resolveAddress(
      process.env.CVC_TOKENOPS_ADAPTER_ADDRESS,
      manifest.contracts.TokenOpsVestingAdapter.address,
      "TokenOps adapter",
    ),
    erc7984CreditAdapter: resolveAddress(
      process.env.CVC_ERC7984_ADAPTER_ADDRESS,
      manifest.contracts.ERC7984CreditAdapter.address,
      "ERC7984 credit adapter",
    ),
    tokenOpsManager: resolveAddress(
      process.env.CVC_TOKENOPS_MANAGER_ADDRESS,
      manifest.assets.tokenOpsManager,
      "TokenOps manager",
    ),
    confidentialCreditToken: resolveAddress(
      process.env.CVC_ERC7984_TOKEN_ADDRESS,
      manifest.assets.confidentialCreditToken,
      "confidential credit token",
    ),
    collateralToken: resolveAddress(
      process.env.CVC_COLLATERAL_TOKEN_ADDRESS,
      manifest.assets.collateralToken,
      "collateral token",
    ),
  };

  const preferenceBook = (await ethers.getContractAt(
    "ConfidentialPreferenceBook",
    addresses.preferenceBook,
    borrower,
  )) as unknown as ConfidentialPreferenceBook;
  const engine = (await ethers.getContractAt(
    "NashNegotiationEngine",
    addresses.negotiationEngine,
    borrower,
  )) as unknown as NashNegotiationEngine;
  const bondManager = (await ethers.getContractAt(
    "BondManager",
    addresses.bondManager,
    borrower,
  )) as unknown as BondManager;
  const coordinator = (await ethers.getContractAt(
    "MatchSettlementCoordinator",
    addresses.settlementCoordinator,
    borrower,
  )) as unknown as MatchSettlementCoordinator;
  const vestingAdapter = (await ethers.getContractAt(
    "TokenOpsVestingAdapter",
    addresses.tokenOpsAdapter,
    borrower,
  )) as unknown as TokenOpsVestingAdapter;
  const creditAdapter = (await ethers.getContractAt(
    "ERC7984CreditAdapter",
    addresses.erc7984CreditAdapter,
    borrower,
  )) as unknown as ERC7984CreditAdapter;
  const tokenOpsManager = new ethers.Contract(addresses.tokenOpsManager, TOKEN_OPS_MANAGER_ABI, borrower) as Contract;
  const creditToken = new ethers.Contract(
    addresses.confidentialCreditToken,
    [
      "function symbol() view returns (string)",
      "event UnwrapRequested(address indexed receiver, bytes32 indexed unwrapRequestId, bytes32 amount)",
      "function confidentialBalanceOf(address account) view returns (bytes32)",
      "function confidentialTransfer(address to, bytes32 encryptedAmount, bytes inputProof) returns (bytes32)",
      "function confidentialTransferAndCall(address to, bytes32 encryptedAmount, bytes inputProof, bytes data) returns (bytes32)",
      "function underlying() view returns (address)",
      "function rate() view returns (uint256)",
      "function wrap(address to, uint256 amount) returns (bytes32)",
      "function unwrap(address from, address to, bytes32 encryptedAmount, bytes inputProof) returns (bytes32)",
      "function unwrapAmount(bytes32 unwrapRequestId) view returns (bytes32)",
      "function finalizeUnwrap(bytes32 unwrapRequestId, uint64 unwrapAmountCleartext, bytes decryptionProof)",
    ],
    borrower,
  ) as Contract;

  const gas: GasLine[] = [];
  console.log(
    EXPECT_FAILED_MATCH
      ? "Encrypted failed match + bond settlement Sepolia smoke"
      : "Encrypted match + settlement Sepolia smoke",
  );
  console.log(`operatorIndex=${operatorIndex} operator=${operator.address}`);
  console.log(`borrowerIndex=${borrowerIndex} borrower=${borrower.address}`);
  console.log(`lenderIndex=${lenderIndex} lender=${lender.address}`);
  console.log(`preferenceBook=${addresses.preferenceBook}`);
  console.log(`negotiationEngine=${addresses.negotiationEngine}`);
  console.log(`bondManager=${addresses.bondManager}`);
  console.log(`matchSettlementCoordinator=${addresses.settlementCoordinator}`);
  console.log(`tokenOpsManager=${addresses.tokenOpsManager}`);
  console.log(`vestingAdapter=${addresses.tokenOpsAdapter}`);
  console.log(`cUSDC=${addresses.confidentialCreditToken} ${await creditToken.getFunction("symbol")()}`);
  console.log(`erc7984CreditAdapter=${addresses.erc7984CreditAdapter}`);
  console.log(`seedMode=${SEED_MODE}`);
  console.log(`principal=${PRINCIPAL.toString()}`);
  console.log(`lenderCommitmentAmount=${LENDER_COMMITMENT_AMOUNT.toString()}`);
  console.log(`totalDue=${TOTAL_DUE.toString()}`);
  console.log(`principalBucket=${PRINCIPAL_BUCKET}`);
  console.log(`durationBucket=${DURATION_BUCKET}`);
  if (LENDER_COMMITMENT_AMOUNT < PRINCIPAL) {
    throw new Error("CVC_MATCH_SMOKE_COMMITMENT_AMOUNT must be at least PRINCIPAL.");
  }

  await fundRoleEthIfNeeded(operator, borrower.address, MIN_BORROWER_ETH, BORROWER_ETH_TOP_UP, "fundBorrowerEth", gas);
  await fundRoleEthIfNeeded(operator, lender.address, MIN_LENDER_ETH, LENDER_ETH_TOP_UP, "fundLenderEth", gas);

  const backing = await prepareExecutableBacking({
    operator,
    borrower,
    lender,
    preferenceBook,
    vestingAdapter,
    creditAdapter,
    tokenOpsManager,
    creditToken,
    addresses,
    gas,
  });

  const bondAttemptId = await postBond({ borrower, bondManager, gas });
  const matchAttemptId = await executeMatch({
    engine,
    taker: borrower,
    borrowerPreferenceId: backing.borrowerPreferenceId,
    lenderPreferenceId: backing.lenderPreferenceId,
    gas,
  });
  const matchFeasible = await computeAndFinalizeMatch({
    engine,
    relayer: borrower,
    matchAttemptId,
    expectFeasible: !EXPECT_FAILED_MATCH,
    gas,
  });

  const attempt = await engine.getAttempt(matchAttemptId);
  if (EXPECT_FAILED_MATCH) {
    if (matchFeasible || attempt.status !== 2n) {
      throw new Error(`Expected failed match status 2, got feasible=${matchFeasible} status=${attempt.status}`);
    }
    await settleFailedMatch({
      coordinator,
      bondManager,
      bondAttemptId,
      matchAttemptId,
      counterparty: lender.address,
      gas,
    });
    console.log("gasSummary=");
    console.log(JSON.stringify(gas, null, 2));
    return;
  }

  if (attempt.status !== 1n) {
    throw new Error(`Expected succeeded match status 1, got ${attempt.status.toString()}`);
  }

  const { escrowAddress, fundingAuthorizationHash, repaymentAuthorizationHash } = await settleSuccessfulMatch({
    borrower,
    lender,
    coordinator,
    bondAttemptId,
    matchAttemptId,
    vestingAdapterAddress: addresses.tokenOpsAdapter,
    creditAdapterAddress: addresses.erc7984CreditAdapter,
    tokenOpsManagerAddress: addresses.tokenOpsManager,
    vestingId: backing.vestingId,
    fundingCommitmentHash: backing.lenderCommitmentHash,
    termsHash: attempt.termsHash,
    encryptedTermsHash: attempt.encryptedTermsHash,
    gas,
  });

  await completeSettledLoanLifecycle({
    borrower,
    lender,
    escrowAddress,
    tokenOpsManager,
    vestingAdapter,
    creditAdapter,
    creditToken,
    creditTokenAddress: addresses.confidentialCreditToken,
    creditAdapterAddress: addresses.erc7984CreditAdapter,
    fundingAuthorizationHash,
    repaymentAuthorizationHash,
    vestingId: backing.vestingId,
    fundingDeadline: backing.commitmentExpiry,
    gas,
  });

  console.log("gasSummary=");
  console.log(JSON.stringify(gas, null, 2));
}

async function roleSigners() {
  const signers = await ethers.getSigners();
  const operatorIndex = signerIndex("CVC_OPERATOR_INDEX", 0);
  const borrowerIndex = signerIndex("CVC_BORROWER_INDEX", 0);
  const lenderIndex = signerIndex("CVC_LENDER_INDEX", 1);
  const operator = signers[operatorIndex];
  const borrower = signers[borrowerIndex];
  const lender = signers[lenderIndex];
  if (!operator || !borrower || !lender) {
    throw new Error(
      `Sepolia config exposes ${signers.length} accounts; requested operator=${operatorIndex}, borrower=${borrowerIndex}, lender=${lenderIndex}.`,
    );
  }
  const unique = new Set([
    operator.address.toLowerCase(),
    borrower.address.toLowerCase(),
    lender.address.toLowerCase(),
  ]);
  if (unique.size !== 3) {
    throw new Error("Operator, borrower, and lender signer indexes must resolve to three distinct addresses.");
  }
  return { operator, borrower, lender, operatorIndex, borrowerIndex, lenderIndex };
}

function signerIndex(name: string, fallback: number) {
  const raw = process.env[name] ?? String(fallback);
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer, got ${raw}.`);
  }
  return parsed;
}

function envBigInt(name: string, fallback: bigint) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;

  const parsed = BigInt(raw);
  if (parsed < 0n || parsed > 2n ** 64n - 1n) {
    throw new Error(`${name} must be between 0 and uint64 max, got ${raw}.`);
  }
  return parsed;
}

async function prepareExecutableBacking({
  operator,
  borrower,
  lender,
  preferenceBook,
  vestingAdapter,
  creditAdapter,
  tokenOpsManager,
  creditToken,
  addresses,
  gas,
}: {
  operator: SepoliaSigner;
  borrower: SepoliaSigner;
  lender: SepoliaSigner;
  preferenceBook: ConfidentialPreferenceBook;
  vestingAdapter: TokenOpsVestingAdapter;
  creditAdapter: ERC7984CreditAdapter;
  tokenOpsManager: Contract;
  creditToken: Contract;
  addresses: CoreAddresses;
  gas: GasLine[];
}): Promise<PreparedBacking> {
  const borrowerBackingId = uniqueHash("borrower-backing", borrower.address);
  const lenderBackingId = uniqueHash("lender-backing", lender.address);
  const lenderCommitmentHash = uniqueHash("lender-commitment", lender.address);
  const commitmentExpiry = BigInt(Math.floor(Date.now() / 1000) + 3600);

  const borrowerPreference = await submitPreference({
    preferenceBook,
    manager: borrower,
    side: BORROWER,
    collateralToken: addresses.collateralToken,
    tokenOpsManager: addresses.tokenOpsManager,
    backingId: borrowerBackingId,
    label: "borrower",
    gas,
  });
  const lenderPreference = await submitPreference({
    preferenceBook,
    manager: lender,
    side: LENDER,
    collateralToken: addresses.collateralToken,
    tokenOpsManager: addresses.tokenOpsManager,
    backingId: lenderBackingId,
    label: "lender",
    gas,
  });

  const vestingId = await moveBorrowerVestingToAdapter({
    borrower,
    tokenOpsManager,
    tokenOpsManagerAddress: addresses.tokenOpsManager,
    vestingAdapter,
    vestingAdapterAddress: addresses.tokenOpsAdapter,
    gas,
  });
  const registerBorrowerTx = await preferenceBook
    .connect(borrower)
    .registerBorrowerBacking(borrowerBackingId, addresses.tokenOpsManager, addresses.tokenOpsAdapter, vestingId);
  gas.push(await waitGas("registerBorrowerBacking", registerBorrowerTx));
  console.log(`registerBorrowerBackingTx=${registerBorrowerTx.hash}`);

  await seedAndEscrowLenderCredit({
    operator,
    borrower,
    lender,
    creditToken,
    creditTokenAddress: addresses.confidentialCreditToken,
    creditAdapter,
    creditAdapterAddress: addresses.erc7984CreditAdapter,
    commitmentHash: lenderCommitmentHash,
    commitmentExpiry,
    gas,
  });
  const registerLenderTx = await preferenceBook
    .connect(lender)
    .registerLenderBacking(lenderBackingId, addresses.erc7984CreditAdapter, lenderCommitmentHash, commitmentExpiry);
  gas.push(await waitGas("registerLenderBacking", registerLenderTx));
  console.log(`registerLenderBackingTx=${registerLenderTx.hash}`);

  const activateBorrowerTx = await preferenceBook.connect(borrower).activateBacking(borrowerBackingId);
  gas.push(await waitGas("activateBorrowerBacking", activateBorrowerTx));
  console.log(`activateBorrowerBackingTx=${activateBorrowerTx.hash}`);

  const activateLenderTx = await preferenceBook.connect(lender).activateBacking(lenderBackingId);
  gas.push(await waitGas("activateLenderBacking", activateLenderTx));
  console.log(`activateLenderBackingTx=${activateLenderTx.hash}`);

  console.log(`borrowerPreferenceId=${borrowerPreference.preferenceId}`);
  console.log(`lenderPreferenceId=${lenderPreference.preferenceId}`);
  console.log(`vestingId=${vestingId}`);
  console.log(`lenderCommitmentHash=${lenderCommitmentHash}`);

  return {
    borrowerPreferenceId: borrowerPreference.preferenceId,
    borrowerBackingId,
    lenderPreferenceId: lenderPreference.preferenceId,
    lenderBackingId,
    vestingId,
    lenderCommitmentHash,
    commitmentExpiry,
  };
}

async function submitPreference({
  preferenceBook,
  manager,
  side,
  collateralToken,
  tokenOpsManager,
  backingId,
  label,
  gas,
}: {
  preferenceBook: ConfidentialPreferenceBook;
  manager: SepoliaSigner;
  side: number;
  collateralToken: string;
  tokenOpsManager: string;
  backingId: string;
  label: string;
  gas: GasLine[];
}): Promise<PreferenceResult> {
  const input = await preferenceInput({
    bookAddress: await preferenceBook.getAddress(),
    managerAddress: manager.address,
    side,
    collateralToken,
    tokenOpsManager,
    backingId,
  });

  const preferenceId = await preferenceBook.connect(manager).createPreferenceBundle.staticCall(input);
  const tx = await preferenceBook.connect(manager).createPreferenceBundle(input);
  gas.push(await waitGas(`${label}CreatePreferenceBundle`, tx));
  console.log(`${label}CreatePreferenceBundleTx=${tx.hash}`);
  return { preferenceId, backingId };
}

async function preferenceInput({
  bookAddress,
  managerAddress,
  side,
  collateralToken,
  tokenOpsManager,
  backingId,
}: {
  bookAddress: string;
  managerAddress: string;
  side: number;
  collateralToken: string;
  tokenOpsManager: string;
  backingId: string;
}) {
  const metadata = {
    side,
    collateralToken,
    tokenOpsManager,
    principalBucket: ethers.encodeBytes32String(PRINCIPAL_BUCKET),
    durationBucket: ethers.encodeBytes32String(DURATION_BUCKET),
    expiry: BigInt(Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60),
  };
  const encrypted = await browserStyleEncryptedFields(bookAddress, managerAddress, side);
  return {
    metadata,
    backingId,
    ...encrypted,
  };
}

async function browserStyleEncryptedFields(bookAddress: string, managerAddress: string, side: number) {
  const relayer = await relayerInstance();
  const builder = relayer.createEncryptedInput(ethers.getAddress(bookAddress), ethers.getAddress(managerAddress));
  for (const [min, max, target, direction, priority] of fieldsForMatchSmoke(side)) {
    builder.add64(min);
    builder.add64(max);
    builder.add64(target);
    builder.add8(direction);
    builder.add8(priority);
  }

  const proof = builder.generateZKProof();
  const { handles, inputProof } = await relayer.requestZKProofVerification(proof);
  let cursor = 0;
  const nextField = () => ({
    range: {
      min: ethers.hexlify(handles[cursor++]),
      max: ethers.hexlify(handles[cursor++]),
      target: ethers.hexlify(handles[cursor++]),
    },
    direction: ethers.hexlify(handles[cursor++]),
    priority: ethers.hexlify(handles[cursor++]),
  });

  return {
    collateralAmount: nextField(),
    principal: nextField(),
    collateralTokenPriceE8: nextField(),
    interestBps: nextField(),
    durationDays: nextField(),
    gracePeriodDays: nextField(),
    inputProof: ethers.hexlify(inputProof),
  };
}

function fieldsForMatchSmoke(side: number): PlainField[] {
  const principal =
    EXPECT_FAILED_MATCH && side === LENDER
      ? ([PRINCIPAL + 10n, PRINCIPAL + 10n, PRINCIPAL + 10n] as const)
      : ([PRINCIPAL, PRINCIPAL, PRINCIPAL] as const);
  return [
    [100n, 100n, 100n, HIGHER_IS_BETTER, NORMAL_PRIORITY],
    [principal[0], principal[1], principal[2], HIGHER_IS_BETTER, NORMAL_PRIORITY],
    [10_000_000n, 10_000_000n, 10_000_000n, HIGHER_IS_BETTER, NORMAL_PRIORITY],
    [0n, 0n, 0n, LOWER_IS_BETTER, NORMAL_PRIORITY],
    [360n, 360n, 360n, HIGHER_IS_BETTER, NORMAL_PRIORITY],
    [7n, 7n, 7n, LOWER_IS_BETTER, NORMAL_PRIORITY],
  ];
}

async function moveBorrowerVestingToAdapter({
  borrower,
  tokenOpsManager,
  tokenOpsManagerAddress,
  vestingAdapter,
  vestingAdapterAddress,
  gas,
}: {
  borrower: SepoliaSigner;
  tokenOpsManager: Contract;
  tokenOpsManagerAddress: string;
  vestingAdapter: TokenOpsVestingAdapter;
  vestingAdapterAddress: string;
  gas: GasLine[];
}) {
  const vestingId = await reusableBorrowerVestingId(tokenOpsManager, borrower.address);
  await cancelPendingVestingTransferIfNeeded(tokenOpsManager, vestingId, gas);

  const initiateTx = await tokenOpsManager.connect(borrower).getFunction("initiateVestingTransfer")(
    vestingId,
    vestingAdapterAddress,
    TRANSFER_WINDOW_SECONDS,
  );
  gas.push(await waitGas("initiateVestingTransferToAdapter", initiateTx));
  console.log(`initiateVestingTransferToAdapterTx=${initiateTx.hash}`);

  const acceptCustodyTx = await vestingAdapter
    .connect(borrower)
    .acceptPendingVestingTransfer(tokenOpsManagerAddress, vestingId, borrower.address);
  gas.push(await waitGas("adapterAcceptPendingVestingTransfer", acceptCustodyTx));
  console.log(`adapterAcceptPendingVestingTransferTx=${acceptCustodyTx.hash}`);

  await requireVestingRecipient(tokenOpsManager, vestingId, vestingAdapterAddress, "after adapter custody acceptance");
  return vestingId;
}

async function reusableBorrowerVestingId(tokenOpsManager: Contract, borrowerAddress: string) {
  if (process.env.CVC_MATCH_SMOKE_VESTING_ID) {
    const vestingId = process.env.CVC_MATCH_SMOKE_VESTING_ID;
    const info = await tokenOpsManager.getFunction("getVestingInfo")(vestingId);
    const recipient = ethers.getAddress(info[0] as string);
    if (recipient !== ethers.getAddress(borrowerAddress)) {
      throw new Error(`CVC_MATCH_SMOKE_VESTING_ID is owned by ${recipient}, not ${borrowerAddress}.`);
    }
    return vestingId;
  }

  const vestingIds = (await tokenOpsManager.getFunction("getAllRecipientVestings")(borrowerAddress)) as string[];
  for (const vestingId of vestingIds) {
    const info = await tokenOpsManager.getFunction("getVestingInfo")(vestingId);
    const recipient = ethers.getAddress(info[0] as string);
    if (recipient === ethers.getAddress(borrowerAddress)) {
      return vestingId;
    }
  }

  throw new Error(
    `No TokenOps vesting schedules are currently owned by ${borrowerAddress}. Run smoke:sepolia:tokenops-collateral first or set CVC_MATCH_SMOKE_VESTING_ID.`,
  );
}

async function cancelPendingVestingTransferIfNeeded(tokenOpsManager: Contract, vestingId: string, gas: GasLine[]) {
  const pending = await tokenOpsManager.getFunction("getPendingVestingTransfer")(vestingId);
  const pendingRecipient = ethers.getAddress(pending[0] as string);
  if (pendingRecipient === ethers.ZeroAddress) return;

  const tx = await tokenOpsManager.getFunction("cancelVestingTransfer")(vestingId);
  gas.push(await waitGas("cancelPendingVestingTransfer", tx));
  console.log(`cancelPendingVestingTransferTx=${tx.hash}`);
}

async function seedAndEscrowLenderCredit({
  operator,
  borrower,
  lender,
  creditToken,
  creditTokenAddress,
  creditAdapter,
  creditAdapterAddress,
  commitmentHash,
  commitmentExpiry,
  gas,
}: {
  operator: SepoliaSigner;
  borrower: SepoliaSigner;
  lender: SepoliaSigner;
  creditToken: Contract;
  creditTokenAddress: string;
  creditAdapter: ERC7984CreditAdapter;
  creditAdapterAddress: string;
  commitmentHash: string;
  commitmentExpiry: bigint;
  gas: GasLine[];
}) {
  if (SEED_MODE === "wrap") {
    await wrapConfidentialCreditToLender({
      operator,
      lender,
      creditToken,
      amount: LENDER_COMMITMENT_AMOUNT,
      gas,
    });
  } else if (SEED_MODE === "borrower-transfer") {
    const seed = await encryptedAmount(creditTokenAddress, borrower.address, LENDER_COMMITMENT_AMOUNT);
    const seedTx = await creditToken.connect(borrower).getFunction("confidentialTransfer")(
      lender.address,
      seed.handle,
      seed.inputProof,
    );
    gas.push(await waitGas("seedLenderConfidentialCredit", seedTx));
    console.log(`seedLenderConfidentialCreditTx=${seedTx.hash}`);
  } else {
    throw new Error(`Unsupported CVC_MATCH_SMOKE_SEED_MODE=${SEED_MODE}.`);
  }

  const registerCommitmentTx = await creditAdapter
    .connect(lender)
    .registerLenderCreditCommitment(commitmentHash, lender.address, commitmentExpiry);
  gas.push(await waitGas("registerLenderCreditCommitment", registerCommitmentTx));
  console.log(`registerLenderCreditCommitmentTx=${registerCommitmentTx.hash}`);

  const escrowed = await encryptedAmount(creditTokenAddress, lender.address, LENDER_COMMITMENT_AMOUNT);
  const escrowTx = await creditToken.connect(lender).getFunction("confidentialTransferAndCall")(
    creditAdapterAddress,
    escrowed.handle,
    escrowed.inputProof,
    ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [commitmentHash]),
  );
  gas.push(await waitGas("escrowLenderCommitmentCredit", escrowTx));
  console.log(`escrowLenderCommitmentCreditTx=${escrowTx.hash}`);

  const executable = await creditAdapter.isCreditCommitmentExecutable(commitmentHash, lender.address);
  console.log(`lenderCommitmentExecutable=${executable}`);
  if (!executable) {
    throw new Error("Lender credit commitment is not executable after escrow.");
  }
}

async function wrapConfidentialCreditToLender({
  operator,
  lender,
  creditToken,
  amount,
  gas,
}: {
  operator: SepoliaSigner;
  lender: SepoliaSigner;
  creditToken: Contract;
  amount: bigint;
  gas: GasLine[];
}) {
  const wrapperAddress = await creditToken.getAddress();
  const rate = BigInt(await creditToken.getFunction("rate")());
  const underlyingAmount = amount * rate;
  const underlyingAddress = await creditToken.getFunction("underlying")();
  const underlying = new ethers.Contract(
    underlyingAddress,
    [
      "function mint(address to, uint256 amount)",
      "function approve(address spender, uint256 amount) returns (bool)",
      "function allowance(address owner, address spender) view returns (uint256)",
      "function symbol() view returns (string)",
    ],
    operator,
  );

  const mintTx = await underlying.getFunction("mint")(operator.address, underlyingAmount);
  gas.push(await waitGas("mintUnderlyingUSDCForWrap", mintTx));
  console.log(`mintUnderlyingUSDCForWrapTx=${mintTx.hash}`);

  const allowance = BigInt(await underlying.getFunction("allowance")(operator.address, wrapperAddress));
  if (allowance < underlyingAmount) {
    const approveTx = await underlying.getFunction("approve")(wrapperAddress, underlyingAmount);
    gas.push(await waitGas("approveUnderlyingUSDCForWrap", approveTx));
    console.log(`approveUnderlyingUSDCForWrapTx=${approveTx.hash}`);
  } else {
    console.log("approveUnderlyingUSDCForWrapTx=reused");
  }

  const wrapTx = await creditToken.connect(operator).getFunction("wrap")(lender.address, underlyingAmount);
  gas.push(await waitGas("wrapLenderConfidentialCredit", wrapTx));
  console.log(`wrapLenderConfidentialCreditTx=${wrapTx.hash}`);
  console.log(`wrappedCreditAmount=${amount.toString()}`);
  console.log(`underlyingCreditAmount=${underlyingAmount.toString()} ${await underlying.getFunction("symbol")()}`);
  console.log(`lenderBalanceHandleAfterWrap=${await creditToken.getFunction("confidentialBalanceOf")(lender.address)}`);
}

async function postBond({
  borrower,
  bondManager,
  gas,
}: {
  borrower: SepoliaSigner;
  bondManager: BondManager;
  gas: GasLine[];
}) {
  const requiredBond = await bondManager.quoteBond(1, 1);
  const takerAccountId = BigInt(Date.now());
  const attemptId = await bondManager.connect(borrower).postBond.staticCall(takerAccountId, 1, 1, {
    value: requiredBond,
  });
  const tx = await bondManager.connect(borrower).postBond(takerAccountId, 1, 1, { value: requiredBond });
  gas.push(await waitGas("postBond", tx));
  console.log(`postBondTx=${tx.hash}`);
  console.log(`bondAttemptId=${attemptId}`);
  return attemptId;
}

async function executeMatch({
  engine,
  taker,
  borrowerPreferenceId,
  lenderPreferenceId,
  gas,
}: {
  engine: NashNegotiationEngine;
  taker: SepoliaSigner;
  borrowerPreferenceId: string;
  lenderPreferenceId: string;
  gas: GasLine[];
}) {
  const attemptId = await engine.connect(taker).executeMatch.staticCall(borrowerPreferenceId, [lenderPreferenceId]);
  const tx = await engine.connect(taker).executeMatch(borrowerPreferenceId, [lenderPreferenceId]);
  gas.push(await waitGas("executeMatch", tx));
  console.log(`executeMatchTx=${tx.hash}`);
  console.log(`matchAttemptId=${attemptId}`);
  return attemptId;
}

async function computeAndFinalizeMatch({
  engine,
  relayer,
  matchAttemptId,
  expectFeasible,
  gas,
}: {
  engine: NashNegotiationEngine;
  relayer: SepoliaSigner;
  matchAttemptId: string;
  expectFeasible: boolean;
  gas: GasLine[];
}) {
  for (let fieldIndex = 0; fieldIndex < TERM_FIELD_COUNT; fieldIndex++) {
    const tx = await engine.connect(relayer).computeSelectedTerm(matchAttemptId, fieldIndex);
    gas.push(await waitGas(`computeSelectedTerm${fieldIndex}`, tx));
    console.log(`computeSelectedTerm${fieldIndex}Tx=${tx.hash}`);
  }

  const commitTx = await engine.connect(relayer).commitEncryptedTerms(matchAttemptId);
  gas.push(await waitGas("commitEncryptedTerms", commitTx));
  console.log(`commitEncryptedTermsTx=${commitTx.hash}`);

  const encryptedTerms = await engine.getEncryptedTerms(matchAttemptId);
  const feasibleHandle = handleToBytes32(encryptedTerms.feasible);
  console.log(`feasibilityHandle=${feasibleHandle}`);
  const proof = await publicDecryptBoolean(feasibleHandle);
  console.log(`matchFeasible=${proof.value}`);
  if (proof.value !== expectFeasible) {
    throw new Error(`Expected matchFeasible=${expectFeasible}, got ${proof.value}.`);
  }

  const finalizeTx = await engine
    .connect(relayer)
    .finalizeMatchFeasibility(matchAttemptId, proof.value, proof.decryptionProof);
  gas.push(await waitGas("finalizeMatchFeasibility", finalizeTx));
  console.log(`finalizeMatchFeasibilityTx=${finalizeTx.hash}`);
  return proof.value;
}

async function settleFailedMatch({
  coordinator,
  bondManager,
  bondAttemptId,
  matchAttemptId,
  counterparty,
  gas,
}: {
  coordinator: MatchSettlementCoordinator;
  bondManager: BondManager;
  bondAttemptId: string;
  matchAttemptId: string;
  counterparty: string;
  gas: GasLine[];
}) {
  const tx = await coordinator.settleFailedMatch(bondAttemptId, matchAttemptId, [counterparty]);
  gas.push(await waitGas("settleFailedMatch", tx));
  console.log(`settleFailedMatchTx=${tx.hash}`);
  const bondAttempt = await bondManager.getAttempt(bondAttemptId);
  console.log(`bondAttemptStatus=${bondAttempt.status.toString()}`);
  if (bondAttempt.status !== 3n) {
    throw new Error(`Expected slashed bond status 3, got ${bondAttempt.status.toString()}`);
  }
}

async function settleSuccessfulMatch({
  borrower,
  lender,
  coordinator,
  bondAttemptId,
  matchAttemptId,
  vestingAdapterAddress,
  creditAdapterAddress,
  tokenOpsManagerAddress,
  vestingId,
  fundingCommitmentHash,
  termsHash,
  encryptedTermsHash,
  gas,
}: {
  borrower: SepoliaSigner;
  lender: SepoliaSigner;
  coordinator: MatchSettlementCoordinator;
  bondAttemptId: string;
  matchAttemptId: string;
  vestingAdapterAddress: string;
  creditAdapterAddress: string;
  tokenOpsManagerAddress: string;
  vestingId: string;
  fundingCommitmentHash: string;
  termsHash: string;
  encryptedTermsHash: string;
  gas: GasLine[];
}) {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const fundingAuthorizationHash = uniqueHash("funding-draw", borrower.address);
  const repaymentAuthorizationHash = uniqueHash("repayment-commitment", borrower.address);
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
    termsHash,
    encryptedTermsHash,
  };
  const [, escrowAddress] = await coordinator
    .connect(borrower)
    .settleSuccessfulMatch.staticCall(bondAttemptId, matchAttemptId, loanConfig);
  const tx = await coordinator.connect(borrower).settleSuccessfulMatch(bondAttemptId, matchAttemptId, loanConfig);
  gas.push(await waitGas("settleSuccessfulMatch", tx));
  console.log(`settleSuccessfulMatchTx=${tx.hash}`);
  console.log(`escrow=${escrowAddress}`);
  return { escrowAddress, fundingAuthorizationHash, repaymentAuthorizationHash };
}

async function completeSettledLoanLifecycle({
  borrower,
  lender,
  escrowAddress,
  tokenOpsManager,
  vestingAdapter,
  creditAdapter,
  creditToken,
  creditTokenAddress,
  creditAdapterAddress,
  fundingAuthorizationHash,
  repaymentAuthorizationHash,
  vestingId,
  fundingDeadline,
  gas,
}: {
  borrower: SepoliaSigner;
  lender: SepoliaSigner;
  escrowAddress: string;
  tokenOpsManager: Contract;
  vestingAdapter: TokenOpsVestingAdapter;
  creditAdapter: ERC7984CreditAdapter;
  creditToken: Contract;
  creditTokenAddress: string;
  creditAdapterAddress: string;
  fundingAuthorizationHash: string;
  repaymentAuthorizationHash: string;
  vestingId: string;
  fundingDeadline: bigint;
  gas: GasLine[];
}) {
  const escrow = (await ethers.getContractAt("LoanEscrow", escrowAddress, borrower)) as unknown as LoanEscrow;
  const registerCollateralTx = await escrow.registerVestingCollateral();
  gas.push(await waitGas("registerVestingCollateral", registerCollateralTx));
  const pledgeId = await escrow.pledgeId();
  console.log(`registerVestingCollateralTx=${registerCollateralTx.hash}`);
  console.log(`pledgeId=${pledgeId}`);

  const fundingAuth = {
    amount: PRINCIPAL,
    deadline: fundingDeadline,
    authorizationHash: fundingAuthorizationHash,
  };
  const registerFundingTx = await escrow.registerFundingAuthorization(fundingAuth);
  gas.push(await waitGas("registerFundingAuthorization", registerFundingTx));
  console.log(`registerFundingAuthorizationTx=${registerFundingTx.hash}`);
  await finalizeAdapterAcceptance({
    creditAdapter,
    authorizationHash: fundingAuthorizationHash,
    label: "funding",
    gas,
  });

  const escrowFundingTx = await escrow.escrowFunding(fundingAuth);
  gas.push(await waitGas("escrowFunding", escrowFundingTx));
  console.log(`escrowFundingTx=${escrowFundingTx.hash}`);

  const activateTx = await escrow.activate();
  gas.push(await waitGas("activateLoan", activateTx));
  console.log(`activateLoanTx=${activateTx.hash}`);
  console.log(
    `borrowerBalanceHandleAfterActivation=${await creditToken.getFunction("confidentialBalanceOf")(borrower.address)}`,
  );

  if (UNWRAP_BORROWER_PRINCIPAL) {
    await unwrapBorrowerPrincipal({
      borrower,
      creditToken,
      creditTokenAddress,
      amount: PRINCIPAL,
      gas,
    });
    if (STOP_AFTER_UNWRAP) {
      const finalState = await escrow.state();
      console.log(`finalLoanState=${finalState.toString()}`);
      return;
    }
  }

  const repaymentAuth = {
    amount: TOTAL_DUE,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 1800),
    authorizationHash: repaymentAuthorizationHash,
  };
  const registerPaymentTx = await escrow.registerPaymentAuthorization(repaymentAuth);
  gas.push(await waitGas("registerPaymentAuthorization", registerPaymentTx));
  console.log(`registerPaymentAuthorizationTx=${registerPaymentTx.hash}`);

  await transferCreditAndFinalize({
    token: creditToken,
    tokenAddress: creditTokenAddress,
    payer: borrower,
    creditAdapter,
    creditAdapterAddress,
    authorizationHash: repaymentAuthorizationHash,
    amount: TOTAL_DUE,
    label: "repayment",
    gas,
  });

  const repayTx = await escrow.makeLoanPayment(repaymentAuth);
  gas.push(await waitGas("makeLoanPayment", repayTx));
  console.log(`makeLoanPaymentTx=${repayTx.hash}`);

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
  console.log(`borrowerBalanceHandleAfter=${await creditToken.getFunction("confidentialBalanceOf")(borrower.address)}`);
  console.log(`lenderBalanceHandleAfter=${await creditToken.getFunction("confidentialBalanceOf")(lender.address)}`);
  console.log(`lender=${lender.address}`);
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
  const transferTx = await token.connect(payer).getFunction("confidentialTransferAndCall")(
    creditAdapterAddress,
    encrypted.handle,
    encrypted.inputProof,
    ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [authorizationHash]),
  );
  gas.push(await waitGas(`${label}ConfidentialTransferAndCall`, transferTx));
  console.log(`${label}ConfidentialTransferAndCallTx=${transferTx.hash}`);

  await finalizeAdapterAcceptance({ creditAdapter, authorizationHash, label, gas });
}

async function finalizeAdapterAcceptance({
  creditAdapter,
  authorizationHash,
  label,
  gas,
}: {
  creditAdapter: ERC7984CreditAdapter;
  authorizationHash: string;
  label: string;
  gas: GasLine[];
}) {
  const authorization = await creditAdapter.getAuthorization(authorizationHash);
  const acceptanceHandle = handleToBytes32(authorization.acceptanceHandle);
  const proof = await publicDecryptBoolean(acceptanceHandle);
  console.log(`${label}Accepted=${proof.value}`);
  if (!proof.value) {
    throw new Error(`${label} transfer was not accepted by ERC7984CreditAdapter.`);
  }

  const finalizeTx = await creditAdapter.finalizeCreditAcceptance(
    authorizationHash,
    proof.value,
    proof.decryptionProof,
  );
  gas.push(await waitGas(`${label}FinalizeCreditAcceptance`, finalizeTx));
  console.log(`${label}FinalizeCreditAcceptanceTx=${finalizeTx.hash}`);
}

async function fundRoleEthIfNeeded(
  operator: SepoliaSigner,
  recipientAddress: string,
  minimum: bigint,
  topUp: bigint,
  label: string,
  gas: GasLine[],
) {
  const balance = await ethers.provider.getBalance(recipientAddress);
  console.log(`${label}BalanceBefore=${balance.toString()}`);
  if (balance >= minimum) return;

  const tx = await operator.sendTransaction({ to: recipientAddress, value: topUp });
  gas.push(await waitGas(label, tx));
  console.log(`${label}Tx=${tx.hash}`);
}

async function requireVestingRecipient(
  tokenOpsManager: Contract,
  vestingId: string,
  expectedRecipient: string,
  context: string,
) {
  const info = await tokenOpsManager.getFunction("getVestingInfo")(vestingId);
  const recipient = ethers.getAddress(info[0] as string);
  console.log(`${context}Recipient=${recipient}`);
  if (recipient !== ethers.getAddress(expectedRecipient)) {
    throw new Error(`${context}: expected vesting recipient ${expectedRecipient}, got ${recipient}.`);
  }
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

async function publicDecryptBoolean(handle: string) {
  const relayer = await relayerInstance();
  const normalizedHandle = ethers.hexlify(handle) as `0x${string}`;
  const decrypted = await relayer.publicDecrypt([normalizedHandle]);
  return {
    value: Boolean(decrypted.clearValues[normalizedHandle]),
    decryptionProof: decrypted.decryptionProof,
  };
}

async function unwrapBorrowerPrincipal({
  borrower,
  creditToken,
  creditTokenAddress,
  amount,
  gas,
}: {
  borrower: SepoliaSigner;
  creditToken: Contract;
  creditTokenAddress: string;
  amount: bigint;
  gas: GasLine[];
}) {
  const underlyingAddress = await creditToken.getFunction("underlying")();
  const underlying = new ethers.Contract(
    underlyingAddress,
    ["function balanceOf(address account) view returns (uint256)", "function symbol() view returns (string)"],
    borrower,
  );
  const underlyingBefore = BigInt(await underlying.getFunction("balanceOf")(borrower.address));
  console.log(`borrowerUnderlyingBeforeUnwrap=${underlyingBefore.toString()}`);

  const encrypted = await encryptedAmount(creditTokenAddress, borrower.address, amount);
  const unwrapTx = await creditToken.connect(borrower).getFunction("unwrap")(
    borrower.address,
    borrower.address,
    encrypted.handle,
    encrypted.inputProof,
  );
  gas.push(await waitGas("borrowerUnwrapBorrowedCredit", unwrapTx));
  console.log(`borrowerUnwrapBorrowedCreditTx=${unwrapTx.hash}`);

  const unwrapRequestId = await unwrapRequestIdFromTx(creditToken, unwrapTx);
  console.log(`borrowerUnwrapRequestId=${unwrapRequestId}`);
  const unwrapAmountHandle = await creditToken.getFunction("unwrapAmount")(unwrapRequestId);
  const proof = await publicDecryptUint64(unwrapAmountHandle);
  console.log(`borrowerPublicDecryptUnwrapAmount=${proof.value.toString()}`);
  if (proof.value !== amount) {
    throw new Error(`Expected borrower unwrap amount ${amount.toString()}, got ${proof.value.toString()}.`);
  }

  const finalizeTx = await creditToken.connect(borrower).getFunction("finalizeUnwrap")(
    unwrapRequestId,
    proof.value,
    proof.decryptionProof,
  );
  gas.push(await waitGas("borrowerFinalizeBorrowedCreditUnwrap", finalizeTx));
  console.log(`borrowerFinalizeBorrowedCreditUnwrapTx=${finalizeTx.hash}`);

  const underlyingAfter = BigInt(await underlying.getFunction("balanceOf")(borrower.address));
  const delta = underlyingAfter - underlyingBefore;
  console.log(`borrowerUnderlyingAfterUnwrap=${underlyingAfter.toString()}`);
  console.log(`borrowerUnderlyingUnwrapDelta=${delta.toString()} ${await underlying.getFunction("symbol")()}`);
  if (delta !== amount) {
    throw new Error(`Expected borrower underlying delta ${amount.toString()}, got ${delta.toString()}.`);
  }
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
      // Ignore logs from other contracts.
    }
  }
  throw new Error("UnwrapRequested event not found.");
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

function handleToBytes32(handle: bigint | string): `0x${string}` {
  return (typeof handle === "bigint" ? ethers.toBeHex(handle, 32) : ethers.hexlify(handle)) as `0x${string}`;
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

function uniqueHash(label: string, actor: string) {
  return ethers.keccak256(
    ethers.solidityPacked(["string", "address", "uint256"], [`sepolia-${label}`, actor, Date.now()]),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
