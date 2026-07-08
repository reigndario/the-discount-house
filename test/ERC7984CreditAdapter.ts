import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import hre from "hardhat";
import { ethers } from "hardhat";
import { expect } from "chai";
import {
  ERC7984CreditAdapter,
  ERC7984CreditAdapter__factory,
  LoanEscrow,
  LoanEscrowFactory,
  LoanEscrowFactory__factory,
  MockERC7984CallbackToken,
  MockERC7984CallbackToken__factory,
  MockTokenOpsVestingManager,
  MockTokenOpsVestingManager__factory,
  TokenOpsVestingAdapter,
  TokenOpsVestingAdapter__factory,
} from "../types";

type Signers = {
  token: HardhatEthersSigner;
  borrower: HardhatEthersSigner;
  lender: HardhatEthersSigner;
  relayer: HardhatEthersSigner;
};

const PRINCIPAL = 100_000n;
const TOTAL_DUE = 108_000n;

function id(label: string) {
  return ethers.keccak256(ethers.toUtf8Bytes(label));
}

async function encryptedAmountHandle(token: MockERC7984CallbackToken, operator: HardhatEthersSigner, amount: bigint) {
  const input = hre.fhevm.createEncryptedInput(await token.getAddress(), operator.address);
  input.add64(amount);
  const encrypted = await input.encrypt();
  return {
    handle: ethers.hexlify(encrypted.handles[0]),
    proof: ethers.hexlify(encrypted.inputProof),
  };
}

function handleToBytes32(handle: bigint | string): `0x${string}` {
  return (typeof handle === "bigint" ? ethers.toBeHex(handle, 32) : handle) as `0x${string}`;
}

async function mintEncrypted(token: MockERC7984CallbackToken, minter: HardhatEthersSigner, to: string, amount: bigint) {
  const encrypted = await encryptedAmountHandle(token, minter, amount);
  await token.connect(minter).mint(to, encrypted.handle, encrypted.proof);
}

async function confidentialTransferAndCall(
  token: MockERC7984CallbackToken,
  payer: HardhatEthersSigner,
  creditAdapter: ERC7984CreditAdapter,
  authorizationHash: string,
  amount: bigint,
) {
  const encrypted = await encryptedAmountHandle(token, payer, amount);
  return token.connect(payer).getFunction("confidentialTransferAndCall(address,bytes32,bytes,bytes)")(
    await creditAdapter.getAddress(),
    encrypted.handle,
    encrypted.proof,
    ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [authorizationHash]),
  );
}

async function confidentialBalance(token: MockERC7984CallbackToken, account: string) {
  const handle = handleToBytes32(await token.confidentialBalanceOf(account));
  return hre.fhevm.debugger.decryptEuint(FhevmType.euint64, handle);
}

async function acceptanceProof(creditAdapter: ERC7984CreditAdapter, authorizationHash: string) {
  const authorization = await creditAdapter.getAuthorization(authorizationHash);
  const acceptanceHandle = handleToBytes32(authorization.acceptanceHandle);
  const decrypted = await hre.fhevm.publicDecrypt([acceptanceHandle]);
  return {
    accepted: Boolean(decrypted.clearValues[acceptanceHandle]),
    decryptionProof: decrypted.decryptionProof,
  };
}

async function deployFixture() {
  const tokenFactory = (await ethers.getContractFactory(
    "MockERC7984CallbackToken",
  )) as MockERC7984CallbackToken__factory;
  const token = (await tokenFactory.deploy()) as MockERC7984CallbackToken;

  const creditAdapterFactory = (await ethers.getContractFactory(
    "ERC7984CreditAdapter",
  )) as ERC7984CreditAdapter__factory;
  const creditAdapter = (await creditAdapterFactory.deploy(await token.getAddress())) as ERC7984CreditAdapter;

  const vestingManagerFactory = (await ethers.getContractFactory(
    "MockTokenOpsVestingManager",
  )) as MockTokenOpsVestingManager__factory;
  const vestingManager = (await vestingManagerFactory.deploy()) as MockTokenOpsVestingManager;

  const vestingAdapterFactory = (await ethers.getContractFactory(
    "TokenOpsVestingAdapter",
  )) as TokenOpsVestingAdapter__factory;
  const vestingAdapter = (await vestingAdapterFactory.deploy()) as TokenOpsVestingAdapter;

  const loanFactoryFactory = (await ethers.getContractFactory("LoanEscrowFactory")) as LoanEscrowFactory__factory;
  const loanFactory = (await loanFactoryFactory.deploy()) as LoanEscrowFactory;

  return { token, creditAdapter, vestingManager, vestingAdapter, loanFactory };
}

async function loanConfig(
  signers: Signers,
  creditAdapter: ERC7984CreditAdapter,
  vestingManager: MockTokenOpsVestingManager,
  vestingAdapter: TokenOpsVestingAdapter,
) {
  const now = Number(await time.latest());
  return {
    borrower: signers.borrower.address,
    lender: signers.lender.address,
    vestingAdapter: await vestingAdapter.getAddress(),
    creditAdapter: await creditAdapter.getAddress(),
    tokenOpsManager: await vestingManager.getAddress(),
    vestingId: id("erc7984-credit-vesting"),
    dueTimestamp: now + 3600,
    gracePeriodSeconds: 300,
    activationDeadline: now + 900,
    fundingCommitmentHash: id("loan-funding-commitment"),
    fundingAuthorizationHash: id("loan-funding-credit"),
    repaymentAuthorizationHash: id("loan-repayment-credit"),
    termsHash: id("erc7984-credit-terms"),
    encryptedTermsHash: id("erc7984-encrypted-credit-terms"),
  };
}

async function createLoan(
  loanFactory: LoanEscrowFactory,
  config: Awaited<ReturnType<typeof loanConfig>>,
): Promise<LoanEscrow> {
  const [, escrowAddress] = await loanFactory.createLoanEscrow.staticCall(config);
  await loanFactory.createLoanEscrow(config);
  return (await ethers.getContractAt("LoanEscrow", escrowAddress)) as unknown as LoanEscrow;
}

describe("ERC7984CreditAdapter", function () {
  let signers: Signers;

  before(async function () {
    const ethSigners = await ethers.getSigners();
    signers = {
      token: ethSigners[1],
      borrower: ethSigners[2],
      lender: ethSigners[3],
      relayer: ethSigners[4],
    };
  });

  it("binds ERC-7984 callback handles to registered escrow authorizations", async function () {
    const { token, creditAdapter } = await deployFixture();
    const authorizationHash = id("funding-callback");
    const deadline = Number(await time.latest()) + 3600;
    await mintEncrypted(token, signers.token, signers.lender.address, PRINCIPAL);

    await expect(
      creditAdapter.registerAuthorization(
        authorizationHash,
        signers.relayer.address,
        signers.lender.address,
        PRINCIPAL,
        deadline,
      ),
    ).to.be.revertedWithCustomError(creditAdapter, "UnauthorizedCreditRegistrar");

    await expect(
      creditAdapter
        .connect(signers.relayer)
        .registerAuthorization(authorizationHash, signers.relayer.address, signers.lender.address, PRINCIPAL, deadline),
    )
      .to.emit(creditAdapter, "CreditAuthorizationRegistered")
      .withArgs(authorizationHash, signers.relayer.address, signers.lender.address);

    await expect(confidentialTransferAndCall(token, signers.lender, creditAdapter, authorizationHash, PRINCIPAL))
      .to.emit(creditAdapter, "ConfidentialCreditReceived")
      .withArgs(authorizationHash, signers.lender.address, anyValue, anyValue);

    const authorization = await creditAdapter.getAuthorization(authorizationHash);
    expect(authorization.amountHandle).to.not.equal(ethers.ZeroHash);
    expect(authorization.acceptanceHandle).to.not.equal(ethers.ZeroHash);
    expect(authorization.acceptanceFinalized).to.equal(false);
    expect(authorization.accepted).to.equal(false);
    expect(authorization.received).to.equal(true);

    await expect(
      creditAdapter.connect(signers.relayer).consumeCredit(authorizationHash, signers.relayer.address),
    ).to.be.revertedWithCustomError(creditAdapter, "CreditAcceptanceNotFinalized");

    const proof = await acceptanceProof(creditAdapter, authorizationHash);
    expect(proof.accepted).to.equal(true);
    await expect(
      creditAdapter
        .connect(signers.relayer)
        .finalizeCreditAcceptance(authorizationHash, proof.accepted, proof.decryptionProof),
    )
      .to.emit(creditAdapter, "CreditAcceptanceFinalized")
      .withArgs(authorizationHash, true);

    const finalizedAuthorization = await creditAdapter.getAuthorization(authorizationHash);
    expect(finalizedAuthorization.acceptanceFinalized).to.equal(true);
    expect(finalizedAuthorization.accepted).to.equal(true);

    await expect(
      creditAdapter.connect(signers.borrower).consumeCredit(authorizationHash, signers.relayer.address),
    ).to.be.revertedWithCustomError(creditAdapter, "UnauthorizedCreditConsumer");

    const credited = await creditAdapter
      .connect(signers.relayer)
      .consumeCredit.staticCall(authorizationHash, signers.relayer.address);
    expect(credited).to.equal(PRINCIPAL);
    await expect(creditAdapter.connect(signers.relayer).consumeCredit(authorizationHash, signers.relayer.address))
      .to.emit(creditAdapter, "CreditConsumed")
      .withArgs(authorizationHash, signers.relayer.address);
    await expect(
      creditAdapter
        .connect(signers.relayer)
        .releaseCredit(authorizationHash, signers.relayer.address, signers.borrower.address),
    )
      .to.emit(creditAdapter, "CreditReleased")
      .withArgs(authorizationHash, signers.relayer.address, signers.borrower.address, anyValue);
    expect(await confidentialBalance(token, signers.borrower.address)).to.equal(PRINCIPAL);
  });

  it("exposes adapter-verifiable lender credit commitments for preference activation", async function () {
    const { token, creditAdapter } = await deployFixture();
    const commitmentHash = id("erc7984-lender-credit-commitment");
    const drawAuthorizationHash = id("erc7984-lender-credit-draw");
    const deadline = Number(await time.latest()) + 3600;
    await mintEncrypted(token, signers.token, signers.lender.address, PRINCIPAL * 2n);

    expect(await creditAdapter.isCreditCommitmentExecutable(commitmentHash, signers.lender.address)).to.equal(false);
    await expect(
      creditAdapter
        .connect(signers.lender)
        .registerLenderCreditCommitment(commitmentHash, signers.lender.address, deadline),
    )
      .to.emit(creditAdapter, "LenderCreditCommitmentRegistered")
      .withArgs(commitmentHash, signers.lender.address, deadline);

    expect(await creditAdapter.isCreditCommitmentExecutable(commitmentHash, signers.lender.address)).to.equal(false);
    await expect(confidentialTransferAndCall(token, signers.lender, creditAdapter, commitmentHash, PRINCIPAL * 2n))
      .to.emit(creditAdapter, "LenderCreditEscrowed")
      .withArgs(commitmentHash, signers.lender.address, anyValue);

    expect(await creditAdapter.isCreditCommitmentExecutable(commitmentHash, signers.lender.address)).to.equal(true);
    expect(await creditAdapter.isCreditCommitmentExecutable(commitmentHash, signers.borrower.address)).to.equal(false);

    await expect(
      creditAdapter
        .connect(signers.relayer)
        .registerCreditDrawAuthorization(
          drawAuthorizationHash,
          commitmentHash,
          signers.lender.address,
          PRINCIPAL,
          deadline,
        ),
    )
      .to.emit(creditAdapter, "LenderCreditCommitmentBound")
      .withArgs(commitmentHash, drawAuthorizationHash, signers.relayer.address);
    expect(await creditAdapter.isCreditCommitmentExecutable(commitmentHash, signers.lender.address)).to.equal(false);

    const proof = await acceptanceProof(creditAdapter, drawAuthorizationHash);
    expect(proof.accepted).to.equal(true);
    await creditAdapter
      .connect(signers.relayer)
      .finalizeCreditAcceptance(drawAuthorizationHash, proof.accepted, proof.decryptionProof);
    const credited = await creditAdapter
      .connect(signers.relayer)
      .consumeCredit.staticCall(drawAuthorizationHash, signers.relayer.address);
    expect(credited).to.equal(PRINCIPAL);
    await creditAdapter.connect(signers.relayer).consumeCredit(drawAuthorizationHash, signers.relayer.address);
    const remainingCommitment = await creditAdapter.getLenderCreditCommitment(commitmentHash);
    expect(remainingCommitment.boundAuthorizationHash).to.equal(ethers.ZeroHash);
    expect(
      await hre.fhevm.debugger.decryptEuint(FhevmType.euint64, handleToBytes32(remainingCommitment.amountHandle)),
    ).to.equal(PRINCIPAL);
    expect(await creditAdapter.isCreditCommitmentExecutable(commitmentHash, signers.lender.address)).to.equal(true);
    await creditAdapter
      .connect(signers.relayer)
      .releaseCredit(drawAuthorizationHash, signers.relayer.address, signers.borrower.address);
    expect(await confidentialBalance(token, signers.borrower.address)).to.equal(PRINCIPAL);
    expect(await confidentialBalance(token, await creditAdapter.getAddress())).to.equal(PRINCIPAL);
  });

  it("finalizes false callback results and allows retry before consumption", async function () {
    const { token, creditAdapter } = await deployFixture();
    const authorizationHash = id("wrong-amount-callback");
    const deadline = Number(await time.latest()) + 3600;
    await mintEncrypted(token, signers.token, signers.lender.address, PRINCIPAL * 2n);

    await creditAdapter
      .connect(signers.relayer)
      .registerAuthorization(authorizationHash, signers.relayer.address, signers.lender.address, PRINCIPAL, deadline);

    await expect(confidentialTransferAndCall(token, signers.lender, creditAdapter, authorizationHash, PRINCIPAL - 1n))
      .to.emit(creditAdapter, "ConfidentialCreditReceived")
      .withArgs(authorizationHash, signers.lender.address, anyValue, anyValue);

    const rejectedProof = await acceptanceProof(creditAdapter, authorizationHash);
    expect(rejectedProof.accepted).to.equal(false);
    await expect(
      creditAdapter
        .connect(signers.relayer)
        .finalizeCreditAcceptance(authorizationHash, rejectedProof.accepted, rejectedProof.decryptionProof),
    )
      .to.emit(creditAdapter, "CreditAcceptanceFinalized")
      .withArgs(authorizationHash, false);

    const rejectedAuthorization = await creditAdapter.getAuthorization(authorizationHash);
    expect(rejectedAuthorization.received).to.equal(false);
    expect(rejectedAuthorization.amountHandle).to.equal(ethers.ZeroHash);
    expect(rejectedAuthorization.acceptanceHandle).to.equal(ethers.ZeroHash);

    await confidentialTransferAndCall(token, signers.lender, creditAdapter, authorizationHash, PRINCIPAL);

    const acceptedProof = await acceptanceProof(creditAdapter, authorizationHash);
    expect(acceptedProof.accepted).to.equal(true);
    await creditAdapter
      .connect(signers.relayer)
      .finalizeCreditAcceptance(authorizationHash, acceptedProof.accepted, acceptedProof.decryptionProof);
  });

  it("rejects callbacks from non-token callers and unexpected payers", async function () {
    const { token, creditAdapter } = await deployFixture();
    const authorizationHash = id("bad-callback");
    const deadline = Number(await time.latest()) + 3600;
    await creditAdapter
      .connect(signers.relayer)
      .registerAuthorization(authorizationHash, signers.relayer.address, signers.lender.address, PRINCIPAL, deadline);

    const callbackData = ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [authorizationHash]);
    await expect(
      creditAdapter
        .connect(signers.relayer)
        .onConfidentialTransferReceived(signers.lender.address, signers.lender.address, ethers.ZeroHash, callbackData),
    ).to.be.revertedWithCustomError(creditAdapter, "UnauthorizedToken");

    await mintEncrypted(token, signers.token, signers.borrower.address, PRINCIPAL);
    await expect(
      confidentialTransferAndCall(token, signers.borrower, creditAdapter, authorizationHash, PRINCIPAL),
    ).to.be.revertedWithCustomError(creditAdapter, "UnexpectedPayer");
  });

  it("lets LoanEscrow release borrowed confidential USD to the borrower and repayment to the lender", async function () {
    const { token, creditAdapter, vestingManager, vestingAdapter, loanFactory } = await deployFixture();
    const config = await loanConfig(signers, creditAdapter, vestingManager, vestingAdapter);
    const escrow = await createLoan(loanFactory, config);
    const vestingManagerAddress = await vestingManager.getAddress();
    const vestingAdapterAddress = await vestingAdapter.getAddress();

    const authorizationHash = id("loan-funding-credit");
    const deadline = Number(await time.latest()) + 3600;
    await mintEncrypted(token, signers.token, signers.lender.address, PRINCIPAL);
    await vestingManager.seedVesting(config.vestingId, signers.borrower.address);
    await vestingManager
      .connect(signers.borrower)
      .initiateVestingTransfer(config.vestingId, vestingAdapterAddress, 86_400);
    await vestingAdapter
      .connect(signers.relayer)
      .acceptPendingVestingTransfer(vestingManagerAddress, config.vestingId, signers.borrower.address);
    await escrow.connect(signers.relayer).registerVestingCollateral();
    await escrow
      .connect(signers.relayer)
      .registerFundingAuthorization({ amount: PRINCIPAL, deadline, authorizationHash });
    await confidentialTransferAndCall(token, signers.lender, creditAdapter, authorizationHash, PRINCIPAL);

    await expect(
      escrow.connect(signers.relayer).escrowFunding({
        amount: PRINCIPAL,
        deadline,
        authorizationHash,
      }),
    ).to.be.revertedWithCustomError(creditAdapter, "CreditAcceptanceNotFinalized");

    const proof = await acceptanceProof(creditAdapter, authorizationHash);
    await creditAdapter
      .connect(signers.relayer)
      .finalizeCreditAcceptance(authorizationHash, proof.accepted, proof.decryptionProof);

    await expect(
      escrow.connect(signers.relayer).escrowFunding({
        amount: PRINCIPAL,
        deadline,
        authorizationHash,
      }),
    )
      .to.emit(escrow, "FundingCredited")
      .withArgs(authorizationHash);
    expect(await escrow.fundingCredited()).to.equal(true);

    await expect(escrow.connect(signers.relayer).activate())
      .to.emit(escrow, "BorrowerFundingReleased")
      .withArgs(authorizationHash, signers.borrower.address);
    expect(await confidentialBalance(token, signers.borrower.address)).to.equal(PRINCIPAL);

    await mintEncrypted(token, signers.token, signers.borrower.address, TOTAL_DUE);
    const repaymentDeadline = Number(await time.latest()) + 3600;
    const repaymentAuthorizationHash = id("loan-repayment-credit");
    await escrow.connect(signers.relayer).registerPaymentAuthorization({
      amount: TOTAL_DUE,
      deadline: repaymentDeadline,
      authorizationHash: repaymentAuthorizationHash,
    });
    await confidentialTransferAndCall(token, signers.borrower, creditAdapter, repaymentAuthorizationHash, TOTAL_DUE);
    const repaymentProof = await acceptanceProof(creditAdapter, repaymentAuthorizationHash);
    await creditAdapter
      .connect(signers.relayer)
      .finalizeCreditAcceptance(repaymentAuthorizationHash, repaymentProof.accepted, repaymentProof.decryptionProof);
    await expect(
      escrow.connect(signers.relayer).makeLoanPayment({
        amount: TOTAL_DUE,
        deadline: repaymentDeadline,
        authorizationHash: repaymentAuthorizationHash,
      }),
    )
      .to.emit(escrow, "LenderPaymentReleased")
      .withArgs(repaymentAuthorizationHash, signers.lender.address);
    expect(await confidentialBalance(token, signers.lender.address)).to.equal(TOTAL_DUE);
  });
});
