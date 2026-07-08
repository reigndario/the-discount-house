// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IConfidentialCreditAdapter} from "../interfaces/IConfidentialCreditAdapter.sol";
import {IConfidentialCreditCommitmentVerifier} from "../interfaces/IConfidentialCreditCommitmentVerifier.sol";

/// @title MockConfidentialCreditAdapter
/// @notice Local cleartext stand-in for ERC-7984 confidential cUSDT/cUSDC transfer settlement.
contract MockConfidentialCreditAdapter is IConfidentialCreditAdapter, IConfidentialCreditCommitmentVerifier {
    struct AuthorizedCredit {
        address payer;
        uint256 amount;
        bool consumed;
        bool released;
        address releasedTo;
    }

    struct LenderCreditCommitment {
        address manager;
        uint64 expiry;
        uint256 amount;
        bytes32 boundAuthorizationHash;
        bool registered;
        bool received;
        bool consumed;
    }

    mapping(bytes32 authorizationHash => AuthorizedCredit credit) private _credits;
    mapping(bytes32 commitmentHash => LenderCreditCommitment commitment) private _lenderCreditCommitments;
    mapping(bytes32 authorizationHash => bytes32 commitmentHash) private _authorizationCommitmentHash;

    event CreditAuthorized(bytes32 indexed authorizationHash, address indexed payer);
    event CreditAuthorizationRegistered(bytes32 indexed authorizationHash, address indexed loanEscrow, address payer);
    event CreditConsumed(bytes32 indexed authorizationHash, address indexed loanEscrow);
    event CreditReleased(bytes32 indexed authorizationHash, address indexed loanEscrow, address indexed recipient);
    event LenderCreditCommitmentRegistered(bytes32 indexed commitmentHash, address indexed manager, uint64 expiry);
    event LenderCreditEscrowed(bytes32 indexed commitmentHash, address indexed manager, uint256 amount);
    event LenderCreditCommitmentBound(
        bytes32 indexed commitmentHash,
        bytes32 indexed authorizationHash,
        address loanEscrow
    );

    error InvalidAuthorizationHash();
    error InvalidPayer();
    error InvalidAmount();
    error CreditDoesNotExist(bytes32 authorizationHash);
    error CreditAlreadyConsumed(bytes32 authorizationHash);
    error CreditAlreadyReleased(bytes32 authorizationHash);
    error UnauthorizedCreditConsumer(address caller, address expectedLoanEscrow);
    error CommitmentAlreadyRegistered(bytes32 commitmentHash);
    error CommitmentNotReceived(bytes32 commitmentHash);
    error CommitmentAlreadyConsumed(bytes32 commitmentHash);
    error CommitmentAlreadyBound(bytes32 commitmentHash, bytes32 authorizationHash);
    error UnexpectedPayer(address expectedPayer, address actualPayer);

    function registerCreditAuthorization(
        bytes32 authorizationHash,
        address expectedPayer,
        uint256 expectedAmount,
        uint64 deadline
    ) external {
        _validateCreditAuthorizationInput(authorizationHash, expectedPayer, expectedAmount, deadline);
        _bindCommitmentAuthorizationIfPresent(authorizationHash, authorizationHash, expectedPayer, expectedAmount);
        emit CreditAuthorizationRegistered(authorizationHash, msg.sender, expectedPayer);
    }

    function registerCreditDrawAuthorization(
        bytes32 authorizationHash,
        bytes32 commitmentHash,
        address expectedPayer,
        uint256 expectedAmount,
        uint64 deadline
    ) external {
        _validateCreditAuthorizationInput(authorizationHash, expectedPayer, expectedAmount, deadline);
        _bindCommitmentAuthorizationIfPresent(authorizationHash, commitmentHash, expectedPayer, expectedAmount);
        emit CreditAuthorizationRegistered(authorizationHash, msg.sender, expectedPayer);
    }

    function _validateCreditAuthorizationInput(
        bytes32 authorizationHash,
        address expectedPayer,
        uint256 expectedAmount,
        uint64 deadline
    ) private view {
        if (authorizationHash == bytes32(0)) {
            revert InvalidAuthorizationHash();
        }
        if (expectedPayer == address(0)) {
            revert InvalidPayer();
        }
        if (expectedAmount == 0 || deadline <= block.timestamp) {
            revert InvalidAmount();
        }
    }

    function _bindCommitmentAuthorizationIfPresent(
        bytes32 authorizationHash,
        bytes32 commitmentHash,
        address expectedPayer,
        uint256 expectedAmount
    ) private {
        LenderCreditCommitment storage commitment = _lenderCreditCommitments[commitmentHash];
        if (!commitment.registered) {
            return;
        }
        _requireBindableCommitment(commitmentHash, commitment, expectedPayer, expectedAmount);

        _credits[authorizationHash] = AuthorizedCredit({
            payer: expectedPayer,
            amount: expectedAmount,
            consumed: false,
            released: false,
            releasedTo: address(0)
        });
        _authorizationCommitmentHash[authorizationHash] = commitmentHash;
        commitment.boundAuthorizationHash = authorizationHash;
        emit LenderCreditCommitmentBound(commitmentHash, authorizationHash, msg.sender);
    }

    function _requireBindableCommitment(
        bytes32 authorizationHash,
        LenderCreditCommitment storage commitment,
        address expectedPayer,
        uint256 expectedAmount
    ) private view {
        if (commitment.manager != expectedPayer) {
            revert UnexpectedPayer(commitment.manager, expectedPayer);
        }
        if (!commitment.received) {
            revert CommitmentNotReceived(authorizationHash);
        }
        if (commitment.consumed) {
            revert CommitmentAlreadyConsumed(authorizationHash);
        }
        if (commitment.boundAuthorizationHash != bytes32(0)) {
            revert CommitmentAlreadyBound(authorizationHash, commitment.boundAuthorizationHash);
        }
        if (commitment.amount < expectedAmount) {
            revert InvalidAmount();
        }
    }

    function authorizeCredit(bytes32 authorizationHash, address payer, uint256 amount) external {
        if (authorizationHash == bytes32(0)) {
            revert InvalidAuthorizationHash();
        }
        if (payer == address(0)) {
            revert InvalidPayer();
        }
        if (amount == 0) {
            revert InvalidAmount();
        }

        _credits[authorizationHash] = AuthorizedCredit({
            payer: payer,
            amount: amount,
            consumed: false,
            released: false,
            releasedTo: address(0)
        });

        LenderCreditCommitment storage commitment = _lenderCreditCommitments[authorizationHash];
        if (commitment.registered && commitment.manager == payer && !commitment.received) {
            commitment.amount = amount;
            commitment.received = true;
            emit LenderCreditEscrowed(authorizationHash, payer, amount);
        }
        emit CreditAuthorized(authorizationHash, payer);
    }

    function registerLenderCreditCommitment(bytes32 commitmentHash, address manager, uint64 expiry) external {
        if (commitmentHash == bytes32(0)) {
            revert InvalidAuthorizationHash();
        }
        if (manager == address(0)) {
            revert InvalidPayer();
        }
        if (expiry <= block.timestamp) {
            revert InvalidAmount();
        }
        if (_lenderCreditCommitments[commitmentHash].registered) {
            revert CommitmentAlreadyRegistered(commitmentHash);
        }

        _lenderCreditCommitments[commitmentHash] = LenderCreditCommitment({
            manager: manager,
            expiry: expiry,
            amount: 0,
            boundAuthorizationHash: bytes32(0),
            registered: true,
            received: false,
            consumed: false
        });
        emit LenderCreditCommitmentRegistered(commitmentHash, manager, expiry);
    }

    function consumeCredit(bytes32 authorizationHash, address loanEscrow) external returns (uint256 creditedAmount) {
        if (msg.sender != loanEscrow) {
            revert UnauthorizedCreditConsumer(msg.sender, loanEscrow);
        }

        AuthorizedCredit storage credit = _credits[authorizationHash];
        if (credit.amount == 0) {
            revert CreditDoesNotExist(authorizationHash);
        }
        if (credit.consumed) {
            revert CreditAlreadyConsumed(authorizationHash);
        }

        credit.consumed = true;
        bytes32 commitmentHash = _authorizationCommitmentHash[authorizationHash];
        LenderCreditCommitment storage commitment = _lenderCreditCommitments[commitmentHash];
        if (commitmentHash != bytes32(0)) {
            commitment.amount -= credit.amount;
            commitment.boundAuthorizationHash = bytes32(0);
            commitment.consumed = commitment.amount == 0;
        }
        creditedAmount = credit.amount;
        emit CreditConsumed(authorizationHash, loanEscrow);
    }

    function releaseCredit(
        bytes32 authorizationHash,
        address loanEscrow,
        address recipient
    ) external returns (bytes32 releasedAmountHandle) {
        if (msg.sender != loanEscrow) {
            revert UnauthorizedCreditConsumer(msg.sender, loanEscrow);
        }

        AuthorizedCredit storage credit = _credits[authorizationHash];
        if (credit.amount == 0) {
            revert CreditDoesNotExist(authorizationHash);
        }
        if (!credit.consumed) {
            revert CreditDoesNotExist(authorizationHash);
        }
        if (credit.released) {
            revert CreditAlreadyReleased(authorizationHash);
        }

        credit.released = true;
        credit.releasedTo = recipient;
        releasedAmountHandle = bytes32(uint256(credit.amount));
        emit CreditReleased(authorizationHash, loanEscrow, recipient);
    }

    function getCredit(bytes32 authorizationHash) external view returns (AuthorizedCredit memory) {
        return _credits[authorizationHash];
    }

    function getLenderCreditCommitment(bytes32 commitmentHash) external view returns (LenderCreditCommitment memory) {
        return _lenderCreditCommitments[commitmentHash];
    }

    function isCreditCommitmentExecutable(
        bytes32 commitmentHash,
        address manager
    ) external view returns (bool executable) {
        LenderCreditCommitment storage commitment = _lenderCreditCommitments[commitmentHash];
        return
            commitment.registered &&
            commitment.received &&
            !commitment.consumed &&
            commitment.boundAuthorizationHash == bytes32(0) &&
            commitment.manager == manager &&
            commitment.expiry > block.timestamp;
    }
}
