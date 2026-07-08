import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { ethers } from "hardhat";
import { expect } from "chai";
import { BondManager, BondManager__factory } from "../types";

type Signers = {
  owner: HardhatEthersSigner;
  treasury: HardhatEthersSigner;
  taker: HardhatEthersSigner;
  makerA: HardhatEthersSigner;
  makerB: HardhatEthersSigner;
  outsider: HardhatEthersSigner;
};

const baseBond = ethers.parseEther("0.1");

async function deployFixture() {
  const factory = (await ethers.getContractFactory("BondManager")) as BondManager__factory;
  const bondManager = (await factory.deploy(signers.treasury.address, {
    baseBondWei: baseBond,
    configuredMinBatchSize: 3,
    treasuryShareBps: 2_000,
    thinMarketPenaltyBps: 1_000,
    failedAttemptCooldownSeconds: 120,
  })) as BondManager;

  return { bondManager };
}

let signers: Signers;

describe("BondManager", function () {
  let bondManager: BondManager;

  before(async function () {
    const ethSigners = await ethers.getSigners();
    signers = {
      owner: ethSigners[0],
      treasury: ethSigners[1],
      taker: ethSigners[2],
      makerA: ethSigners[3],
      makerB: ethSigners[4],
      outsider: ethSigners[5],
    };
  });

  beforeEach(async function () {
    ({ bondManager } = await deployFixture());
  });

  it("quotes base bonds for sufficiently large candidate sets", async function () {
    expect(await bondManager.requiredBatchSizeFor(10)).to.equal(3n);
    expect(await bondManager.quoteBond(3, 10)).to.equal(baseBond);
    expect(await bondManager.quoteBond(5, 10)).to.equal(baseBond);
  });

  it("requires all available counterparties in thin markets and increases bond cost", async function () {
    const thinQuote = baseBond + (baseBond * 1_000n) / 10_000n;

    expect(await bondManager.requiredBatchSizeFor(2)).to.equal(2n);
    expect(await bondManager.quoteBond(2, 2)).to.equal(thinQuote);

    await expect(bondManager.quoteBond(1, 2)).to.be.revertedWithCustomError(bondManager, "InsufficientBatchSize");
  });

  it("rejects empty markets before bond posting", async function () {
    await expect(
      bondManager.connect(signers.taker).postBond(1, 0, 0, { value: baseBond }),
    ).to.be.revertedWithCustomError(bondManager, "EmptyMarket");
  });

  it("posts and refunds successful match-attempt bonds", async function () {
    const attemptId = await bondManager.connect(signers.taker).postBond.staticCall(1, 3, 10, { value: baseBond });

    await expect(bondManager.connect(signers.taker).postBond(1, 3, 10, { value: baseBond }))
      .to.emit(bondManager, "BondPosted")
      .withArgs(attemptId, signers.taker.address, 1n, baseBond, 3n, 10n);

    await expect(() => bondManager.refundBond(attemptId)).to.changeEtherBalances(
      [bondManager, signers.taker],
      [-baseBond, baseBond],
    );

    const attempt = await bondManager.getAttempt(attemptId);
    expect(attempt.status).to.equal(2n);
  });

  it("slashes failed attempts between treasury and probed counterparties", async function () {
    const attemptId = await bondManager.connect(signers.taker).postBond.staticCall(1, 3, 10, { value: baseBond });
    await bondManager.connect(signers.taker).postBond(1, 3, 10, { value: baseBond });

    const treasuryShare = (baseBond * 2_000n) / 10_000n;
    const counterpartyShare = (baseBond - treasuryShare) / 2n;

    await expect(() =>
      bondManager.slashBond(attemptId, [signers.makerA.address, signers.makerB.address]),
    ).to.changeEtherBalances(
      [bondManager, signers.treasury, signers.makerA, signers.makerB],
      [-baseBond, treasuryShare, counterpartyShare, counterpartyShare],
    );

    const attempt = await bondManager.getAttempt(attemptId);
    expect(attempt.status).to.equal(3n);
    expect(await bondManager.takerCooldownUntil(signers.taker.address)).to.be.greaterThan(await time.latest());
  });

  it("blocks takers during cooldown after a failed attempt", async function () {
    const attemptId = await bondManager.connect(signers.taker).postBond.staticCall(1, 3, 10, { value: baseBond });
    await bondManager.connect(signers.taker).postBond(1, 3, 10, { value: baseBond });
    await bondManager.slashBond(attemptId, [signers.makerA.address]);

    await expect(
      bondManager.connect(signers.taker).postBond(1, 3, 10, { value: baseBond }),
    ).to.be.revertedWithCustomError(bondManager, "TakerInCooldown");

    await time.increase(121);
    await expect(bondManager.connect(signers.taker).postBond(1, 3, 10, { value: baseBond })).to.emit(
      bondManager,
      "BondPosted",
    );
  });

  it("restricts settlement to authorized callers", async function () {
    const attemptId = await bondManager.connect(signers.taker).postBond.staticCall(1, 3, 10, { value: baseBond });
    await bondManager.connect(signers.taker).postBond(1, 3, 10, { value: baseBond });

    await expect(bondManager.connect(signers.outsider).refundBond(attemptId)).to.be.revertedWithCustomError(
      bondManager,
      "UnauthorizedSettler",
    );

    await bondManager.setAuthorizedSettler(signers.outsider.address, true);
    await expect(bondManager.connect(signers.outsider).refundBond(attemptId)).to.emit(bondManager, "BondRefunded");
  });
});
