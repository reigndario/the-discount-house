// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {BondManager} from "./BondManager.sol";
import {ConfidentialPreferenceBook} from "./ConfidentialPreferenceBook.sol";
import {LoanEscrow} from "./LoanEscrow.sol";
import {LoanEscrowFactory} from "./LoanEscrowFactory.sol";
import {NashNegotiationEngine} from "./NashNegotiationEngine.sol";

/// @title MatchSettlementCoordinator
/// @notice Connects executed match attempts, bond settlement, and loan escrow creation.
/// @dev Matching is execute-only; this contract does not perform free preview or inspect plaintext terms.
contract MatchSettlementCoordinator {
    BondManager public immutable bondManager;
    NashNegotiationEngine public immutable negotiationEngine;
    LoanEscrowFactory public immutable loanEscrowFactory;

    mapping(bytes32 bondAttemptId => bool settled) public settledBondAttempts;
    mapping(bytes32 matchAttemptId => bool settled) public settledMatchAttempts;

    event MatchSettlementSucceeded(
        bytes32 indexed bondAttemptId,
        bytes32 indexed matchAttemptId,
        bytes32 indexed loanId,
        address escrow,
        bytes32 termsHash
    );
    event MatchSettlementFailed(bytes32 indexed bondAttemptId, bytes32 indexed matchAttemptId);

    error InvalidBondManager();
    error InvalidNegotiationEngine();
    error InvalidLoanEscrowFactory();
    error BondAttemptAlreadySettled(bytes32 bondAttemptId);
    error MatchAttemptAlreadySettled(bytes32 matchAttemptId);
    error MatchDidNotSucceed();
    error MatchDidNotFail();
    error LoanConfigMismatch();
    error LoanParticipantMismatch();

    constructor(
        BondManager bondManager_,
        NashNegotiationEngine negotiationEngine_,
        LoanEscrowFactory loanEscrowFactory_
    ) {
        if (address(bondManager_) == address(0)) {
            revert InvalidBondManager();
        }
        if (address(negotiationEngine_) == address(0)) {
            revert InvalidNegotiationEngine();
        }
        if (address(loanEscrowFactory_) == address(0)) {
            revert InvalidLoanEscrowFactory();
        }

        bondManager = bondManager_;
        negotiationEngine = negotiationEngine_;
        loanEscrowFactory = loanEscrowFactory_;
    }

    function settleSuccessfulMatch(
        bytes32 bondAttemptId,
        bytes32 matchAttemptId,
        LoanEscrow.LoanConfig calldata loanConfig
    ) external returns (bytes32 loanId, address escrow) {
        _requireUnsettled(bondAttemptId, matchAttemptId);

        NashNegotiationEngine.MatchAttempt memory attempt = negotiationEngine.getAttempt(matchAttemptId);
        if (attempt.status != NashNegotiationEngine.AttemptStatus.Succeeded) {
            revert MatchDidNotSucceed();
        }
        if (loanConfig.termsHash != attempt.termsHash || loanConfig.encryptedTermsHash != attempt.encryptedTermsHash) {
            revert LoanConfigMismatch();
        }
        _requireMatchedParticipants(attempt, loanConfig);

        settledBondAttempts[bondAttemptId] = true;
        settledMatchAttempts[matchAttemptId] = true;
        bondManager.refundBond(bondAttemptId);
        (loanId, escrow) = loanEscrowFactory.createLoanEscrow(loanConfig);

        emit MatchSettlementSucceeded(bondAttemptId, matchAttemptId, loanId, escrow, attempt.termsHash);
    }

    function settleFailedMatch(
        bytes32 bondAttemptId,
        bytes32 matchAttemptId,
        address payable[] calldata counterparties
    ) external {
        _requireUnsettled(bondAttemptId, matchAttemptId);
        NashNegotiationEngine.MatchAttempt memory attempt = negotiationEngine.getAttempt(matchAttemptId);
        if (attempt.status != NashNegotiationEngine.AttemptStatus.Failed) {
            revert MatchDidNotFail();
        }

        settledBondAttempts[bondAttemptId] = true;
        settledMatchAttempts[matchAttemptId] = true;
        bondManager.slashBond(bondAttemptId, counterparties);
        emit MatchSettlementFailed(bondAttemptId, matchAttemptId);
    }

    function _requireUnsettled(bytes32 bondAttemptId, bytes32 matchAttemptId) private view {
        if (settledBondAttempts[bondAttemptId]) {
            revert BondAttemptAlreadySettled(bondAttemptId);
        }
        if (settledMatchAttempts[matchAttemptId]) {
            revert MatchAttemptAlreadySettled(matchAttemptId);
        }
    }

    function _requireMatchedParticipants(
        NashNegotiationEngine.MatchAttempt memory attempt,
        LoanEscrow.LoanConfig calldata loanConfig
    ) private view {
        ConfidentialPreferenceBook preferenceBook = negotiationEngine.preferenceBook();
        ConfidentialPreferenceBook.PreferenceBundle memory taker = preferenceBook.getPreferenceBundle(
            attempt.takerPreferenceId
        );
        ConfidentialPreferenceBook.PreferenceBundle memory maker = preferenceBook.getPreferenceBundle(
            attempt.makerPreferenceId
        );

        ConfidentialPreferenceBook.PreferenceBundle memory borrowerPreference =
            taker.metadata.side == uint8(ConfidentialPreferenceBook.Side.Borrower) ? taker : maker;
        ConfidentialPreferenceBook.PreferenceBundle memory lenderPreference =
            taker.metadata.side == uint8(ConfidentialPreferenceBook.Side.Lender) ? taker : maker;

        if (loanConfig.borrower != borrowerPreference.manager || loanConfig.lender != lenderPreference.manager) {
            revert LoanParticipantMismatch();
        }
        _requireMatchedBacking(preferenceBook, borrowerPreference, lenderPreference, loanConfig);
    }

    function _requireMatchedBacking(
        ConfidentialPreferenceBook preferenceBook,
        ConfidentialPreferenceBook.PreferenceBundle memory borrowerPreference,
        ConfidentialPreferenceBook.PreferenceBundle memory lenderPreference,
        LoanEscrow.LoanConfig calldata loanConfig
    ) private view {
        ConfidentialPreferenceBook.BorrowerBackingEvidence memory borrowerEvidence = preferenceBook
            .getBorrowerBackingEvidence(borrowerPreference.backingId);
        ConfidentialPreferenceBook.LenderBackingEvidence memory lenderEvidence = preferenceBook
            .getLenderBackingEvidence(lenderPreference.backingId);

        if (
            !borrowerEvidence.registered ||
            borrowerEvidence.manager != borrowerPreference.manager ||
            borrowerEvidence.tokenOpsManager != loanConfig.tokenOpsManager ||
            borrowerEvidence.vestingAdapter != address(loanConfig.vestingAdapter) ||
            borrowerEvidence.vestingId != loanConfig.vestingId ||
            !lenderEvidence.registered ||
            lenderEvidence.manager != lenderPreference.manager ||
            lenderEvidence.creditAdapter != address(loanConfig.creditAdapter) ||
            lenderEvidence.commitmentHash != loanConfig.fundingCommitmentHash
        ) {
            revert LoanConfigMismatch();
        }
    }
}
