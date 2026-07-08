import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { ethers } from "hardhat";
import { expect } from "chai";
import {
  MockTokenOpsVestingManager,
  MockTokenOpsVestingManager__factory,
  TokenOpsVestingAdapter,
  TokenOpsVestingAdapter__factory,
} from "../types";

type Signers = {
  borrower: HardhatEthersSigner;
  loanEscrow: HardhatEthersSigner;
  lender: HardhatEthersSigner;
  outsider: HardhatEthersSigner;
};

async function deployFixture() {
  const managerFactory = (await ethers.getContractFactory(
    "MockTokenOpsVestingManager",
  )) as MockTokenOpsVestingManager__factory;
  const manager = (await managerFactory.deploy()) as MockTokenOpsVestingManager;

  const adapterFactory = (await ethers.getContractFactory("TokenOpsVestingAdapter")) as TokenOpsVestingAdapter__factory;
  const adapter = (await adapterFactory.deploy()) as TokenOpsVestingAdapter;

  return { manager, adapter };
}

describe("TokenOpsVestingAdapter", function () {
  let signers: Signers;
  let manager: MockTokenOpsVestingManager;
  let adapter: TokenOpsVestingAdapter;
  let managerAddress: string;
  let adapterAddress: string;

  before(async function () {
    const ethSigners = await ethers.getSigners();
    signers = {
      borrower: ethSigners[1],
      loanEscrow: ethSigners[2],
      lender: ethSigners[3],
      outsider: ethSigners[4],
    };
  });

  beforeEach(async function () {
    ({ manager, adapter } = await deployFixture());
    managerAddress = await manager.getAddress();
    adapterAddress = await adapter.getAddress();
  });

  async function transferVestingToAdapter(vestingId: string) {
    await manager.seedVesting(vestingId, signers.borrower.address);
    await manager.connect(signers.borrower).initiateVestingTransfer(vestingId, adapterAddress, 86_400);

    await expect(
      adapter
        .connect(signers.outsider)
        .acceptPendingVestingTransfer(managerAddress, vestingId, signers.borrower.address),
    )
      .to.emit(adapter, "PendingVestingAccepted")
      .withArgs(managerAddress, vestingId, signers.borrower.address);

    const info = await manager.getVestingInfo(vestingId);
    expect(info.recipient).to.equal(adapterAddress);
    expect(await adapter.custodiedBorrowerForVesting(managerAddress, vestingId)).to.equal(signers.borrower.address);
  }

  it("accepts pending TokenOps transfers and records the borrower before pledge registration", async function () {
    const vestingId = ethers.keccak256(ethers.toUtf8Bytes("vesting-1"));
    await transferVestingToAdapter(vestingId);

    const pledgeId = await adapter
      .connect(signers.loanEscrow)
      .registerPledge.staticCall(managerAddress, vestingId, signers.borrower.address);

    await expect(
      adapter.connect(signers.loanEscrow).registerPledge(managerAddress, vestingId, signers.borrower.address),
    )
      .to.emit(adapter, "VestingPledged")
      .withArgs(pledgeId, managerAddress, vestingId, signers.borrower.address, signers.loanEscrow.address);

    const pledge = await adapter.getPledge(pledgeId);
    expect(pledge.manager).to.equal(managerAddress);
    expect(pledge.vestingId).to.equal(vestingId);
    expect(pledge.borrower).to.equal(signers.borrower.address);
    expect(pledge.loanEscrow).to.equal(signers.loanEscrow.address);
    expect(pledge.status).to.equal(1n);
    expect(await adapter.pledgeForVesting(managerAddress, vestingId)).to.equal(pledgeId);
  });

  it("accepts bytes32(0) as a valid TokenOps vesting ID", async function () {
    const vestingId = ethers.ZeroHash;
    await transferVestingToAdapter(vestingId);

    const pledgeId = await adapter
      .connect(signers.loanEscrow)
      .registerPledge.staticCall(managerAddress, vestingId, signers.borrower.address);

    await expect(
      adapter.connect(signers.loanEscrow).registerPledge(managerAddress, vestingId, signers.borrower.address),
    )
      .to.emit(adapter, "VestingPledged")
      .withArgs(pledgeId, managerAddress, vestingId, signers.borrower.address, signers.loanEscrow.address);

    const pledge = await adapter.getPledge(pledgeId);
    expect(pledge.vestingId).to.equal(ethers.ZeroHash);
    expect(await adapter.pledgeForVesting(managerAddress, vestingId)).to.equal(pledgeId);
  });

  it("rejects pledge registration before the adapter has accepted borrower custody", async function () {
    const vestingId = ethers.keccak256(ethers.toUtf8Bytes("vesting-2"));
    await manager.seedVesting(vestingId, signers.borrower.address);

    await expect(
      adapter.connect(signers.loanEscrow).registerPledge(managerAddress, vestingId, signers.borrower.address),
    ).to.be.revertedWithCustomError(adapter, "VestingBorrowerMismatch");
  });

  it("rejects adapter custody acceptance when TokenOps has no matching pending transfer", async function () {
    const vestingId = ethers.keccak256(ethers.toUtf8Bytes("vesting-no-pending"));
    await manager.seedVesting(vestingId, signers.borrower.address);

    await expect(
      adapter
        .connect(signers.outsider)
        .acceptPendingVestingTransfer(managerAddress, vestingId, signers.borrower.address),
    ).to.be.revertedWithCustomError(adapter, "PendingTransferMissing");
  });

  it("prevents double pledging the same vesting schedule", async function () {
    const vestingId = ethers.keccak256(ethers.toUtf8Bytes("vesting-3"));
    await transferVestingToAdapter(vestingId);

    await adapter.connect(signers.loanEscrow).registerPledge(managerAddress, vestingId, signers.borrower.address);

    await expect(
      adapter.connect(signers.loanEscrow).registerPledge(managerAddress, vestingId, signers.borrower.address),
    ).to.be.revertedWithCustomError(adapter, "VestingAlreadyPledged");
  });

  it("lets any caller return unpledged custody to the original borrower", async function () {
    const vestingId = ethers.keccak256(ethers.toUtf8Bytes("vesting-unpledged-recovery"));
    await transferVestingToAdapter(vestingId);

    await expect(adapter.connect(signers.outsider).recoverUnpledgedVesting(managerAddress, vestingId))
      .to.emit(adapter, "UnpledgedVestingRecoveryInitiated")
      .withArgs(managerAddress, vestingId, signers.borrower.address, anyValue);

    let info = await manager.getVestingInfo(vestingId);
    const pending = await manager.getPendingVestingTransfer(vestingId);
    expect(info.recipient).to.equal(adapterAddress);
    expect(pending.newRecipient).to.equal(signers.borrower.address);

    await manager.connect(signers.borrower).acceptVestingTransfer(vestingId);
    await expect(adapter.connect(signers.lender).completeUnpledgedVestingRecovery(managerAddress, vestingId))
      .to.emit(adapter, "UnpledgedVestingRecovered")
      .withArgs(managerAddress, vestingId, signers.borrower.address);

    info = await manager.getVestingInfo(vestingId);
    expect(info.recipient).to.equal(signers.borrower.address);
    expect(await adapter.custodiedBorrowerForVesting(managerAddress, vestingId)).to.equal(ethers.ZeroAddress);
  });

  it("does not allow unpledged recovery once custody is assigned to a loan escrow", async function () {
    const vestingId = ethers.keccak256(ethers.toUtf8Bytes("vesting-pledged-recovery"));
    await transferVestingToAdapter(vestingId);
    const pledgeId = await adapter
      .connect(signers.loanEscrow)
      .registerPledge.staticCall(managerAddress, vestingId, signers.borrower.address);
    await adapter.connect(signers.loanEscrow).registerPledge(managerAddress, vestingId, signers.borrower.address);

    await expect(adapter.recoverUnpledgedVesting(managerAddress, vestingId))
      .to.be.revertedWithCustomError(adapter, "VestingAlreadyPledged")
      .withArgs(pledgeId);
  });

  it("allows only the assigned loan escrow to release pledged vesting", async function () {
    const vestingId = ethers.keccak256(ethers.toUtf8Bytes("vesting-4"));
    await transferVestingToAdapter(vestingId);

    const pledgeId = await adapter
      .connect(signers.loanEscrow)
      .registerPledge.staticCall(managerAddress, vestingId, signers.borrower.address);
    await adapter.connect(signers.loanEscrow).registerPledge(managerAddress, vestingId, signers.borrower.address);

    await expect(
      adapter.connect(signers.outsider).releasePledge(pledgeId, signers.lender.address),
    ).to.be.revertedWithCustomError(adapter, "UnauthorizedEscrow");

    await expect(adapter.connect(signers.loanEscrow).releasePledge(pledgeId, signers.lender.address))
      .to.emit(adapter, "VestingReleaseInitiated")
      .withArgs(pledgeId, signers.lender.address, anyValue);

    let info = await manager.getVestingInfo(vestingId);
    let pledge = await adapter.getPledge(pledgeId);
    const pending = await manager.getPendingVestingTransfer(vestingId);
    expect(info.recipient).to.equal(adapterAddress);
    expect(pending.newRecipient).to.equal(signers.lender.address);
    expect(pledge.status).to.equal(2n);
    expect(pledge.releasedTo).to.equal(signers.lender.address);
    expect(await adapter.pledgeForVesting(managerAddress, vestingId)).to.equal(pledgeId);

    await manager.connect(signers.lender).acceptVestingTransfer(vestingId);

    await expect(adapter.connect(signers.outsider).completeRelease(pledgeId))
      .to.emit(adapter, "VestingReleased")
      .withArgs(pledgeId, signers.lender.address);

    info = await manager.getVestingInfo(vestingId);
    pledge = await adapter.getPledge(pledgeId);
    expect(info.recipient).to.equal(signers.lender.address);
    expect(pledge.status).to.equal(3n);
    expect(pledge.releasedTo).to.equal(signers.lender.address);
    expect(await adapter.pledgeForVesting(managerAddress, vestingId)).to.equal(ethers.ZeroHash);
    expect(await adapter.custodiedBorrowerForVesting(managerAddress, vestingId)).to.equal(ethers.ZeroAddress);
  });
});
