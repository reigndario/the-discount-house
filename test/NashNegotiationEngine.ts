import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import hre, { ethers } from "hardhat";
import { expect } from "chai";
import {
  ConfidentialPreferenceBook,
  ConfidentialPreferenceBook__factory,
  NashNegotiationEngine,
  NashNegotiationEngine__factory,
  MockConfidentialCreditAdapter,
  MockTokenOpsVestingManager,
  TokenOpsVestingAdapter,
} from "../types";
import { TERM_FIELD_COUNT } from "../src/protocolSdk";
import {
  BORROWER,
  HIGHER_IS_BETTER,
  LENDER,
  LOWER_IS_BETTER,
  TARGET_IS_BEST,
  ascii32,
  createEncryptedBundle,
  id,
} from "./EncryptedPreferenceHelpers";

type Signers = {
  borrowerManager: HardhatEthersSigner;
  lenderManager: HardhatEthersSigner;
  secondLenderManager: HardhatEthersSigner;
  relayer: HardhatEthersSigner;
};

async function deployFixture() {
  const bookFactory = (await ethers.getContractFactory(
    "ConfidentialPreferenceBook",
  )) as ConfidentialPreferenceBook__factory;
  const book = (await bookFactory.deploy()) as ConfidentialPreferenceBook;
  const engineFactory = (await ethers.getContractFactory("NashNegotiationEngine")) as NashNegotiationEngine__factory;
  const engine = (await engineFactory.deploy(book)) as NashNegotiationEngine;
  await book.setAuthorizedMatcher(await engine.getAddress());
  const vestingManager = (await (
    await ethers.getContractFactory("MockTokenOpsVestingManager")
  ).deploy()) as MockTokenOpsVestingManager;
  const vestingAdapter = (await (
    await ethers.getContractFactory("TokenOpsVestingAdapter")
  ).deploy()) as TokenOpsVestingAdapter;
  const creditAdapter = (await (
    await ethers.getContractFactory("MockConfidentialCreditAdapter")
  ).deploy()) as MockConfidentialCreditAdapter;

  return { book, engine, vestingManager, vestingAdapter, creditAdapter };
}

function handleToBytes32(handle: bigint | string): `0x${string}` {
  return (typeof handle === "bigint" ? ethers.toBeHex(handle, 32) : handle) as `0x${string}`;
}

async function feasibilityProof(engine: NashNegotiationEngine, attemptId: string) {
  const encryptedTerms = await engine.getEncryptedTerms(attemptId);
  const feasibleHandle = handleToBytes32(encryptedTerms.feasible);
  const decrypted = await hre.fhevm.publicDecrypt([feasibleHandle]);
  const feasible = Boolean(decrypted.clearValues[feasibleHandle]);
  return { feasible, decryptionProof: decrypted.decryptionProof };
}

async function computeAllTerms(engine: NashNegotiationEngine, attemptId: string) {
  for (let fieldIndex = 0; fieldIndex < TERM_FIELD_COUNT; fieldIndex++) {
    await engine.computeSelectedTerm(attemptId, fieldIndex);
  }
  await engine.commitEncryptedTerms(attemptId);
}

async function decryptEuint64(handle: bigint | string) {
  return hre.fhevm.debugger.decryptEuint(FhevmType.euint64, handleToBytes32(handle));
}

describe("NashNegotiationEngine", function () {
  let signers: Signers;
  let book: ConfidentialPreferenceBook;
  let engine: NashNegotiationEngine;
  let vestingManager: MockTokenOpsVestingManager;
  let vestingAdapter: TokenOpsVestingAdapter;
  let creditAdapter: MockConfidentialCreditAdapter;

  before(async function () {
    const ethSigners = await ethers.getSigners();
    signers = {
      borrowerManager: ethSigners[1],
      lenderManager: ethSigners[2],
      secondLenderManager: ethSigners[3],
      relayer: ethSigners[4],
    };
  });

  beforeEach(async function () {
    ({ book, engine, vestingManager, vestingAdapter, creditAdapter } = await deployFixture());
  });

  async function registerBorrowerBacking(
    input: Awaited<ReturnType<typeof createEncryptedBundle>>["input"],
    manager: HardhatEthersSigner,
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
    input: Awaited<ReturnType<typeof createEncryptedBundle>>["input"],
    manager: HardhatEthersSigner,
  ) {
    const commitmentHash = id(`credit:${input.backingId}`);
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    await creditAdapter.connect(manager).registerLenderCreditCommitment(commitmentHash, manager.address, expiry);
    await creditAdapter.connect(manager).authorizeCredit(commitmentHash, manager.address, 100_000n);
    await book
      .connect(manager)
      .registerLenderBacking(input.backingId, await creditAdapter.getAddress(), commitmentHash, expiry);
  }

  it("executes matching without a free preview and chooses the oldest executable candidate", async function () {
    const principalBucket = ascii32("P<150000");
    const durationBucket = ascii32("D<000720");
    const collateralToken = await vestingManager.getAddress();
    const tokenOpsManager = await vestingManager.getAddress();
    const { input: borrowerInput, preferenceId: borrowerPreferenceId } = await createEncryptedBundle(
      book,
      signers.borrowerManager,
      { side: BORROWER, principalBucket, durationBucket, collateralToken, tokenOpsManager, backingId: id("borrower") },
    );
    const { input: olderLenderInput, preferenceId: olderLenderPreferenceId } = await createEncryptedBundle(
      book,
      signers.lenderManager,
      {
        side: LENDER,
        principalBucket,
        durationBucket,
        collateralToken,
        tokenOpsManager,
        backingId: id("older-lender"),
      },
    );
    const { input: newerLenderInput, preferenceId: newerLenderPreferenceId } = await createEncryptedBundle(
      book,
      signers.secondLenderManager,
      {
        side: LENDER,
        principalBucket,
        durationBucket,
        collateralToken,
        tokenOpsManager,
        backingId: id("newer-lender"),
      },
    );

    await registerBorrowerBacking(borrowerInput, signers.borrowerManager);
    await registerLenderBacking(olderLenderInput, signers.lenderManager);
    await registerLenderBacking(newerLenderInput, signers.secondLenderManager);
    await book.connect(signers.borrowerManager).activateBacking(borrowerInput.backingId);
    await book.connect(signers.lenderManager).activateBacking(olderLenderInput.backingId);
    await book.connect(signers.secondLenderManager).activateBacking(newerLenderInput.backingId);

    const attemptId = await engine
      .connect(signers.relayer)
      .executeMatch.staticCall(borrowerPreferenceId, [newerLenderPreferenceId, olderLenderPreferenceId]);
    await expect(
      engine
        .connect(signers.relayer)
        .executeMatch(borrowerPreferenceId, [newerLenderPreferenceId, olderLenderPreferenceId]),
    ).to.emit(engine, "MatchAttempted");

    const attempt = await engine.getAttempt(attemptId);
    expect(attempt.caller).to.equal(signers.relayer.address);
    expect(attempt.makerPreferenceId).to.equal(olderLenderPreferenceId);
    expect(attempt.status).to.equal(3n);
    expect(attempt.termsHash).to.equal(ethers.ZeroHash);
    expect(attempt.encryptedTermsHash).to.equal(ethers.ZeroHash);
    expect(await engine.computedTermMask(attemptId)).to.equal(0n);

    await expect(engine.connect(signers.relayer).computeSelectedTerm(attemptId, 0)).to.emit(
      engine,
      "MatchTermComputed",
    );
    for (let fieldIndex = 1; fieldIndex < 5; fieldIndex++) {
      await engine.connect(signers.relayer).computeSelectedTerm(attemptId, fieldIndex);
    }
    await expect(engine.connect(signers.relayer).computeSelectedTerm(attemptId, 5)).to.emit(
      engine,
      "MatchTermComputed",
    );
    await expect(engine.connect(signers.relayer).commitEncryptedTerms(attemptId))
      .to.emit(engine, "EncryptedTermsCommitted")
      .and.to.emit(engine, "MatchFinalizationRequested");
    expect(await engine.computedTermMask(attemptId)).to.equal(0x3fn);
    const committedAttempt = await engine.getAttempt(attemptId);
    expect(committedAttempt.termsHash).to.not.equal(ethers.ZeroHash);
    expect(committedAttempt.encryptedTermsHash).to.not.equal(ethers.ZeroHash);

    const encryptedTerms = await engine.getEncryptedTerms(attemptId);
    expect(encryptedTerms.collateralAmount).to.not.equal(0n);
    expect(encryptedTerms.principal).to.not.equal(0n);
    expect(encryptedTerms.collateralTokenPriceE8).to.not.equal(0n);
    expect(encryptedTerms.interestBps).to.not.equal(0n);
    expect(encryptedTerms.durationDays).to.not.equal(0n);
    expect(encryptedTerms.gracePeriodDays).to.not.equal(0n);
    expect(encryptedTerms.feasible).to.not.equal(0n);
    expect(await book.getBucketPreferenceIds(await book.bucketKey(borrowerInput.metadata))).to.have.length(1);
    expect(await book.getBucketPreferenceIds(await book.bucketKey(olderLenderInput.metadata))).to.have.length(2);
    expect(await engine.isPreferenceLocked(borrowerPreferenceId)).to.equal(true);
    expect(await engine.isPreferenceLocked(olderLenderPreferenceId)).to.equal(true);

    const proof = await feasibilityProof(engine, attemptId);
    expect(proof.feasible).to.equal(true);
    await expect(
      engine.connect(signers.relayer).finalizeMatchFeasibility(attemptId, proof.feasible, proof.decryptionProof),
    ).to.emit(engine, "MatchSucceeded");
    const finalizedAttempt = await engine.getAttempt(attemptId);
    expect(finalizedAttempt.status).to.equal(1n);
    expect(await book.getBucketPreferenceIds(await book.bucketKey(borrowerInput.metadata))).to.have.length(0);
    expect(await book.getBucketPreferenceIds(await book.bucketKey(olderLenderInput.metadata))).to.have.length(1);
    expect(await engine.isPreferenceLocked(borrowerPreferenceId)).to.equal(false);
    expect(await engine.isPreferenceLocked(olderLenderPreferenceId)).to.equal(false);
  });

  it("requires executable taker backing before answering exact matching", async function () {
    const { preferenceId: borrowerPreferenceId } = await createEncryptedBundle(book, signers.borrowerManager);

    await expect(engine.connect(signers.relayer).executeMatch(borrowerPreferenceId, [ethers.ZeroHash]))
      .to.be.revertedWithCustomError(engine, "PreferenceNotExecutable")
      .withArgs(borrowerPreferenceId);
  });

  it("selects finite candidate terms using encrypted targets and priorities", async function () {
    const principalBucket = ascii32("P<150000");
    const durationBucket = ascii32("D<000720");
    const collateralToken = await vestingManager.getAddress();
    const tokenOpsManager = await vestingManager.getAddress();
    const { input: borrowerInput, preferenceId: borrowerPreferenceId } = await createEncryptedBundle(
      book,
      signers.borrowerManager,
      {
        side: BORROWER,
        principalBucket,
        durationBucket,
        collateralToken,
        tokenOpsManager,
        backingId: id("candidate-borrower"),
        principal: { min: 80_000, max: 120_000, target: 90_000, direction: TARGET_IS_BEST, priority: 5 },
      },
    );
    const { input: lenderInput, preferenceId: lenderPreferenceId } = await createEncryptedBundle(
      book,
      signers.lenderManager,
      {
        side: LENDER,
        principalBucket,
        durationBucket,
        collateralToken,
        tokenOpsManager,
        backingId: id("candidate-lender"),
        principal: { min: 80_000, max: 120_000, target: 110_000, direction: TARGET_IS_BEST, priority: 1 },
      },
    );

    await registerBorrowerBacking(borrowerInput, signers.borrowerManager);
    await registerLenderBacking(lenderInput, signers.lenderManager);
    await book.connect(signers.borrowerManager).activateBacking(borrowerInput.backingId);
    await book.connect(signers.lenderManager).activateBacking(lenderInput.backingId);

    const attemptId = await engine
      .connect(signers.relayer)
      .executeMatch.staticCall(borrowerPreferenceId, [lenderPreferenceId]);
    await engine.connect(signers.relayer).executeMatch(borrowerPreferenceId, [lenderPreferenceId]);
    await computeAllTerms(engine.connect(signers.relayer), attemptId);
    const encryptedTerms = await engine.getEncryptedTerms(attemptId);

    expect(await decryptEuint64(encryptedTerms.principal)).to.equal(90_000n);
  });

  it("keeps default bundles feasible with overlapping interest and duration ranges", async function () {
    const principalBucket = ascii32("P<000150");
    const durationBucket = ascii32("D<000720");
    const collateralToken = await vestingManager.getAddress();
    const tokenOpsManager = await vestingManager.getAddress();
    const sharedFields = {
      collateralAmount: { min: 100_000, max: 150_000, target: 150_000, direction: TARGET_IS_BEST },
      principal: { min: 50, max: 100, target: 100, direction: TARGET_IS_BEST },
      collateralTokenPriceE8: { min: 30_000, max: 100_000, target: 70_000, direction: TARGET_IS_BEST },
      gracePeriodDays: { min: 0, max: 15, target: 7, direction: TARGET_IS_BEST },
    };
    const { input: borrowerInput, preferenceId: borrowerPreferenceId } = await createEncryptedBundle(
      book,
      signers.borrowerManager,
      {
        side: BORROWER,
        principalBucket,
        durationBucket,
        collateralToken,
        tokenOpsManager,
        backingId: id("overlap-borrower"),
        ...sharedFields,
        interestBps: { min: 0, max: 600, target: 500, direction: LOWER_IS_BETTER },
        durationDays: { min: 180, max: 720, target: 360, direction: HIGHER_IS_BETTER },
      },
    );
    const { input: lenderInput, preferenceId: lenderPreferenceId } = await createEncryptedBundle(
      book,
      signers.lenderManager,
      {
        side: LENDER,
        principalBucket,
        durationBucket,
        collateralToken,
        tokenOpsManager,
        backingId: id("overlap-lender"),
        ...sharedFields,
        interestBps: { min: 500, max: 1000, target: 700, direction: HIGHER_IS_BETTER },
        durationDays: { min: 365, max: 720, target: 365, direction: LOWER_IS_BETTER },
      },
    );

    await registerBorrowerBacking(borrowerInput, signers.borrowerManager);
    await registerLenderBacking(lenderInput, signers.lenderManager);
    await book.connect(signers.borrowerManager).activateBacking(borrowerInput.backingId);
    await book.connect(signers.lenderManager).activateBacking(lenderInput.backingId);

    const attemptId = await engine
      .connect(signers.relayer)
      .executeMatch.staticCall(borrowerPreferenceId, [lenderPreferenceId]);
    await engine.connect(signers.relayer).executeMatch(borrowerPreferenceId, [lenderPreferenceId]);
    await computeAllTerms(engine.connect(signers.relayer), attemptId);
    const proof = await feasibilityProof(engine, attemptId);

    expect(proof.feasible).to.equal(true);
    await expect(
      engine.connect(signers.relayer).finalizeMatchFeasibility(attemptId, proof.feasible, proof.decryptionProof),
    ).to.emit(engine, "MatchSucceeded");
  });

  it("rejects same-side or different-market candidate sets", async function () {
    const { input: borrowerInput, preferenceId: borrowerPreferenceId } = await createEncryptedBundle(
      book,
      signers.borrowerManager,
      {
        collateralToken: await vestingManager.getAddress(),
        tokenOpsManager: await vestingManager.getAddress(),
      },
    );
    const { input: sameSideInput, preferenceId: sameSidePreferenceId } = await createEncryptedBundle(
      book,
      signers.secondLenderManager,
      {
        side: BORROWER,
        collateralToken: borrowerInput.metadata.collateralToken,
        tokenOpsManager: borrowerInput.metadata.tokenOpsManager,
        principalBucket: borrowerInput.metadata.principalBucket,
        durationBucket: borrowerInput.metadata.durationBucket,
        backingId: id("same-side"),
      },
    );
    const { input: differentBucketInput, preferenceId: differentBucketPreferenceId } = await createEncryptedBundle(
      book,
      signers.lenderManager,
      {
        side: LENDER,
        collateralToken: borrowerInput.metadata.collateralToken,
        tokenOpsManager: borrowerInput.metadata.tokenOpsManager,
        principalBucket: ascii32("P<250000"),
        durationBucket: borrowerInput.metadata.durationBucket,
        backingId: id("different-bucket"),
      },
    );

    await registerBorrowerBacking(borrowerInput, signers.borrowerManager);
    await registerBorrowerBacking(sameSideInput, signers.secondLenderManager);
    await registerLenderBacking(differentBucketInput, signers.lenderManager);
    await book.connect(signers.borrowerManager).activateBacking(borrowerInput.backingId);
    await book.connect(signers.secondLenderManager).activateBacking(sameSideInput.backingId);
    await book.connect(signers.lenderManager).activateBacking(differentBucketInput.backingId);

    await expect(
      engine.connect(signers.relayer).executeMatch(borrowerPreferenceId, [sameSidePreferenceId]),
    ).to.be.revertedWithCustomError(engine, "SameSidePreference");
    await expect(
      engine.connect(signers.relayer).executeMatch(borrowerPreferenceId, [differentBucketPreferenceId]),
    ).to.be.revertedWithCustomError(engine, "BucketMismatch");
  });

  it("emits failed attempts without publishing a failure reason when no executable maker is available", async function () {
    const { input: borrowerInput, preferenceId: borrowerPreferenceId } = await createEncryptedBundle(
      book,
      signers.borrowerManager,
      {
        collateralToken: await vestingManager.getAddress(),
        tokenOpsManager: await vestingManager.getAddress(),
      },
    );
    const { preferenceId: lenderPreferenceId } = await createEncryptedBundle(book, signers.lenderManager, {
      side: LENDER,
      collateralToken: borrowerInput.metadata.collateralToken,
      tokenOpsManager: borrowerInput.metadata.tokenOpsManager,
      principalBucket: borrowerInput.metadata.principalBucket,
      durationBucket: borrowerInput.metadata.durationBucket,
      backingId: id("inactive-lender"),
    });

    await registerBorrowerBacking(borrowerInput, signers.borrowerManager);
    await book.connect(signers.borrowerManager).activateBacking(borrowerInput.backingId);
    const attemptId = await engine
      .connect(signers.relayer)
      .executeMatch.staticCall(borrowerPreferenceId, [lenderPreferenceId]);
    await expect(engine.connect(signers.relayer).executeMatch(borrowerPreferenceId, [lenderPreferenceId]))
      .to.emit(engine, "MatchFailed")
      .withArgs(attemptId);

    const attempt = await engine.getAttempt(attemptId);
    expect(attempt.status).to.equal(2n);
    expect(attempt.makerPreferenceId).to.equal(ethers.ZeroHash);
  });

  it("finalizes encrypted infeasible matches as failed without consuming locked preferences", async function () {
    const { input: borrowerInput, preferenceId: borrowerPreferenceId } = await createEncryptedBundle(
      book,
      signers.borrowerManager,
      {
        collateralToken: await vestingManager.getAddress(),
        tokenOpsManager: await vestingManager.getAddress(),
        principal: { min: 75_000, max: 100_000, target: 90_000 },
      },
    );
    const { input: lenderInput, preferenceId: lenderPreferenceId } = await createEncryptedBundle(
      book,
      signers.lenderManager,
      {
        side: LENDER,
        collateralToken: borrowerInput.metadata.collateralToken,
        tokenOpsManager: borrowerInput.metadata.tokenOpsManager,
        principalBucket: borrowerInput.metadata.principalBucket,
        durationBucket: borrowerInput.metadata.durationBucket,
        backingId: id("infeasible-lender"),
        principal: { min: 125_000, max: 150_000, target: 130_000 },
      },
    );

    await registerBorrowerBacking(borrowerInput, signers.borrowerManager);
    await registerLenderBacking(lenderInput, signers.lenderManager);
    await book.connect(signers.borrowerManager).activateBacking(borrowerInput.backingId);
    await book.connect(signers.lenderManager).activateBacking(lenderInput.backingId);

    const attemptId = await engine
      .connect(signers.relayer)
      .executeMatch.staticCall(borrowerPreferenceId, [lenderPreferenceId]);
    await engine.connect(signers.relayer).executeMatch(borrowerPreferenceId, [lenderPreferenceId]);
    await expect(
      engine.connect(signers.relayer).finalizeMatchFeasibility(attemptId, false, "0x"),
    ).to.be.revertedWithCustomError(engine, "MatchTermsNotReady");
    await computeAllTerms(engine.connect(signers.relayer), attemptId);
    expect(await engine.isPreferenceLocked(borrowerPreferenceId)).to.equal(true);
    expect(await engine.isPreferenceLocked(lenderPreferenceId)).to.equal(true);

    const proof = await feasibilityProof(engine, attemptId);
    expect(proof.feasible).to.equal(false);
    await expect(
      engine.connect(signers.relayer).finalizeMatchFeasibility(attemptId, proof.feasible, proof.decryptionProof),
    )
      .to.emit(engine, "MatchFailed")
      .withArgs(attemptId);

    const attempt = await engine.getAttempt(attemptId);
    expect(attempt.status).to.equal(2n);
    expect(await engine.isPreferenceLocked(borrowerPreferenceId)).to.equal(false);
    expect(await engine.isPreferenceLocked(lenderPreferenceId)).to.equal(false);
    expect((await book.getPreferenceBundle(borrowerPreferenceId)).status).to.equal(5n);
    expect((await book.getPreferenceBundle(lenderPreferenceId)).status).to.equal(5n);
  });
});
