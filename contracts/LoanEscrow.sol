// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {TokenOpsVestingAdapter} from "./TokenOpsVestingAdapter.sol";
import {IConfidentialCreditAdapter} from "./interfaces/IConfidentialCreditAdapter.sol";

/// @title LoanEscrow
/// @notice Bilateral escrow for a matched confidential vesting-backed loan.
/// @dev Funding and repayment are credited through a replaceable confidential-token adapter.
contract LoanEscrow {
    enum LoanState {
        None,
        AwaitingEscrow,
        Active,
        Repaid,
        Defaulted,
        Unwound
    }

    struct LoanConfig {
        address borrower;
        address lender;
        TokenOpsVestingAdapter vestingAdapter;
        IConfidentialCreditAdapter creditAdapter;
        address tokenOpsManager;
        bytes32 vestingId;
        uint64 dueTimestamp;
        uint32 gracePeriodSeconds;
        uint64 activationDeadline;
        bytes32 fundingCommitmentHash;
        bytes32 fundingAuthorizationHash;
        bytes32 repaymentAuthorizationHash;
        bytes32 termsHash;
        bytes32 encryptedTermsHash;
    }

    struct FundingAuth {
        uint256 amount;
        uint64 deadline;
        bytes32 authorizationHash;
    }

    struct PaymentAuth {
        uint256 amount;
        uint64 deadline;
        bytes32 authorizationHash;
    }

    address public immutable factory;
    address public immutable borrower;
    address public immutable lender;
    TokenOpsVestingAdapter public immutable vestingAdapter;
    IConfidentialCreditAdapter public immutable creditAdapter;
    address public immutable tokenOpsManager;
    bytes32 public immutable vestingId;
    uint64 public immutable dueTimestamp;
    uint32 public immutable gracePeriodSeconds;
    uint64 public immutable activationDeadline;
    bytes32 public immutable fundingCommitmentHash;
    bytes32 public immutable fundingAuthorizationHash;
    bytes32 public immutable repaymentAuthorizationHash;
    bytes32 public immutable termsHash;
    bytes32 public immutable encryptedTermsHash;

    LoanState public state;
    bytes32 public pledgeId;
    bool public fundingCredited;
    bool public repaymentCredited;

    mapping(bytes32 authorizationHash => bool used) public usedAuthorization;

    event VestingCollateralRegistered(bytes32 indexed pledgeId);
    event FundingAuthorizationRegistered(bytes32 indexed authorizationHash);
    event FundingCredited(bytes32 indexed authorizationHash);
    event BorrowerFundingReleased(bytes32 indexed authorizationHash, address indexed borrower);
    event LoanActivated();
    event PaymentAuthorizationRegistered(bytes32 indexed authorizationHash);
    event PaymentCredited(bytes32 indexed authorizationHash);
    event LenderPaymentReleased(bytes32 indexed authorizationHash, address indexed lender);
    event DefaultChecked(bool defaulted);
    event LoanRepaid();
    event LoanDefaulted();
    event LoanUnwound();

    error InvalidBorrower();
    error InvalidLender();
    error InvalidVestingAdapter();
    error InvalidCreditAdapter();
    error InvalidTokenOpsManager();
    error InvalidTerms();
    error InvalidDeadline();
    error InvalidAuthorization();
    error AuthorizationExpired();
    error AuthorizationAlreadyUsed(bytes32 authorizationHash);
    error InvalidState(LoanState expected, LoanState actual);
    error CollateralAlreadyRegistered();
    error CollateralNotReady();
    error FundingNotReady();
    error ActivationWindowOpen();
    error CreditAmountMismatch(uint256 expectedAmount, uint256 creditedAmount);

    constructor(LoanConfig memory config) {
        _validateParticipants(config.borrower, config.lender);
        _validateIntegration(config.vestingAdapter, config.creditAdapter, config.tokenOpsManager);
        _validateTerms(
            config.fundingCommitmentHash,
            config.fundingAuthorizationHash,
            config.repaymentAuthorizationHash,
            config.termsHash,
            config.encryptedTermsHash
        );
        _validateDeadlines(config.dueTimestamp, config.activationDeadline);

        factory = msg.sender;
        borrower = config.borrower;
        lender = config.lender;
        vestingAdapter = config.vestingAdapter;
        creditAdapter = config.creditAdapter;
        tokenOpsManager = config.tokenOpsManager;
        vestingId = config.vestingId;
        dueTimestamp = config.dueTimestamp;
        gracePeriodSeconds = config.gracePeriodSeconds;
        activationDeadline = config.activationDeadline;
        fundingCommitmentHash = config.fundingCommitmentHash;
        fundingAuthorizationHash = config.fundingAuthorizationHash;
        repaymentAuthorizationHash = config.repaymentAuthorizationHash;
        termsHash = config.termsHash;
        encryptedTermsHash = config.encryptedTermsHash;
        state = LoanState.AwaitingEscrow;
    }

    function registerVestingCollateral() external returns (bytes32 registeredPledgeId) {
        _requireState(LoanState.AwaitingEscrow);
        if (pledgeId != bytes32(0)) {
            revert CollateralAlreadyRegistered();
        }

        registeredPledgeId = vestingAdapter.registerPledge(tokenOpsManager, vestingId, borrower);
        pledgeId = registeredPledgeId;
        emit VestingCollateralRegistered(registeredPledgeId);
    }

    function registerFundingAuthorization(FundingAuth calldata auth) external {
        _requireState(LoanState.AwaitingEscrow);
        _validateAuthorizationShape(auth.amount, auth.deadline, auth.authorizationHash);
        _requireExpectedAuthorization(auth.authorizationHash, fundingAuthorizationHash);
        creditAdapter.registerCreditDrawAuthorization(
            auth.authorizationHash,
            fundingCommitmentHash,
            lender,
            auth.amount,
            auth.deadline
        );
        emit FundingAuthorizationRegistered(auth.authorizationHash);
    }

    function escrowFunding(FundingAuth calldata auth) external {
        _requireState(LoanState.AwaitingEscrow);
        _requireExpectedAuthorization(auth.authorizationHash, fundingAuthorizationHash);
        _consumeAuthorization(auth.amount, auth.deadline, auth.authorizationHash);

        uint256 creditedAmount = creditAdapter.consumeCredit(auth.authorizationHash, address(this));
        if (creditedAmount != auth.amount) {
            revert CreditAmountMismatch(auth.amount, creditedAmount);
        }

        fundingCredited = true;
        emit FundingCredited(auth.authorizationHash);
    }

    function activate() external {
        _requireState(LoanState.AwaitingEscrow);
        if (pledgeId == bytes32(0)) {
            revert CollateralNotReady();
        }
        if (!fundingCredited) {
            revert FundingNotReady();
        }

        state = LoanState.Active;
        creditAdapter.releaseCredit(fundingAuthorizationHash, address(this), borrower);
        emit BorrowerFundingReleased(fundingAuthorizationHash, borrower);
        emit LoanActivated();
    }

    function registerPaymentAuthorization(PaymentAuth calldata auth) external {
        _requireState(LoanState.Active);
        _validateAuthorizationShape(auth.amount, auth.deadline, auth.authorizationHash);
        _requireExpectedAuthorization(auth.authorizationHash, repaymentAuthorizationHash);
        creditAdapter.registerCreditAuthorization(auth.authorizationHash, borrower, auth.amount, auth.deadline);
        emit PaymentAuthorizationRegistered(auth.authorizationHash);
    }

    function makeLoanPayment(PaymentAuth calldata auth) external {
        _requireState(LoanState.Active);
        _requireExpectedAuthorization(auth.authorizationHash, repaymentAuthorizationHash);
        _consumeAuthorization(auth.amount, auth.deadline, auth.authorizationHash);

        uint256 creditedAmount = creditAdapter.consumeCredit(auth.authorizationHash, address(this));
        if (creditedAmount != auth.amount) {
            revert CreditAmountMismatch(auth.amount, creditedAmount);
        }

        repaymentCredited = true;
        emit PaymentCredited(auth.authorizationHash);

        state = LoanState.Repaid;
        creditAdapter.releaseCredit(auth.authorizationHash, address(this), lender);
        emit LenderPaymentReleased(auth.authorizationHash, lender);
        vestingAdapter.releasePledge(pledgeId, borrower);
        emit LoanRepaid();
    }

    function checkDefault() external returns (bool defaulted) {
        _requireState(LoanState.Active);

        defaulted = block.timestamp >= dueTimestamp + gracePeriodSeconds && !repaymentCredited;
        emit DefaultChecked(defaulted);

        if (defaulted) {
            state = LoanState.Defaulted;
            vestingAdapter.releasePledge(pledgeId, lender);
            emit LoanDefaulted();
        }
    }

    function unwindFailedActivation() external {
        _requireState(LoanState.AwaitingEscrow);
        if (block.timestamp <= activationDeadline) {
            revert ActivationWindowOpen();
        }

        state = LoanState.Unwound;
        if (pledgeId != bytes32(0)) {
            vestingAdapter.releasePledge(pledgeId, borrower);
        }
        emit LoanUnwound();
    }

    function isFullyFunded() external view returns (bool) {
        return fundingCredited;
    }

    function isFullyRepaid() external view returns (bool) {
        return repaymentCredited;
    }

    function _validateParticipants(address borrower_, address lender_) private pure {
        if (borrower_ == address(0)) {
            revert InvalidBorrower();
        }
        if (lender_ == address(0) || lender_ == borrower_) {
            revert InvalidLender();
        }
    }

    function _validateIntegration(
        TokenOpsVestingAdapter vestingAdapter_,
        IConfidentialCreditAdapter creditAdapter_,
        address tokenOpsManager_
    ) private pure {
        if (address(vestingAdapter_) == address(0)) {
            revert InvalidVestingAdapter();
        }
        if (address(creditAdapter_) == address(0)) {
            revert InvalidCreditAdapter();
        }
        if (tokenOpsManager_ == address(0)) {
            revert InvalidTokenOpsManager();
        }
    }

    function _validateTerms(
        bytes32 fundingCommitmentHash_,
        bytes32 fundingAuthorizationHash_,
        bytes32 repaymentAuthorizationHash_,
        bytes32 termsHash_,
        bytes32 encryptedTermsHash_
    ) private pure {
        if (
            fundingCommitmentHash_ == bytes32(0) ||
            fundingAuthorizationHash_ == bytes32(0) ||
            repaymentAuthorizationHash_ == bytes32(0)
        ) {
            revert InvalidTerms();
        }
        if (termsHash_ == bytes32(0) || encryptedTermsHash_ == bytes32(0)) {
            revert InvalidTerms();
        }
    }

    function _validateDeadlines(uint64 dueTimestamp_, uint64 activationDeadline_) private view {
        if (dueTimestamp_ <= block.timestamp || activationDeadline_ <= block.timestamp) {
            revert InvalidDeadline();
        }
    }

    function _consumeAuthorization(uint256 amount, uint64 deadline, bytes32 authorizationHash) private {
        _validateAuthorizationShape(amount, deadline, authorizationHash);
        if (usedAuthorization[authorizationHash]) {
            revert AuthorizationAlreadyUsed(authorizationHash);
        }
        usedAuthorization[authorizationHash] = true;
    }

    function _requireExpectedAuthorization(bytes32 authorizationHash, bytes32 expectedAuthorizationHash) private pure {
        if (authorizationHash != expectedAuthorizationHash) {
            revert InvalidAuthorization();
        }
    }

    function _validateAuthorizationShape(uint256 amount, uint64 deadline, bytes32 authorizationHash) private view {
        if (amount == 0 || authorizationHash == bytes32(0)) {
            revert InvalidAuthorization();
        }
        if (deadline < block.timestamp) {
            revert AuthorizationExpired();
        }
    }

    function _requireState(LoanState expected) private view {
        if (state != expected) {
            revert InvalidState(expected, state);
        }
    }
}
