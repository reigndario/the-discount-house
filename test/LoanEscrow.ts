import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { ethers } from "hardhat";
import { expect } from "chai";
import {
  LoanEscrow,
  LoanEscrowFactory,
  LoanEscrowFactory__factory,
  MockConfidentialCreditAdapter,
  MockConfidentialCreditAdapter__factory,
  MockTokenOpsVestingManager,
  MockTokenOpsVestingManager__factory,
  TokenOpsVestingAdapter,
  TokenOpsVestingAdapter__factory,
} from "../types";

type Signers = {
  borrower: HardhatEthersSigner;
  lender: HardhatEthersSigner;
  relayer: HardhatEthersSigner;
  outsider: HardhatEthersSigner;
};

const PRINCIPAL = 100_000n;
const TOTAL_DUE = 108_000n;

function id(label: string) {
  return ethers.keccak256(ethers.toUtf8Bytes(label));
}

async function auth(label: string, amount: bigint, authorizationHash = id(`auth:${label}`)) {
  return {
    amount,
    deadline: Number(await time.latest()) + 3600,
    authorizationHash,
  };
}

async function deployFixture() {
  const managerFactory = (await ethers.getContractFactory(
    "MockTokenOpsVestingManager",
  )) as MockTokenOpsVestingManager__factory;
  const manager = (await managerFactory.deploy()) as MockTokenOpsVestingManager;

  const adapterFactory = (await ethers.getContractFactory("TokenOpsVestingAdapter")) as TokenOpsVestingAdapter__factory;
  const adapter = (await adapterFactory.deploy()) as TokenOpsVestingAdapter;

  const creditAdapterFactory = (await ethers.getContractFactory(
    "MockConfidentialCreditAdapter",
  )) as MockConfidentialCreditAdapter__factory;
  const creditAdapter = (await creditAdapterFactory.deploy()) as MockConfidentialCreditAdapter;

  const factoryFactory = (await ethers.getContractFactory("LoanEscrowFactory")) as LoanEscrowFactory__factory;
  const factory = (await factoryFactory.deploy()) as LoanEscrowFactory;

  return { manager, adapter, creditAdapter, factory };
}

async function loanConfig(
  signers: Signers,
  manager: MockTokenOpsVestingManager,
  adapter: TokenOpsVestingAdapter,
  creditAdapter: MockConfidentialCreditAdapter,
  overrides: Record<string, unknown> = {},
) {
  const now = Number(await time.latest());
  return {
    borrower: signers.borrower.address,
    lender: signers.lender.address,
    vestingAdapter: await adapter.getAddress(),
    creditAdapter: await creditAdapter.getAddress(),
    tokenOpsManager: await manager.getAddress(),
    vestingId: id("vesting-loan-1"),
    dueTimestamp: now + 30 * 24 * 60 * 60,
    gracePeriodSeconds: 7 * 24 * 60 * 60,
    activationDeadline: now + 24 * 60 * 60,
    fundingCommitmentHash: id("commitment:funding"),
    fundingAuthorizationHash: id("auth:funding"),
    repaymentAuthorizationHash: id("auth:repayment"),
    termsHash: id("matched-terms"),
    encryptedTermsHash: id("encrypted-matched-terms"),
    ...overrides,
  };
}

async function createLoan(
  factory: LoanEscrowFactory,
  config: Awaited<ReturnType<typeof loanConfig>>,
): Promise<{ loanId: string; escrowAddress: string; escrow: LoanEscrow }> {
  const [loanId, escrowAddress] = await factory.createLoanEscrow.staticCall(config);
  await factory.createLoanEscrow(config);
  const escrow = (await ethers.getContractAt("LoanEscrow", escrowAddress)) as unknown as LoanEscrow;
  return { loanId, escrowAddress, escrow };
}

describe("LoanEscrow", function () {
  let signers: Signers;
  let manager: MockTokenOpsVestingManager;
  let adapter: TokenOpsVestingAdapter;
  let creditAdapter: MockConfidentialCreditAdapter;
  let factory: LoanEscrowFactory;

  before(async function () {
    const ethSigners = await ethers.getSigners();
    signers = {
      borrower: ethSigners[1],
      lender: ethSigners[2],
      relayer: ethSigners[3],
      outsider: ethSigners[4],
    };
  });

  beforeEach(async function () {
    ({ manager, adapter, creditAdapter, factory } = await deployFixture());
  });

  async function authorizeCredit(label: string, payer: HardhatEthersSigner, amount: bigint) {
    const authorization = await auth(label, amount);
    await creditAdapter.authorizeCredit(authorization.authorizationHash, payer.address, amount);
    return authorization;
  }

  async function authorizeExpectedFunding(amount = PRINCIPAL) {
    const authorization = await auth("funding", amount);
    await creditAdapter.authorizeCredit(authorization.authorizationHash, signers.lender.address, amount);
    return authorization;
  }

  async function authorizeExpectedRepayment(amount = TOTAL_DUE) {
    const authorization = await auth("repayment", amount);
    await creditAdapter.authorizeCredit(authorization.authorizationHash, signers.borrower.address, amount);
    return authorization;
  }

  async function transferVestingToAdapter(vestingId: string) {
    const managerAddress = await manager.getAddress();
    const adapterAddress = await adapter.getAddress();
    await manager.seedVesting(vestingId, signers.borrower.address);
    await manager.connect(signers.borrower).initiateVestingTransfer(vestingId, adapterAddress, 86_400);
    await adapter
      .connect(signers.relayer)
      .acceptPendingVestingTransfer(managerAddress, vestingId, signers.borrower.address);
  }

  it("creates loan escrows with matched term commitments", async function () {
    const config = await loanConfig(signers, manager, adapter, creditAdapter);
    const { loanId, escrowAddress, escrow } = await createLoan(factory, config);

    await expect(factory.createLoanEscrow({ ...config, termsHash: id("matched-terms-2") })).to.emit(
      factory,
      "LoanCreated",
    );
    expect(await factory.escrowForLoan(loanId)).to.equal(escrowAddress);
    expect(await escrow.borrower()).to.equal(signers.borrower.address);
    expect(await escrow.lender()).to.equal(signers.lender.address);
    expect(await escrow.termsHash()).to.equal(config.termsHash);
    expect(await escrow.encryptedTermsHash()).to.equal(config.encryptedTermsHash);
    expect(await escrow.state()).to.equal(1n);
  });

  it("lets any caller register collateral once TokenOps custody is ready", async function () {
    const config = await loanConfig(signers, manager, adapter, creditAdapter);
    const { escrow, escrowAddress } = await createLoan(factory, config);
    await transferVestingToAdapter(config.vestingId);

    const pledgeId = await escrow.connect(signers.relayer).registerVestingCollateral.staticCall();
    await expect(escrow.connect(signers.relayer).registerVestingCollateral())
      .to.emit(escrow, "VestingCollateralRegistered")
      .withArgs(pledgeId);

    const pledge = await adapter.getPledge(pledgeId);
    expect(pledge.loanEscrow).to.equal(escrowAddress);
    expect(pledge.borrower).to.equal(signers.borrower.address);
    expect(await escrow.pledgeId()).to.equal(pledgeId);
  });

  it("supports escrows backed by TokenOps vesting ID bytes32(0)", async function () {
    const config = await loanConfig(signers, manager, adapter, creditAdapter, { vestingId: ethers.ZeroHash });
    const { escrow } = await createLoan(factory, config);
    await transferVestingToAdapter(config.vestingId);

    await expect(escrow.connect(signers.relayer).registerVestingCollateral()).to.emit(
      escrow,
      "VestingCollateralRegistered",
    );
    expect(await escrow.vestingId()).to.equal(ethers.ZeroHash);
    expect(await escrow.pledgeId()).to.not.equal(ethers.ZeroHash);
  });

  it("activates after collateral and funding are present without borrower/lender caller restrictions", async function () {
    const config = await loanConfig(signers, manager, adapter, creditAdapter);
    const { escrow } = await createLoan(factory, config);
    await transferVestingToAdapter(config.vestingId);
    await escrow.connect(signers.relayer).registerVestingCollateral();

    const fundingAuth = await authorizeExpectedFunding();
    await expect(escrow.connect(signers.outsider).registerFundingAuthorization(fundingAuth))
      .to.emit(escrow, "FundingAuthorizationRegistered")
      .withArgs(fundingAuth.authorizationHash);
    await expect(escrow.connect(signers.outsider).escrowFunding(fundingAuth))
      .to.emit(escrow, "FundingCredited")
      .withArgs(fundingAuth.authorizationHash);
    await expect(escrow.connect(signers.outsider).escrowFunding(fundingAuth)).to.be.revertedWithCustomError(
      escrow,
      "AuthorizationAlreadyUsed",
    );

    await expect(escrow.connect(signers.relayer).activate()).to.emit(escrow, "LoanActivated");
    expect(await escrow.state()).to.equal(2n);
    expect(await escrow.fundingCredited()).to.equal(true);
  });

  it("draws only the principal from an overfunded lender commitment and preserves the remainder", async function () {
    const config = await loanConfig(signers, manager, adapter, creditAdapter);
    const { escrow } = await createLoan(factory, config);
    await transferVestingToAdapter(config.vestingId);
    await escrow.connect(signers.relayer).registerVestingCollateral();

    const fundingAuth = await auth("funding", PRINCIPAL, config.fundingAuthorizationHash);
    await creditAdapter
      .connect(signers.lender)
      .registerLenderCreditCommitment(config.fundingCommitmentHash, signers.lender.address, fundingAuth.deadline);
    await creditAdapter.authorizeCredit(config.fundingCommitmentHash, signers.lender.address, PRINCIPAL * 2n);
    expect(
      await creditAdapter.isCreditCommitmentExecutable(config.fundingCommitmentHash, signers.lender.address),
    ).to.equal(true);

    await expect(escrow.connect(signers.outsider).registerFundingAuthorization(fundingAuth))
      .to.emit(creditAdapter, "LenderCreditCommitmentBound")
      .withArgs(config.fundingCommitmentHash, fundingAuth.authorizationHash, await escrow.getAddress());
    let commitment = await creditAdapter.getLenderCreditCommitment(config.fundingCommitmentHash);
    expect(commitment.boundAuthorizationHash).to.equal(fundingAuth.authorizationHash);

    await expect(escrow.connect(signers.outsider).escrowFunding(fundingAuth))
      .to.emit(escrow, "FundingCredited")
      .withArgs(fundingAuth.authorizationHash);
    commitment = await creditAdapter.getLenderCreditCommitment(config.fundingCommitmentHash);
    expect(commitment.amount).to.equal(PRINCIPAL);
    expect(commitment.boundAuthorizationHash).to.equal(ethers.ZeroHash);
    expect(commitment.consumed).to.equal(false);
    expect(
      await creditAdapter.isCreditCommitmentExecutable(config.fundingCommitmentHash, signers.lender.address),
    ).to.equal(true);

    await expect(escrow.connect(signers.relayer).activate()).to.emit(escrow, "BorrowerFundingReleased");
    const credit = await creditAdapter.getCredit(fundingAuth.authorizationHash);
    expect(credit.amount).to.equal(PRINCIPAL);
    expect(credit.released).to.equal(true);
    expect(credit.releasedTo).to.equal(signers.borrower.address);
  });

  it("requires confidential credit adapter settlement before funding is credited", async function () {
    const config = await loanConfig(signers, manager, adapter, creditAdapter);
    const { escrow } = await createLoan(factory, config);
    await transferVestingToAdapter(config.vestingId);
    await escrow.connect(signers.relayer).registerVestingCollateral();

    const missingCreditAuth = await auth("funding", PRINCIPAL);
    await expect(escrow.connect(signers.outsider).escrowFunding(missingCreditAuth)).to.be.revertedWithCustomError(
      creditAdapter,
      "CreditDoesNotExist",
    );

    const mismatchedAuth = await auth("funding", PRINCIPAL);
    await creditAdapter.authorizeCredit(mismatchedAuth.authorizationHash, signers.lender.address, PRINCIPAL - 1n);
    await expect(escrow.connect(signers.outsider).escrowFunding(mismatchedAuth)).to.be.revertedWithCustomError(
      escrow,
      "CreditAmountMismatch",
    );
  });

  it("rejects funding and repayment authorizations that do not match the escrow commitments", async function () {
    const config = await loanConfig(signers, manager, adapter, creditAdapter);
    const { escrow } = await createLoan(factory, config);
    const wrongFundingAuth = await authorizeCredit("wrong-funding", signers.lender, PRINCIPAL);

    await expect(
      escrow.connect(signers.outsider).registerFundingAuthorization(wrongFundingAuth),
    ).to.be.revertedWithCustomError(escrow, "InvalidAuthorization");
    await expect(escrow.connect(signers.outsider).escrowFunding(wrongFundingAuth)).to.be.revertedWithCustomError(
      escrow,
      "InvalidAuthorization",
    );

    await transferVestingToAdapter(config.vestingId);
    await escrow.connect(signers.relayer).registerVestingCollateral();
    await escrow.connect(signers.relayer).escrowFunding(await authorizeExpectedFunding());
    await escrow.connect(signers.relayer).activate();

    const wrongPaymentAuth = await authorizeCredit("wrong-repayment", signers.borrower, TOTAL_DUE);
    await expect(
      escrow.connect(signers.outsider).registerPaymentAuthorization(wrongPaymentAuth),
    ).to.be.revertedWithCustomError(escrow, "InvalidAuthorization");
    await expect(escrow.connect(signers.outsider).makeLoanPayment(wrongPaymentAuth)).to.be.revertedWithCustomError(
      escrow,
      "InvalidAuthorization",
    );
  });

  it("accepts relayed payments and returns collateral to the borrower on full repayment", async function () {
    const config = await loanConfig(signers, manager, adapter, creditAdapter);
    const { escrow } = await createLoan(factory, config);
    await transferVestingToAdapter(config.vestingId);
    await escrow.connect(signers.relayer).registerVestingCollateral();
    await escrow.connect(signers.relayer).escrowFunding(await authorizeExpectedFunding());
    await escrow.connect(signers.relayer).activate();
    const registeredPledgeId = await escrow.pledgeId();

    const paymentAuth = await authorizeExpectedRepayment();
    await expect(escrow.connect(signers.outsider).registerPaymentAuthorization(paymentAuth))
      .to.emit(escrow, "PaymentAuthorizationRegistered")
      .withArgs(paymentAuth.authorizationHash);
    await expect(escrow.connect(signers.outsider).makeLoanPayment(paymentAuth))
      .to.emit(escrow, "LoanRepaid")
      .and.to.emit(adapter, "VestingReleaseInitiated")
      .withArgs(registeredPledgeId, signers.borrower.address, anyValue);

    let info = await manager.getVestingInfo(config.vestingId);
    expect(info.recipient).to.equal(await adapter.getAddress());
    await manager.connect(signers.borrower).acceptVestingTransfer(config.vestingId);
    await expect(adapter.connect(signers.relayer).completeRelease(registeredPledgeId))
      .to.emit(adapter, "VestingReleased")
      .withArgs(registeredPledgeId, signers.borrower.address);

    info = await manager.getVestingInfo(config.vestingId);
    expect(info.recipient).to.equal(signers.borrower.address);
    expect(await escrow.state()).to.equal(3n);
    expect(await escrow.repaymentCredited()).to.equal(true);

    await expect(escrow.connect(signers.outsider).checkDefault()).to.be.revertedWithCustomError(escrow, "InvalidState");
    await expect(escrow.connect(signers.outsider).unwindFailedActivation()).to.be.revertedWithCustomError(
      escrow,
      "InvalidState",
    );
    await expect(
      escrow
        .connect(signers.outsider)
        .makeLoanPayment(await authorizeCredit("repay-after-closed", signers.borrower, 1n)),
    ).to.be.revertedWithCustomError(escrow, "InvalidState");
  });

  it("allows public default checks and releases collateral to the lender only after default", async function () {
    const dueTimestamp = Number(await time.latest()) + 60;
    const config = await loanConfig(signers, manager, adapter, creditAdapter, { dueTimestamp, gracePeriodSeconds: 30 });
    const { escrow } = await createLoan(factory, config);
    await transferVestingToAdapter(config.vestingId);
    await escrow.connect(signers.relayer).registerVestingCollateral();
    await escrow.connect(signers.relayer).escrowFunding(await authorizeExpectedFunding());
    await escrow.connect(signers.relayer).activate();
    const registeredPledgeId = await escrow.pledgeId();

    await expect(escrow.connect(signers.outsider).checkDefault()).to.emit(escrow, "DefaultChecked").withArgs(false);
    expect(await escrow.state()).to.equal(2n);

    await time.increaseTo(dueTimestamp + 30);
    await expect(escrow.connect(signers.outsider).checkDefault())
      .to.emit(escrow, "LoanDefaulted")
      .and.to.emit(adapter, "VestingReleaseInitiated")
      .withArgs(registeredPledgeId, signers.lender.address, anyValue);

    let info = await manager.getVestingInfo(config.vestingId);
    expect(info.recipient).to.equal(await adapter.getAddress());
    await manager.connect(signers.lender).acceptVestingTransfer(config.vestingId);
    await expect(adapter.connect(signers.relayer).completeRelease(registeredPledgeId))
      .to.emit(adapter, "VestingReleased")
      .withArgs(registeredPledgeId, signers.lender.address);

    info = await manager.getVestingInfo(config.vestingId);
    expect(info.recipient).to.equal(signers.lender.address);
    expect(await escrow.state()).to.equal(4n);

    await expect(escrow.connect(signers.outsider).checkDefault()).to.be.revertedWithCustomError(escrow, "InvalidState");
    await expect(
      escrow
        .connect(signers.outsider)
        .makeLoanPayment(await authorizeCredit("repay-after-default", signers.borrower, TOTAL_DUE)),
    ).to.be.revertedWithCustomError(escrow, "InvalidState");
  });

  it("unwinds stalled activation publicly after the activation deadline", async function () {
    const activationDeadline = Number(await time.latest()) + 60;
    const config = await loanConfig(signers, manager, adapter, creditAdapter, { activationDeadline });
    const { escrow } = await createLoan(factory, config);
    await transferVestingToAdapter(config.vestingId);
    await escrow.connect(signers.relayer).registerVestingCollateral();
    const registeredPledgeId = await escrow.pledgeId();

    await expect(escrow.connect(signers.outsider).unwindFailedActivation()).to.be.revertedWithCustomError(
      escrow,
      "ActivationWindowOpen",
    );

    await time.increaseTo(activationDeadline + 1);
    await expect(escrow.connect(signers.outsider).unwindFailedActivation())
      .to.emit(escrow, "LoanUnwound")
      .and.to.emit(adapter, "VestingReleaseInitiated")
      .withArgs(registeredPledgeId, signers.borrower.address, anyValue);

    let info = await manager.getVestingInfo(config.vestingId);
    expect(info.recipient).to.equal(await adapter.getAddress());
    await manager.connect(signers.borrower).acceptVestingTransfer(config.vestingId);
    await expect(adapter.connect(signers.relayer).completeRelease(registeredPledgeId))
      .to.emit(adapter, "VestingReleased")
      .withArgs(registeredPledgeId, signers.borrower.address);

    info = await manager.getVestingInfo(config.vestingId);
    expect(info.recipient).to.equal(signers.borrower.address);
    expect(await escrow.state()).to.equal(5n);
  });
});
