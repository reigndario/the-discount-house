import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import hre, { ethers } from "hardhat";
import { expect } from "chai";
import {
  BondManager,
  BondManager__factory,
  ConfidentialPreferenceBook,
  ConfidentialPreferenceBook__factory,
  LoanEscrowFactory,
  LoanEscrowFactory__factory,
  MatchSettlementCoordinator,
  MatchSettlementCoordinator__factory,
  MockConfidentialCreditAdapter,
  MockConfidentialCreditAdapter__factory,
  MockTokenOpsVestingManager,
  MockTokenOpsVestingManager__factory,
  NashNegotiationEngine,
  NashNegotiationEngine__factory,
  TokenOpsVestingAdapter,
  TokenOpsVestingAdapter__factory,
} from "../types";
import { TERM_FIELD_COUNT } from "../src/protocolSdk";
import { LENDER, createEncryptedBundle, id } from "./EncryptedPreferenceHelpers";

type Signers = {
  borrower: HardhatEthersSigner;
  lender: HardhatEthersSigner;
  taker: HardhatEthersSigner;
  relayer: HardhatEthersSigner;
  treasury: HardhatEthersSigner;
};

const BASE_BOND = ethers.parseEther("0.1");

async function deployFixture(signers: Signers) {
  const bookFactory = (await ethers.getContractFactory(
    "ConfidentialPreferenceBook",
  )) as ConfidentialPreferenceBook__factory;
  const book = (await bookFactory.deploy()) as ConfidentialPreferenceBook;
  const engineFactory = (await ethers.getContractFactory("NashNegotiationEngine")) as NashNegotiationEngine__factory;
  const engine = (await engineFactory.deploy(book)) as NashNegotiationEngine;
  await book.setAuthorizedMatcher(await engine.getAddress());

  const vestingManagerFactory = (await ethers.getContractFactory(
    "MockTokenOpsVestingManager",
  )) as MockTokenOpsVestingManager__factory;
  const vestingManager = (await vestingManagerFactory.deploy()) as MockTokenOpsVestingManager;
  const vestingAdapterFactory = (await ethers.getContractFactory(
    "TokenOpsVestingAdapter",
  )) as TokenOpsVestingAdapter__factory;
  const vestingAdapter = (await vestingAdapterFactory.deploy()) as TokenOpsVestingAdapter;
  const creditAdapterFactory = (await ethers.getContractFactory(
    "MockConfidentialCreditAdapter",
  )) as MockConfidentialCreditAdapter__factory;
  const creditAdapter = (await creditAdapterFactory.deploy()) as MockConfidentialCreditAdapter;
  const loanFactoryFactory = (await ethers.getContractFactory("LoanEscrowFactory")) as LoanEscrowFactory__factory;
  const loanFactory = (await loanFactoryFactory.deploy()) as LoanEscrowFactory;
  const bondFactory = (await ethers.getContractFactory("BondManager")) as BondManager__factory;
  const bondManager = (await bondFactory.deploy(signers.treasury.address, {
    baseBondWei: BASE_BOND,
    configuredMinBatchSize: 1,
    treasuryShareBps: 2_000,
    thinMarketPenaltyBps: 1_000,
    failedAttemptCooldownSeconds: 300,
  })) as BondManager;
  const coordinatorFactory = (await ethers.getContractFactory(
    "MatchSettlementCoordinator",
  )) as MatchSettlementCoordinator__factory;
  const coordinator = (await coordinatorFactory.deploy(bondManager, engine, loanFactory)) as MatchSettlementCoordinator;
  await bondManager.setAuthorizedSettler(await coordinator.getAddress(), true);

  return { book, engine, vestingManager, vestingAdapter, creditAdapter, loanFactory, bondManager, coordinator };
}

async function loanConfig(
  signers: Signers,
  vestingManager: MockTokenOpsVestingManager,
  vestingAdapter: TokenOpsVestingAdapter,
  creditAdapter: MockConfidentialCreditAdapter,
  termsHash: string,
  encryptedTermsHash: string,
  fundingCommitmentHash = id("settlement-funding-commitment"),
  vestingId = id("settlement-vesting"),
) {
  const now = Number(await time.latest());
  return {
    borrower: signers.borrower.address,
    lender: signers.lender.address,
    vestingAdapter: await vestingAdapter.getAddress(),
    creditAdapter: await creditAdapter.getAddress(),
    tokenOpsManager: await vestingManager.getAddress(),
    vestingId,
    dueTimestamp: now + 3600,
    gracePeriodSeconds: 300,
    activationDeadline: now + 900,
    fundingCommitmentHash,
    fundingAuthorizationHash: id("settlement-funding-auth"),
    repaymentAuthorizationHash: id("settlement-repayment-auth"),
    termsHash,
    encryptedTermsHash,
  };
}

async function registerBorrowerBacking(
  book: ConfidentialPreferenceBook,
  vestingManager: MockTokenOpsVestingManager,
  vestingAdapter: TokenOpsVestingAdapter,
  manager: HardhatEthersSigner,
  input: Awaited<ReturnType<typeof createEncryptedBundle>>["input"],
) {
  const vestingId = id(`vesting:${input.backingId}`);
  const vestingManagerAddress = await vestingManager.getAddress();
  const vestingAdapterAddress = await vestingAdapter.getAddress();
  await vestingManager.seedVesting(vestingId, manager.address);
  await vestingManager.connect(manager).initiateVestingTransfer(vestingId, vestingAdapterAddress, 86_400);
  await vestingAdapter.acceptPendingVestingTransfer(vestingManagerAddress, vestingId, manager.address);
  await book
    .connect(manager)
    .registerBorrowerBacking(input.backingId, input.metadata.tokenOpsManager, vestingAdapterAddress, vestingId);
}

async function registerLenderBacking(
  book: ConfidentialPreferenceBook,
  creditAdapter: MockConfidentialCreditAdapter,
  manager: HardhatEthersSigner,
  input: Awaited<ReturnType<typeof createEncryptedBundle>>["input"],
) {
  const commitmentHash = id(`credit:${input.backingId}`);
  const expiry = Number(await time.latest()) + 3600;
  await creditAdapter.connect(manager).registerLenderCreditCommitment(commitmentHash, manager.address, expiry);
  await creditAdapter.connect(manager).authorizeCredit(commitmentHash, manager.address, 100_000n);
  await book
    .connect(manager)
    .registerLenderBacking(input.backingId, await creditAdapter.getAddress(), commitmentHash, expiry);
  return commitmentHash;
}

function handleToBytes32(handle: bigint | string): `0x${string}` {
  return (typeof handle === "bigint" ? ethers.toBeHex(handle, 32) : handle) as `0x${string}`;
}

async function computeAllTerms(engine: NashNegotiationEngine, attemptId: string) {
  for (let fieldIndex = 0; fieldIndex < TERM_FIELD_COUNT; fieldIndex++) {
    await engine.computeSelectedTerm(attemptId, fieldIndex);
  }
  await engine.commitEncryptedTerms(attemptId);
}

async function finalizeFeasibility(engine: NashNegotiationEngine, attemptId: string) {
  await computeAllTerms(engine, attemptId);
  const encryptedTerms = await engine.getEncryptedTerms(attemptId);
  const feasibleHandle = handleToBytes32(encryptedTerms.feasible);
  const decrypted = await hre.fhevm.publicDecrypt([feasibleHandle]);
  const feasible = Boolean(decrypted.clearValues[feasibleHandle]);
  await engine.finalizeMatchFeasibility(attemptId, feasible, decrypted.decryptionProof);
}

describe("MatchSettlementCoordinator", function () {
  let signers: Signers;

  before(async function () {
    const ethSigners = await ethers.getSigners();
    signers = {
      borrower: ethSigners[1],
      lender: ethSigners[2],
      taker: ethSigners[3],
      relayer: ethSigners[4],
      treasury: ethSigners[5],
    };
  });

  it("settles an executed successful match into a loan escrow and refunds the taker bond", async function () {
    const { book, engine, vestingManager, vestingAdapter, creditAdapter, bondManager, coordinator } =
      await deployFixture(signers);
    const { input: borrowerInput, preferenceId: borrowerPreferenceId } = await createEncryptedBundle(
      book,
      signers.borrower,
      {
        collateralToken: await vestingManager.getAddress(),
        tokenOpsManager: await vestingManager.getAddress(),
        backingId: id("borrower-backing"),
      },
    );
    const { input: lenderInput, preferenceId: lenderPreferenceId } = await createEncryptedBundle(book, signers.lender, {
      side: LENDER,
      collateralToken: borrowerInput.metadata.collateralToken,
      tokenOpsManager: borrowerInput.metadata.tokenOpsManager,
      principalBucket: borrowerInput.metadata.principalBucket,
      durationBucket: borrowerInput.metadata.durationBucket,
      backingId: id("lender-backing"),
    });
    await registerBorrowerBacking(book, vestingManager, vestingAdapter, signers.borrower, borrowerInput);
    const lenderCommitmentHash = await registerLenderBacking(book, creditAdapter, signers.lender, lenderInput);
    await book.connect(signers.borrower).activateBacking(borrowerInput.backingId);
    await book.connect(signers.lender).activateBacking(lenderInput.backingId);

    const bondAttemptId = await bondManager
      .connect(signers.taker)
      .postBond.staticCall(id("taker"), 1, 1, { value: BASE_BOND });
    await bondManager.connect(signers.taker).postBond(id("taker"), 1, 1, { value: BASE_BOND });
    const matchAttemptId = await engine
      .connect(signers.relayer)
      .executeMatch.staticCall(borrowerPreferenceId, [lenderPreferenceId]);
    await engine.connect(signers.relayer).executeMatch(borrowerPreferenceId, [lenderPreferenceId]);
    await finalizeFeasibility(engine.connect(signers.relayer), matchAttemptId);
    const attempt = await engine.getAttempt(matchAttemptId);
    const config = await loanConfig(
      signers,
      vestingManager,
      vestingAdapter,
      creditAdapter,
      attempt.termsHash,
      attempt.encryptedTermsHash,
      lenderCommitmentHash,
      id(`vesting:${borrowerInput.backingId}`),
    );

    await expect(coordinator.connect(signers.relayer).settleSuccessfulMatch(bondAttemptId, matchAttemptId, config))
      .to.emit(coordinator, "MatchSettlementSucceeded")
      .and.to.emit(bondManager, "BondRefunded");
  });

  it("rejects loan configs that do not match the executed terms commitment", async function () {
    const { book, engine, vestingManager, vestingAdapter, creditAdapter, bondManager, coordinator } =
      await deployFixture(signers);
    const { input: borrowerInput, preferenceId: borrowerPreferenceId } = await createEncryptedBundle(
      book,
      signers.borrower,
      {
        collateralToken: await vestingManager.getAddress(),
        tokenOpsManager: await vestingManager.getAddress(),
      },
    );
    const { input: lenderInput, preferenceId: lenderPreferenceId } = await createEncryptedBundle(book, signers.lender, {
      side: LENDER,
      collateralToken: borrowerInput.metadata.collateralToken,
      tokenOpsManager: borrowerInput.metadata.tokenOpsManager,
      principalBucket: borrowerInput.metadata.principalBucket,
      durationBucket: borrowerInput.metadata.durationBucket,
      backingId: id("lender-config"),
    });
    await registerBorrowerBacking(book, vestingManager, vestingAdapter, signers.borrower, borrowerInput);
    const lenderCommitmentHash = await registerLenderBacking(book, creditAdapter, signers.lender, lenderInput);
    await book.connect(signers.borrower).activateBacking(borrowerInput.backingId);
    await book.connect(signers.lender).activateBacking(lenderInput.backingId);
    const bondAttemptId = await bondManager
      .connect(signers.taker)
      .postBond.staticCall(id("bad-config"), 1, 1, { value: BASE_BOND });
    await bondManager.connect(signers.taker).postBond(id("bad-config"), 1, 1, { value: BASE_BOND });
    const matchAttemptId = await engine.executeMatch.staticCall(borrowerPreferenceId, [lenderPreferenceId]);
    await engine.executeMatch(borrowerPreferenceId, [lenderPreferenceId]);
    await finalizeFeasibility(engine, matchAttemptId);
    const config = await loanConfig(
      signers,
      vestingManager,
      vestingAdapter,
      creditAdapter,
      id("wrong-terms"),
      (await engine.getAttempt(matchAttemptId)).encryptedTermsHash,
      lenderCommitmentHash,
    );

    await expect(
      coordinator.settleSuccessfulMatch(bondAttemptId, matchAttemptId, config),
    ).to.be.revertedWithCustomError(coordinator, "LoanConfigMismatch");
  });

  it("rejects loan configs whose participants do not match the preference managers", async function () {
    const { book, engine, vestingManager, vestingAdapter, creditAdapter, bondManager, coordinator } =
      await deployFixture(signers);
    const { input: borrowerInput, preferenceId: borrowerPreferenceId } = await createEncryptedBundle(
      book,
      signers.borrower,
      {
        collateralToken: await vestingManager.getAddress(),
        tokenOpsManager: await vestingManager.getAddress(),
      },
    );
    const { input: lenderInput, preferenceId: lenderPreferenceId } = await createEncryptedBundle(book, signers.lender, {
      side: LENDER,
      collateralToken: borrowerInput.metadata.collateralToken,
      tokenOpsManager: borrowerInput.metadata.tokenOpsManager,
      principalBucket: borrowerInput.metadata.principalBucket,
      durationBucket: borrowerInput.metadata.durationBucket,
      backingId: id("lender-participant-mismatch"),
    });
    await registerBorrowerBacking(book, vestingManager, vestingAdapter, signers.borrower, borrowerInput);
    const lenderCommitmentHash = await registerLenderBacking(book, creditAdapter, signers.lender, lenderInput);
    await book.connect(signers.borrower).activateBacking(borrowerInput.backingId);
    await book.connect(signers.lender).activateBacking(lenderInput.backingId);
    const bondAttemptId = await bondManager
      .connect(signers.taker)
      .postBond.staticCall(id("participant-mismatch"), 1, 1, { value: BASE_BOND });
    await bondManager.connect(signers.taker).postBond(id("participant-mismatch"), 1, 1, { value: BASE_BOND });
    const matchAttemptId = await engine.executeMatch.staticCall(borrowerPreferenceId, [lenderPreferenceId]);
    await engine.executeMatch(borrowerPreferenceId, [lenderPreferenceId]);
    await finalizeFeasibility(engine, matchAttemptId);
    const attempt = await engine.getAttempt(matchAttemptId);
    const config = await loanConfig(
      signers,
      vestingManager,
      vestingAdapter,
      creditAdapter,
      attempt.termsHash,
      attempt.encryptedTermsHash,
      lenderCommitmentHash,
    );

    await expect(
      coordinator.settleSuccessfulMatch(bondAttemptId, matchAttemptId, {
        ...config,
        borrower: signers.taker.address,
      }),
    ).to.be.revertedWithCustomError(coordinator, "LoanParticipantMismatch");
  });

  it("settles finalized infeasible matches by slashing the taker bond", async function () {
    const { book, engine, vestingManager, vestingAdapter, creditAdapter, bondManager, coordinator } =
      await deployFixture(signers);
    const { input: borrowerInput, preferenceId: borrowerPreferenceId } = await createEncryptedBundle(
      book,
      signers.borrower,
      {
        collateralToken: await vestingManager.getAddress(),
        tokenOpsManager: await vestingManager.getAddress(),
        principal: { min: 75_000, max: 100_000, target: 90_000 },
      },
    );
    const { input: lenderInput, preferenceId: lenderPreferenceId } = await createEncryptedBundle(book, signers.lender, {
      side: LENDER,
      collateralToken: borrowerInput.metadata.collateralToken,
      tokenOpsManager: borrowerInput.metadata.tokenOpsManager,
      principalBucket: borrowerInput.metadata.principalBucket,
      durationBucket: borrowerInput.metadata.durationBucket,
      backingId: id("failed-settlement-lender"),
      principal: { min: 125_000, max: 150_000, target: 130_000 },
    });
    await registerBorrowerBacking(book, vestingManager, vestingAdapter, signers.borrower, borrowerInput);
    await registerLenderBacking(book, creditAdapter, signers.lender, lenderInput);
    await book.connect(signers.borrower).activateBacking(borrowerInput.backingId);
    await book.connect(signers.lender).activateBacking(lenderInput.backingId);

    const bondAttemptId = await bondManager
      .connect(signers.taker)
      .postBond.staticCall(id("failed-match"), 1, 1, { value: BASE_BOND });
    await bondManager.connect(signers.taker).postBond(id("failed-match"), 1, 1, { value: BASE_BOND });
    const matchAttemptId = await engine
      .connect(signers.relayer)
      .executeMatch.staticCall(borrowerPreferenceId, [lenderPreferenceId]);
    await engine.connect(signers.relayer).executeMatch(borrowerPreferenceId, [lenderPreferenceId]);
    await finalizeFeasibility(engine.connect(signers.relayer), matchAttemptId);

    await expect(
      coordinator.connect(signers.relayer).settleFailedMatch(bondAttemptId, matchAttemptId, [signers.lender.address]),
    )
      .to.emit(coordinator, "MatchSettlementFailed")
      .and.to.emit(bondManager, "BondSlashed");

    expect((await bondManager.getAttempt(bondAttemptId)).status).to.equal(3n);
    expect(await bondManager.takerCooldownUntil(signers.taker.address)).to.be.greaterThan(0n);
  });
});
