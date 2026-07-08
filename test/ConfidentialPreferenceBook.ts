import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { ethers } from "hardhat";
import { expect } from "chai";
import {
  ConfidentialPreferenceBook,
  ConfidentialPreferenceBook__factory,
  MockConfidentialCreditAdapter,
  MockTokenOpsVestingManager,
  TokenOpsVestingAdapter,
} from "../types";
import {
  BORROWER,
  LENDER,
  ascii32,
  createEncryptedBundle,
  encryptedBundleInput,
  id,
} from "./EncryptedPreferenceHelpers";

type Signers = {
  manager: HardhatEthersSigner;
  outsider: HardhatEthersSigner;
  matcher: HardhatEthersSigner;
};

async function deployFixture() {
  const bookFactory = (await ethers.getContractFactory(
    "ConfidentialPreferenceBook",
  )) as ConfidentialPreferenceBook__factory;
  const book = (await bookFactory.deploy()) as ConfidentialPreferenceBook;
  const vestingManager = (await (
    await ethers.getContractFactory("MockTokenOpsVestingManager")
  ).deploy()) as MockTokenOpsVestingManager;
  const vestingAdapter = (await (
    await ethers.getContractFactory("TokenOpsVestingAdapter")
  ).deploy()) as TokenOpsVestingAdapter;
  const creditAdapter = (await (
    await ethers.getContractFactory("MockConfidentialCreditAdapter")
  ).deploy()) as MockConfidentialCreditAdapter;

  return { book, vestingManager, vestingAdapter, creditAdapter };
}

describe("ConfidentialPreferenceBook", function () {
  let signers: Signers;
  let book: ConfidentialPreferenceBook;
  let vestingManager: MockTokenOpsVestingManager;
  let vestingAdapter: TokenOpsVestingAdapter;
  let creditAdapter: MockConfidentialCreditAdapter;

  before(async function () {
    const ethSigners = await ethers.getSigners();
    signers = {
      manager: ethSigners[1],
      outsider: ethSigners[2],
      matcher: ethSigners[3],
    };
  });

  beforeEach(async function () {
    ({ book, vestingManager, vestingAdapter, creditAdapter } = await deployFixture());
  });

  async function registerBorrowerBacking(
    input: Awaited<ReturnType<typeof encryptedBundleInput>>,
    vestingId = id(`vesting:${input.backingId}`),
  ) {
    const vestingManagerAddress = await vestingManager.getAddress();
    const vestingAdapterAddress = await vestingAdapter.getAddress();
    await vestingManager.seedVesting(vestingId, signers.manager.address);
    await vestingManager.connect(signers.manager).initiateVestingTransfer(vestingId, vestingAdapterAddress, 86_400);
    await vestingAdapter.acceptPendingVestingTransfer(vestingManagerAddress, vestingId, signers.manager.address);
    await book
      .connect(signers.manager)
      .registerBorrowerBacking(input.backingId, input.metadata.tokenOpsManager, vestingAdapterAddress, vestingId);
  }

  async function registerLenderBacking(
    input: Awaited<ReturnType<typeof encryptedBundleInput>>,
    manager = signers.manager,
  ) {
    const commitmentHash = id(`credit:${input.backingId}`);
    const expiry = Number(await time.latest()) + 3600;
    await creditAdapter.connect(manager).registerLenderCreditCommitment(commitmentHash, manager.address, expiry);
    await creditAdapter.connect(manager).authorizeCredit(commitmentHash, manager.address, 100_000n);
    await book
      .connect(manager)
      .registerLenderBacking(input.backingId, await creditAdapter.getAddress(), commitmentHash, expiry);
  }

  async function createBorrowerBundle(overrides: Parameters<typeof createEncryptedBundle>[2] = {}) {
    return createEncryptedBundle(book, signers.manager, {
      collateralToken: await vestingManager.getAddress(),
      tokenOpsManager: await vestingManager.getAddress(),
      ...overrides,
    });
  }

  it("stores encrypted bundles while events expose only approved coarse metadata", async function () {
    const input = await encryptedBundleInput(book, signers.manager);
    const tx = await book.connect(signers.manager).createPreferenceBundle(input);
    const receipt = await tx.wait();
    const event = receipt?.logs
      .map((log) => {
        try {
          return book.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed?.name === "PreferenceCreated");

    const expectedBucketKey = await book.bucketKey(input.metadata);
    expect(event?.args.side).to.equal(BORROWER);
    expect(event?.args.bucketKey).to.equal(expectedBucketKey);
    expect(event?.args.collateralToken).to.equal(input.metadata.collateralToken);
    expect(event?.args.tokenOpsManager).to.equal(input.metadata.tokenOpsManager);
    expect(event?.args.principalBucket).to.equal(input.metadata.principalBucket);
    expect(event?.args.durationBucket).to.equal(input.metadata.durationBucket);
    expect(event?.args.expiry).to.equal(BigInt(input.metadata.expiry));

    const preference = await book.getPreferenceBundle(event?.args.preferenceId);
    expect(preference.manager).to.equal(signers.manager.address);
    expect(preference.metadata.side).to.equal(BORROWER);
    expect(preference.backingId).to.equal(input.backingId);
    expect(preference.status).to.equal(1n);
    expect(preference.collateralAmount.range.target).to.not.equal(0n);
    expect(preference.collateralAmount.priority).to.not.equal(0n);
  });

  it("keeps submitted bundles out of the public bucket index until backing is executable", async function () {
    const { input, preferenceId } = await createBorrowerBundle();
    const bucketKey = await book.bucketKey(input.metadata);

    expect(await book.isBucketEmpty(bucketKey)).to.equal(true);
    await registerBorrowerBacking(input);
    await expect(book.connect(signers.manager).activateBacking(input.backingId))
      .to.emit(book, "BackingExecutable")
      .withArgs(input.backingId, 1);

    expect(await book.isBucketEmpty(bucketKey)).to.equal(false);
    expect(await book.bucketCount(bucketKey)).to.equal(1n);
    expect(await book.getBucketPreferenceIds(bucketKey)).to.deep.equal([preferenceId]);
    const preference = await book.getPreferenceBundle(preferenceId);
    expect(preference.status).to.equal(5n);
    expect(preference.executableSequence).to.equal(1n);
  });

  it("does not require a protocol account to create lender-side bundles", async function () {
    const { input } = await createEncryptedBundle(book, signers.manager, {
      side: LENDER,
      collateralToken: await vestingManager.getAddress(),
      tokenOpsManager: await vestingManager.getAddress(),
      backingId: id("lender-credit"),
    });
    const bucketKey = await book.bucketKey(input.metadata);

    await registerLenderBacking(input);
    await book.connect(signers.manager).activateBacking(input.backingId);
    expect(await book.bucketCount(bucketKey)).to.equal(1n);
  });

  it("rejects lender activation until the credit adapter confirms the commitment", async function () {
    const { input } = await createEncryptedBundle(book, signers.manager, {
      side: LENDER,
      collateralToken: await vestingManager.getAddress(),
      tokenOpsManager: await vestingManager.getAddress(),
      backingId: id("unconfirmed-lender-credit"),
    });
    await book
      .connect(signers.manager)
      .registerLenderBacking(
        input.backingId,
        await creditAdapter.getAddress(),
        id(`credit:${input.backingId}`),
        Number(await time.latest()) + 3600,
      );

    await expect(book.connect(signers.manager).activateBacking(input.backingId))
      .to.be.revertedWithCustomError(book, "BackingNotExecutable")
      .withArgs(input.backingId);
  });

  it("restricts cancellation to the bundle manager", async function () {
    const { input, preferenceId } = await createBorrowerBundle();
    await registerBorrowerBacking(input);
    await book.connect(signers.manager).activateBacking(input.backingId);

    await expect(book.connect(signers.outsider).cancelPreferenceBundle(preferenceId)).to.be.revertedWithCustomError(
      book,
      "UnauthorizedPreferenceManager",
    );

    await expect(book.connect(signers.manager).cancelPreferenceBundle(preferenceId))
      .to.emit(book, "PreferenceCancelled")
      .withArgs(preferenceId);
    const bucketKey = await book.bucketKey(input.metadata);
    expect(await book.bucketCount(bucketKey)).to.equal(0n);
  });

  it("lets anyone expire stale bundles without revealing failure reasons", async function () {
    const input = await encryptedBundleInput(book, signers.manager, {
      expiry: Number(await time.latest()) + 20,
    });
    const preferenceId = await book.connect(signers.manager).createPreferenceBundle.staticCall(input);
    await book.connect(signers.manager).createPreferenceBundle(input);

    await expect(book.connect(signers.outsider).expirePreferenceBundle(preferenceId)).to.be.revertedWithCustomError(
      book,
      "PreferenceNotExpired",
    );

    await time.increase(21);
    await expect(book.connect(signers.outsider).expirePreferenceBundle(preferenceId))
      .to.emit(book, "PreferenceExpired")
      .withArgs(preferenceId);
  });

  it("supersedes active bundles while preserving side and backing", async function () {
    const { input, preferenceId: oldPreferenceId } = await createBorrowerBundle();
    const newInput = await encryptedBundleInput(book, signers.manager, {
      side: input.metadata.side,
      collateralToken: input.metadata.collateralToken,
      tokenOpsManager: input.metadata.tokenOpsManager,
      principalBucket: ascii32("P<150000"),
      durationBucket: input.metadata.durationBucket,
      backingId: input.backingId,
    });

    const newPreferenceId = await book
      .connect(signers.manager)
      .supersedePreferenceBundle.staticCall(oldPreferenceId, newInput);
    await expect(book.connect(signers.manager).supersedePreferenceBundle(oldPreferenceId, newInput))
      .to.emit(book, "PreferenceSuperseded")
      .withArgs(oldPreferenceId, newPreferenceId);

    expect((await book.getPreferenceBundle(oldPreferenceId)).status).to.equal(4n);
    const newPreference = await book.getPreferenceBundle(newPreferenceId);
    expect(newPreference.backingId).to.equal(input.backingId);
    expect(newPreference.metadata.principalBucket).to.equal(ascii32("P<150000"));
  });

  it("lets only the authorized matcher consume matched backing siblings", async function () {
    const backingId = id("borrower-shared-backing");
    const { input: borrowerInput, preferenceId: borrowerPreferenceId } = await createBorrowerBundle({ backingId });
    const { preferenceId: siblingPreferenceId } = await createEncryptedBundle(book, signers.manager, {
      backingId,
      collateralToken: borrowerInput.metadata.collateralToken,
      tokenOpsManager: borrowerInput.metadata.tokenOpsManager,
      principalBucket: ascii32("P<150000"),
    });
    const { input: lenderInput, preferenceId: lenderPreferenceId } = await createEncryptedBundle(
      book,
      signers.outsider,
      {
        side: LENDER,
        collateralToken: borrowerInput.metadata.collateralToken,
        tokenOpsManager: borrowerInput.metadata.tokenOpsManager,
        principalBucket: borrowerInput.metadata.principalBucket,
        durationBucket: borrowerInput.metadata.durationBucket,
        backingId: id("lender-backing"),
      },
    );

    await registerBorrowerBacking(borrowerInput);
    await registerLenderBacking(lenderInput, signers.outsider);
    await book.connect(signers.manager).activateBacking(borrowerInput.backingId);
    await book.connect(signers.outsider).activateBacking(lenderInput.backingId);
    await expect(
      book.connect(signers.outsider).consumeMatchedPreferences(borrowerPreferenceId, lenderPreferenceId),
    ).to.be.revertedWithCustomError(book, "UnauthorizedMatchConsumer");

    await book.setAuthorizedMatcher(signers.matcher.address);
    await book.connect(signers.matcher).consumeMatchedPreferences(borrowerPreferenceId, lenderPreferenceId);

    expect((await book.getPreferenceBundle(borrowerPreferenceId)).status).to.equal(6n);
    expect((await book.getPreferenceBundle(siblingPreferenceId)).status).to.equal(6n);
    expect((await book.getPreferenceBundle(lenderPreferenceId)).status).to.equal(6n);
  });

  it("rejects activation until matching backing evidence is registered and still valid", async function () {
    const { input, preferenceId } = await createBorrowerBundle();
    await expect(book.connect(signers.manager).activateBacking(input.backingId)).to.be.revertedWithCustomError(
      book,
      "BackingNotExecutable",
    );

    await registerBorrowerBacking(input);
    expect(await book.isBackingExecutable(preferenceId)).to.equal(true);
  });

  it("accepts borrower backing evidence for TokenOps vesting ID bytes32(0)", async function () {
    const { input, preferenceId } = await createBorrowerBundle();
    await registerBorrowerBacking(input, ethers.ZeroHash);

    expect(await book.isBackingExecutable(preferenceId)).to.equal(true);
    const evidence = await book.getBorrowerBackingEvidence(input.backingId);
    expect(evidence.vestingId).to.equal(ethers.ZeroHash);
  });

  it("rejects invalid public metadata and empty encrypted proofs", async function () {
    const input = await encryptedBundleInput(book, signers.manager);
    await expect(
      book.createPreferenceBundle({ ...input, metadata: { ...input.metadata, side: 2 } }),
    ).to.be.revertedWithCustomError(book, "InvalidSide");
    await expect(
      book.createPreferenceBundle({ ...input, metadata: { ...input.metadata, collateralToken: ethers.ZeroAddress } }),
    ).to.be.revertedWithCustomError(book, "InvalidCollateralToken");
    await expect(
      book.createPreferenceBundle({ ...input, metadata: { ...input.metadata, principalBucket: ethers.ZeroHash } }),
    ).to.be.revertedWithCustomError(book, "InvalidPrincipalBucket");
    await expect(book.createPreferenceBundle({ ...input, backingId: ethers.ZeroHash })).to.be.revertedWithCustomError(
      book,
      "InvalidBacking",
    );
    await expect(book.createPreferenceBundle({ ...input, inputProof: "0x" })).to.be.revertedWithCustomError(
      book,
      "InvalidEncryptedInput",
    );
  });
});
