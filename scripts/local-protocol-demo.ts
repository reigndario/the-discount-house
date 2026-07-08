import hre, { ethers } from "hardhat";
import { createRequire } from "node:module";
import { TERM_FIELD_COUNT } from "../src/protocolSdk";

const BORROWER = 0;
const LENDER = 1;
const LOWER_IS_BETTER = 0;
const HIGHER_IS_BETTER = 1;
const TARGET_IS_BEST = 2;
const NORMAL = 2;
const BASE_BOND = ethers.parseEther("0.0001");
const PRINCIPAL = 100n;
const TOTAL_DUE = 108n;
const requireFromScript = createRequire(__filename);

type FhevmEnvironmentForScript = {
  isDeployed: boolean;
  setRunningInHHTest(): void;
  deploy(): Promise<void>;
};

type FhevmContextModule = {
  fhevmContext: {
    get(): FhevmEnvironmentForScript;
  };
};

function id(label: string) {
  return ethers.keccak256(ethers.toUtf8Bytes(label));
}

function ascii32(label: string) {
  return ethers.encodeBytes32String(label);
}

function handleToBytes32(handle: bigint | string): `0x${string}` {
  return (typeof handle === "bigint" ? ethers.toBeHex(handle, 32) : handle) as `0x${string}`;
}

async function latestPlus(seconds: number) {
  const block = await ethers.provider.getBlock("latest");
  if (!block) throw new Error("latest block unavailable");
  return block.timestamp + seconds;
}

async function encryptedPreferenceInput(
  bookAddress: string,
  signerAddress: string,
  metadata: {
    side: number;
    collateralToken: string;
    tokenOpsManager: string;
    principalBucket: string;
    durationBucket: string;
    expiry: number;
  },
  backingId: string,
) {
  const plainFields = [
    [100_000n, 200_000n, 150_000n, HIGHER_IS_BETTER, NORMAL],
    [80n, 120n, 100n, HIGHER_IS_BETTER, NORMAL],
    [60_000_000n, 90_000_000n, 75_000_000n, HIGHER_IS_BETTER, NORMAL],
    [500n, 800n, 500n, LOWER_IS_BETTER, NORMAL],
    [360n, 720n, 720n, HIGHER_IS_BETTER, NORMAL],
    [7n, 30n, 30n, TARGET_IS_BEST, NORMAL],
  ] as const;
  const input = hre.fhevm.createEncryptedInput(bookAddress, signerAddress);
  for (const [min, max, target, direction, priority] of plainFields) {
    input.add64(min);
    input.add64(max);
    input.add64(target);
    input.add8(direction);
    input.add8(priority);
  }
  const encrypted = await input.encrypt();
  let cursor = 0;
  const nextField = () => ({
    range: {
      min: ethers.hexlify(encrypted.handles[cursor++]),
      max: ethers.hexlify(encrypted.handles[cursor++]),
      target: ethers.hexlify(encrypted.handles[cursor++]),
    },
    direction: ethers.hexlify(encrypted.handles[cursor++]),
    priority: ethers.hexlify(encrypted.handles[cursor++]),
  });

  return {
    metadata,
    backingId,
    collateralAmount: nextField(),
    principal: nextField(),
    collateralTokenPriceE8: nextField(),
    interestBps: nextField(),
    durationDays: nextField(),
    gracePeriodDays: nextField(),
    inputProof: ethers.hexlify(encrypted.inputProof),
  };
}

async function main() {
  await initializeFhevmForScript();

  const [deployer, borrower, lender, taker, relayer, treasury] = await ethers.getSigners();
  const summary: string[] = [];

  const preferenceBook = await (await ethers.getContractFactory("ConfidentialPreferenceBook")).deploy();
  const negotiationEngine = await (await ethers.getContractFactory("NashNegotiationEngine")).deploy(preferenceBook);
  await preferenceBook.setAuthorizedMatcher(await negotiationEngine.getAddress());
  const vestingAdapter = await (await ethers.getContractFactory("TokenOpsVestingAdapter")).deploy();
  const vestingManager = await (await ethers.getContractFactory("MockTokenOpsVestingManager")).deploy();
  const creditAdapter = await (await ethers.getContractFactory("MockConfidentialCreditAdapter")).deploy();
  const loanFactory = await (await ethers.getContractFactory("LoanEscrowFactory")).deploy();
  const bondManager = await (
    await ethers.getContractFactory("BondManager")
  ).deploy(treasury.address, {
    baseBondWei: BASE_BOND,
    configuredMinBatchSize: 1,
    treasuryShareBps: 2_000,
    thinMarketPenaltyBps: 1_000,
    failedAttemptCooldownSeconds: 300,
  });
  const coordinator = await (
    await ethers.getContractFactory("MatchSettlementCoordinator")
  ).deploy(bondManager, negotiationEngine, loanFactory);
  await bondManager.setAuthorizedSettler(await coordinator.getAddress(), true);

  summary.push(`PreferenceBook ${await preferenceBook.getAddress()}`);
  summary.push(`NegotiationEngine ${await negotiationEngine.getAddress()}`);
  summary.push(`BondManager ${await bondManager.getAddress()}`);
  summary.push(`SettlementCoordinator ${await coordinator.getAddress()}`);

  const expiry = await latestPlus(3600);
  const metadataBase = {
    collateralToken: await vestingManager.getAddress(),
    tokenOpsManager: await vestingManager.getAddress(),
    principalBucket: ascii32("P<000150"),
    durationBucket: ascii32("D<000720"),
    expiry,
  };
  const bookAddress = await preferenceBook.getAddress();
  const borrowerInput = await encryptedPreferenceInput(
    bookAddress,
    borrower.address,
    { ...metadataBase, side: BORROWER },
    id("demo:borrower-backing"),
  );
  const lenderInput = await encryptedPreferenceInput(
    bookAddress,
    lender.address,
    { ...metadataBase, side: LENDER },
    id("demo:lender-backing"),
  );

  const borrowerPreferenceId = await preferenceBook.connect(borrower).createPreferenceBundle.staticCall(borrowerInput);
  await preferenceBook.connect(borrower).createPreferenceBundle(borrowerInput);
  const lenderPreferenceId = await preferenceBook.connect(lender).createPreferenceBundle.staticCall(lenderInput);
  await preferenceBook.connect(lender).createPreferenceBundle(lenderInput);
  const backingVestingId = id("demo:pre-match-vesting");
  const vestingManagerAddress = await vestingManager.getAddress();
  const vestingAdapterAddress = await vestingAdapter.getAddress();
  await vestingManager.seedVesting(backingVestingId, borrower.address);
  await vestingManager.connect(borrower).initiateVestingTransfer(backingVestingId, vestingAdapterAddress, 86_400);
  await vestingAdapter
    .connect(relayer)
    .acceptPendingVestingTransfer(vestingManagerAddress, backingVestingId, borrower.address);
  await preferenceBook
    .connect(borrower)
    .registerBorrowerBacking(borrowerInput.backingId, vestingManagerAddress, vestingAdapterAddress, backingVestingId);
  const lenderCommitmentHash = id("demo:lender-credit-commitment");
  await creditAdapter.connect(lender).registerLenderCreditCommitment(lenderCommitmentHash, lender.address, expiry);
  await creditAdapter.connect(lender).authorizeCredit(lenderCommitmentHash, lender.address, PRINCIPAL);
  await preferenceBook
    .connect(lender)
    .registerLenderBacking(lenderInput.backingId, await creditAdapter.getAddress(), lenderCommitmentHash, expiry);
  await preferenceBook.connect(borrower).activateBacking(borrowerInput.backingId);
  await preferenceBook.connect(lender).activateBacking(lenderInput.backingId);
  summary.push(`BorrowerPreference ${borrowerPreferenceId}`);
  summary.push(`LenderPreference ${lenderPreferenceId}`);

  const requiredBond = await bondManager.quoteBond(1, 1);
  const bondAttemptId = await bondManager.connect(taker).postBond.staticCall(id("demo:taker"), 1, 1, {
    value: requiredBond,
  });
  await bondManager.connect(taker).postBond(id("demo:taker"), 1, 1, { value: requiredBond });
  summary.push(`BondAttempt ${bondAttemptId}`);

  const matchAttemptId = await negotiationEngine
    .connect(relayer)
    .executeMatch.staticCall(borrowerPreferenceId, [lenderPreferenceId]);
  await negotiationEngine.connect(relayer).executeMatch(borrowerPreferenceId, [lenderPreferenceId]);
  let matchAttempt = await negotiationEngine.getAttempt(matchAttemptId);
  summary.push(`MatchAttempt ${matchAttemptId}`);
  for (let fieldIndex = 0; fieldIndex < TERM_FIELD_COUNT; fieldIndex++) {
    await negotiationEngine.connect(relayer).computeSelectedTerm(matchAttemptId, fieldIndex);
  }
  await negotiationEngine.connect(relayer).commitEncryptedTerms(matchAttemptId);
  matchAttempt = await negotiationEngine.getAttempt(matchAttemptId);
  summary.push(`TermsHash ${matchAttempt.termsHash}`);
  summary.push(`EncryptedTermsHash ${matchAttempt.encryptedTermsHash}`);
  const encryptedTerms = await negotiationEngine.getEncryptedTerms(matchAttemptId);
  const feasibleHandle = handleToBytes32(encryptedTerms.feasible);
  const decryptedFeasibility = await hre.fhevm.publicDecrypt([feasibleHandle]);
  const feasible = Boolean(decryptedFeasibility.clearValues[feasibleHandle]);
  await negotiationEngine
    .connect(relayer)
    .finalizeMatchFeasibility(matchAttemptId, feasible, decryptedFeasibility.decryptionProof);
  matchAttempt = await negotiationEngine.getAttempt(matchAttemptId);
  summary.push(`MatchFinalized ${matchAttempt.status}`);

  const now = await latestPlus(0);
  const fundingCommitmentHash = lenderCommitmentHash;
  const fundingAuthorizationHash = id("demo:funding-draw");
  const repaymentAuthorizationHash = id("demo:repayment");
  const loanConfig = {
    borrower: borrower.address,
    lender: lender.address,
    vestingAdapter: vestingAdapterAddress,
    creditAdapter: await creditAdapter.getAddress(),
    tokenOpsManager: vestingManagerAddress,
    vestingId: backingVestingId,
    dueTimestamp: now + 30 * 24 * 60 * 60,
    gracePeriodSeconds: 7 * 24 * 60 * 60,
    activationDeadline: now + 24 * 60 * 60,
    fundingCommitmentHash,
    fundingAuthorizationHash,
    repaymentAuthorizationHash,
    termsHash: matchAttempt.termsHash,
    encryptedTermsHash: matchAttempt.encryptedTermsHash,
  };

  const [loanId, escrowAddress] = await coordinator
    .connect(relayer)
    .settleSuccessfulMatch.staticCall(bondAttemptId, matchAttemptId, loanConfig);
  await coordinator.connect(relayer).settleSuccessfulMatch(bondAttemptId, matchAttemptId, loanConfig);
  const escrow = await ethers.getContractAt("LoanEscrow", escrowAddress);
  summary.push(`Loan ${loanId}`);
  summary.push(`Escrow ${escrowAddress}`);

  await escrow.connect(relayer).registerVestingCollateral();
  const pledgeId = await escrow.pledgeId();

  await escrow.connect(relayer).registerFundingAuthorization({
    amount: PRINCIPAL,
    deadline: await latestPlus(3600),
    authorizationHash: fundingAuthorizationHash,
  });
  await escrow.connect(relayer).escrowFunding({
    amount: PRINCIPAL,
    deadline: await latestPlus(3600),
    authorizationHash: fundingAuthorizationHash,
  });
  await escrow.connect(relayer).activate();
  summary.push("LoanActivated true");

  await creditAdapter.authorizeCredit(repaymentAuthorizationHash, borrower.address, TOTAL_DUE);
  await escrow.connect(relayer).registerPaymentAuthorization({
    amount: TOTAL_DUE,
    deadline: await latestPlus(3600),
    authorizationHash: repaymentAuthorizationHash,
  });
  await escrow.connect(relayer).makeLoanPayment({
    amount: TOTAL_DUE,
    deadline: await latestPlus(3600),
    authorizationHash: repaymentAuthorizationHash,
  });
  await vestingManager.connect(borrower).acceptVestingTransfer(backingVestingId);
  await vestingAdapter.connect(relayer).completeRelease(pledgeId);
  summary.push(`FinalState ${(await escrow.state()).toString()}`);
  summary.push("CollateralReleaseFinalized true");

  const vestingInfo = await vestingManager.getVestingInfo(backingVestingId);
  summary.push(`ReleasedTo ${vestingInfo.recipient}`);
  summary.push(`Deployer ${deployer.address}`);

  console.log("Confidential Vesting Credit local protocol demo");
  for (const line of summary) console.log(line);
}

async function initializeFhevmForScript() {
  if (hre.network.name !== "hardhat") {
    await hre.fhevm.initializeCLIApi();
    return;
  }

  const pluginPackagePath = requireFromScript.resolve("@fhevm/hardhat-plugin/package.json");
  const environmentExtenderPath = pluginPackagePath.replace("package.json", "internal/EnvironmentExtender.js");
  const { fhevmContext } = requireFromScript(environmentExtenderPath) as FhevmContextModule;
  const fhevmEnvironment = fhevmContext.get();
  if (fhevmEnvironment.isDeployed) return;

  fhevmEnvironment.setRunningInHHTest();
  await fhevmEnvironment.deploy();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
