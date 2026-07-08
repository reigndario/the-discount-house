import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import {
  DemoCreditFaucet,
  DemoCreditFaucet__factory,
  DemoTokenOpsVestingFactory,
  DemoTokenOpsVestingFactory__factory,
  DemoUsdToken,
  DemoUsdToken__factory,
  DemoVestingToken,
  DemoVestingToken__factory,
  MockConfidentialCreditAdapter,
  MockConfidentialCreditAdapter__factory,
  TokenOpsVestingAdapter,
  TokenOpsVestingAdapter__factory,
} from "../types";

type Signers = {
  borrower: HardhatEthersSigner;
  lender: HardhatEthersSigner;
  loanEscrow: HardhatEthersSigner;
};

describe("Demo contracts", function () {
  let signers: Signers;

  before(async function () {
    const ethSigners = await ethers.getSigners();
    signers = {
      borrower: ethSigners[1],
      lender: ethSigners[2],
      loanEscrow: ethSigners[3],
    };
  });

  it("provides demo faucet balances without touching core protocol state", async function () {
    const tokenFactory = (await ethers.getContractFactory("DemoVestingToken")) as DemoVestingToken__factory;
    const token = (await tokenFactory.deploy("Demo Vested Collateral", "dVEST")) as DemoVestingToken;

    await expect(token.connect(signers.borrower).faucet())
      .to.emit(token, "DemoFaucetClaimed")
      .withArgs(signers.borrower.address, ethers.parseEther("10000"));

    expect(await token.balanceOf(signers.borrower.address)).to.equal(ethers.parseEther("10000"));
    await expect(token.connect(signers.borrower).faucet()).to.be.revertedWithCustomError(token, "FaucetCooldownActive");
  });

  it("mints canonical demo USD on demand", async function () {
    const usdFactory = (await ethers.getContractFactory("DemoUsdToken")) as DemoUsdToken__factory;
    const usd = (await usdFactory.deploy()) as DemoUsdToken;

    await expect(usd.connect(signers.lender).faucet(ethers.parseEther("10000")))
      .to.emit(usd, "DemoUsdMinted")
      .withArgs(signers.lender.address, ethers.parseEther("10000"));

    await expect(usd.connect(signers.lender).mintTo(signers.borrower.address, ethers.parseEther("2500")))
      .to.emit(usd, "DemoUsdMinted")
      .withArgs(signers.borrower.address, ethers.parseEther("2500"));

    expect(await usd.balanceOf(signers.lender.address)).to.equal(ethers.parseEther("10000"));
    expect(await usd.balanceOf(signers.borrower.address)).to.equal(ethers.parseEther("2500"));
  });

  it("creates demo TokenOps-style vesting and lets the vesting adapter register a pledge", async function () {
    const managerFactory = (await ethers.getContractFactory(
      "DemoTokenOpsVestingFactory",
    )) as DemoTokenOpsVestingFactory__factory;
    const tokenFactory = (await ethers.getContractFactory("DemoVestingToken")) as DemoVestingToken__factory;
    const token = (await tokenFactory.deploy("Demo Vested Collateral", "dVEST")) as DemoVestingToken;
    const manager = (await managerFactory.deploy(await token.getAddress())) as DemoTokenOpsVestingFactory;

    const adapterFactory = (await ethers.getContractFactory(
      "TokenOpsVestingAdapter",
    )) as TokenOpsVestingAdapter__factory;
    const adapter = (await adapterFactory.deploy()) as TokenOpsVestingAdapter;

    const amount = ethers.parseEther("2500");
    expect(await manager.collateralToken()).to.equal(await token.getAddress());
    const vestingId = await manager
      .connect(signers.borrower)
      .createDemoVesting.staticCall(signers.borrower.address, amount);
    await expect(manager.connect(signers.borrower).createDemoVesting(signers.borrower.address, amount))
      .to.emit(manager, "DemoVestingCreated")
      .withArgs(vestingId, signers.borrower.address, signers.borrower.address, amount);

    const managerAddress = await manager.getAddress();
    const adapterAddress = await adapter.getAddress();

    await expect(manager.connect(signers.borrower).initiateVestingTransfer(vestingId, adapterAddress, 86_400))
      .to.emit(manager, "VestingTransferInitiated")
      .withArgs(vestingId, signers.borrower.address, adapterAddress, anyValue);

    await expect(
      adapter
        .connect(signers.loanEscrow)
        .acceptPendingVestingTransfer(managerAddress, vestingId, signers.borrower.address),
    )
      .to.emit(adapter, "PendingVestingAccepted")
      .withArgs(managerAddress, vestingId, signers.borrower.address);

    const pledgeId = await adapter
      .connect(signers.loanEscrow)
      .registerPledge.staticCall(managerAddress, vestingId, signers.borrower.address);
    await expect(
      adapter.connect(signers.loanEscrow).registerPledge(managerAddress, vestingId, signers.borrower.address),
    )
      .to.emit(adapter, "VestingPledged")
      .withArgs(pledgeId, managerAddress, vestingId, signers.borrower.address, signers.loanEscrow.address);
  });

  it("allows demo TokenOps-style vesting to be created with vesting ID bytes32(0)", async function () {
    const managerFactory = (await ethers.getContractFactory(
      "DemoTokenOpsVestingFactory",
    )) as DemoTokenOpsVestingFactory__factory;
    const tokenFactory = (await ethers.getContractFactory("DemoVestingToken")) as DemoVestingToken__factory;
    const token = (await tokenFactory.deploy("Demo Vested Collateral", "dVEST")) as DemoVestingToken;
    const manager = (await managerFactory.deploy(await token.getAddress())) as DemoTokenOpsVestingFactory;

    const amount = ethers.parseEther("2500");
    await expect(
      manager.connect(signers.borrower).createDemoVestingWithId(ethers.ZeroHash, signers.borrower.address, amount),
    )
      .to.emit(manager, "DemoVestingCreated")
      .withArgs(ethers.ZeroHash, signers.borrower.address, signers.borrower.address, amount);

    const info = await manager.getVestingInfo(ethers.ZeroHash);
    expect(info.recipient).to.equal(signers.borrower.address);
  });

  it("wraps mock credit commitment and authorization flows for demo UI use", async function () {
    const adapterFactory = (await ethers.getContractFactory(
      "MockConfidentialCreditAdapter",
    )) as MockConfidentialCreditAdapter__factory;
    const adapter = (await adapterFactory.deploy()) as MockConfidentialCreditAdapter;

    const faucetFactory = (await ethers.getContractFactory("DemoCreditFaucet")) as DemoCreditFaucet__factory;
    const faucet = (await faucetFactory.deploy(await adapter.getAddress())) as DemoCreditFaucet;

    const commitmentHash = ethers.keccak256(ethers.toUtf8Bytes("demo-credit-commitment"));
    const authorizationHash = ethers.keccak256(ethers.toUtf8Bytes("demo-credit-authorization"));
    const expiry = BigInt(await time.latest()) + 7n * 24n * 60n * 60n;

    await expect(faucet.connect(signers.lender).issueDemoCreditCommitment(commitmentHash, expiry))
      .to.emit(faucet, "DemoCreditCommitmentIssued")
      .withArgs(commitmentHash, signers.lender.address, expiry);
    expect(await adapter.isCreditCommitmentExecutable(commitmentHash, signers.lender.address)).to.equal(false);

    await expect(
      faucet
        .connect(signers.lender)
        .authorizeDemoCredit(authorizationHash, signers.lender.address, ethers.parseEther("5000")),
    )
      .to.emit(faucet, "DemoCreditAuthorized")
      .withArgs(authorizationHash, signers.lender.address, ethers.parseEther("5000"));

    const credit = await adapter.getCredit(authorizationHash);
    expect(credit.payer).to.equal(signers.lender.address);
    expect(credit.amount).to.equal(ethers.parseEther("5000"));
    expect(credit.consumed).to.equal(false);

    await expect(
      faucet
        .connect(signers.lender)
        .authorizeDemoCredit(commitmentHash, signers.lender.address, ethers.parseEther("5000")),
    ).to.emit(faucet, "DemoCreditAuthorized");
    expect(await adapter.isCreditCommitmentExecutable(commitmentHash, signers.lender.address)).to.equal(true);
  });
});
