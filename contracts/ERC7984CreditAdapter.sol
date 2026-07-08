// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IERC7984Receiver} from "@openzeppelin/confidential-contracts/interfaces/IERC7984Receiver.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {FHE, ebool, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {IConfidentialCreditAdapter} from "./interfaces/IConfidentialCreditAdapter.sol";
import {IConfidentialCreditCommitmentVerifier} from "./interfaces/IConfidentialCreditCommitmentVerifier.sol";

/// @title ERC7984CreditAdapter
/// @notice Receives ERC-7984 confidential transfers and binds encrypted amount handles to escrow authorizations.
/// @dev `expectedAmount` is the clear protocol amount used by current LoanEscrow accounting. Reusable lender
/// commitments are partial-draw capable: a larger encrypted commitment can satisfy a smaller draw without releasing
/// the entire committed amount.
contract ERC7984CreditAdapter is
    ZamaEthereumConfig,
    IConfidentialCreditAdapter,
    IConfidentialCreditCommitmentVerifier,
    IERC7984Receiver
{
    struct CreditAuthorization {
        address loanEscrow;
        address expectedPayer;
        uint256 expectedAmount;
        uint64 deadline;
        address payer;
        bytes32 amountHandle;
        bytes32 acceptanceHandle;
        bytes32 commitmentHash;
        bytes32 remainingAmountHandle;
        address releasedTo;
        bytes32 releasedAmountHandle;
        bool fromCommitment;
        bool acceptanceFinalized;
        bool accepted;
        bool received;
        bool consumed;
        bool released;
    }

    struct LenderCreditCommitment {
        address manager;
        uint64 expiry;
        bytes32 amountHandle;
        bytes32 boundAuthorizationHash;
        bool registered;
        bool received;
        bool consumed;
    }

    struct AuthorizationRegistration {
        bytes32 authorizationHash;
        bytes32 commitmentHash;
        address loanEscrow;
        address expectedPayer;
        uint256 expectedAmount;
        uint64 deadline;
    }

    address public immutable token;

    mapping(bytes32 authorizationHash => CreditAuthorization authorization) private _authorizations;
    mapping(bytes32 commitmentHash => LenderCreditCommitment commitment) private _lenderCreditCommitments;

    event CreditAuthorizationRegistered(
        bytes32 indexed authorizationHash,
        address indexed loanEscrow,
        address indexed expectedPayer
    );
    event ConfidentialCreditReceived(
        bytes32 indexed authorizationHash,
        address indexed payer,
        bytes32 amountHandle,
        bytes32 acceptanceHandle
    );
    event CreditAcceptanceFinalized(bytes32 indexed authorizationHash, bool accepted);
    event CreditConsumed(bytes32 indexed authorizationHash, address indexed loanEscrow);
    event CreditReleased(
        bytes32 indexed authorizationHash,
        address indexed loanEscrow,
        address indexed recipient,
        bytes32 releasedAmountHandle
    );
    event LenderCreditCommitmentRegistered(bytes32 indexed commitmentHash, address indexed manager, uint64 expiry);
    event LenderCreditEscrowed(bytes32 indexed commitmentHash, address indexed manager, bytes32 amountHandle);
    event LenderCreditCommitmentBound(
        bytes32 indexed commitmentHash,
        bytes32 indexed authorizationHash,
        address loanEscrow
    );

    error InvalidToken();
    error UnauthorizedToken(address caller);
    error InvalidAuthorizationHash();
    error InvalidLoanEscrow();
    error InvalidExpectedPayer();
    error InvalidExpectedAmount();
    error InvalidDeadline();
    error AuthorizationAlreadyRegistered(bytes32 authorizationHash);
    error AuthorizationDoesNotExist(bytes32 authorizationHash);
    error AuthorizationExpired(bytes32 authorizationHash);
    error UnexpectedPayer(address expectedPayer, address actualPayer);
    error UnexpectedLoanEscrow(address expectedLoanEscrow, address actualLoanEscrow);
    error UnauthorizedCreditRegistrar(address caller, address expectedLoanEscrow);
    error UnauthorizedCreditConsumer(address caller, address expectedLoanEscrow);
    error CreditNotReceived(bytes32 authorizationHash);
    error CreditAcceptanceNotReady(bytes32 authorizationHash);
    error CreditAcceptanceAlreadyFinalized(bytes32 authorizationHash);
    error CreditAcceptanceNotFinalized(bytes32 authorizationHash);
    error CreditRejected(bytes32 authorizationHash);
    error CreditAlreadyConsumed(bytes32 authorizationHash);
    error CreditAlreadyReleased(bytes32 authorizationHash);
    error InvalidRecipient();
    error CommitmentAlreadyRegistered(bytes32 commitmentHash);
    error CommitmentDoesNotExist(bytes32 commitmentHash);
    error CommitmentExpired(bytes32 commitmentHash);
    error CommitmentNotReceived(bytes32 commitmentHash);
    error CommitmentAlreadyReceived(bytes32 commitmentHash);
    error CommitmentAlreadyConsumed(bytes32 commitmentHash);
    error CommitmentAlreadyBound(bytes32 commitmentHash, bytes32 authorizationHash);

    constructor(address token_) {
        if (token_ == address(0)) {
            revert InvalidToken();
        }
        token = token_;
    }

    function registerAuthorization(
        bytes32 authorizationHash,
        address loanEscrow,
        address expectedPayer,
        uint256 expectedAmount,
        uint64 deadline
    ) external {
        if (msg.sender != loanEscrow) {
            revert UnauthorizedCreditRegistrar(msg.sender, loanEscrow);
        }
        _registerAuthorization(
            authorizationHash,
            authorizationHash,
            loanEscrow,
            expectedPayer,
            expectedAmount,
            deadline
        );
    }

    function registerCreditAuthorization(
        bytes32 authorizationHash,
        address expectedPayer,
        uint256 expectedAmount,
        uint64 deadline
    ) external {
        _registerAuthorization(
            authorizationHash,
            authorizationHash,
            msg.sender,
            expectedPayer,
            expectedAmount,
            deadline
        );
    }

    function registerCreditDrawAuthorization(
        bytes32 authorizationHash,
        bytes32 commitmentHash,
        address expectedPayer,
        uint256 expectedAmount,
        uint64 deadline
    ) external {
        _registerAuthorization(authorizationHash, commitmentHash, msg.sender, expectedPayer, expectedAmount, deadline);
    }

    function registerLenderCreditCommitment(bytes32 commitmentHash, address manager, uint64 expiry) external {
        if (commitmentHash == bytes32(0)) {
            revert InvalidAuthorizationHash();
        }
        if (manager == address(0)) {
            revert InvalidExpectedPayer();
        }
        if (expiry <= block.timestamp) {
            revert InvalidDeadline();
        }
        if (_lenderCreditCommitments[commitmentHash].registered) {
            revert CommitmentAlreadyRegistered(commitmentHash);
        }

        _lenderCreditCommitments[commitmentHash] = LenderCreditCommitment({
            manager: manager,
            expiry: expiry,
            amountHandle: bytes32(0),
            boundAuthorizationHash: bytes32(0),
            registered: true,
            received: false,
            consumed: false
        });
        emit LenderCreditCommitmentRegistered(commitmentHash, manager, expiry);
    }

    function _bindCommitmentAuthorization(AuthorizationRegistration memory registration) private returns (bool bound) {
        LenderCreditCommitment storage commitment = _lenderCreditCommitments[registration.commitmentHash];
        if (!commitment.registered) {
            return false;
        }
        _requireBindableCommitment(
            registration.commitmentHash,
            commitment,
            registration.expectedPayer,
            registration.deadline
        );

        euint64 amount = euint64.wrap(commitment.amountHandle);
        euint64 requestedDraw = FHE.asEuint64(uint64(registration.expectedAmount));
        ebool accepted = FHE.ge(amount, requestedDraw);
        euint64 selectedDraw = FHE.select(accepted, requestedDraw, FHE.asEuint64(0));
        euint64 remainingAmount = FHE.sub(amount, selectedDraw);
        FHE.allowThis(selectedDraw);
        FHE.allowThis(remainingAmount);
        FHE.allowThis(accepted);
        FHE.makePubliclyDecryptable(accepted);

        _storeBoundAuthorization(registration, selectedDraw, remainingAmount, accepted);
        commitment.boundAuthorizationHash = registration.authorizationHash;
        emit LenderCreditCommitmentBound(
            registration.commitmentHash,
            registration.authorizationHash,
            registration.loanEscrow
        );
        return true;
    }

    function _requireBindableCommitment(
        bytes32 authorizationHash,
        LenderCreditCommitment storage commitment,
        address expectedPayer,
        uint64 deadline
    ) private view {
        if (commitment.manager != expectedPayer) {
            revert UnexpectedPayer(commitment.manager, expectedPayer);
        }
        if (commitment.expiry <= block.timestamp || deadline > commitment.expiry) {
            revert CommitmentExpired(authorizationHash);
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
    }

    function _storeBoundAuthorization(
        AuthorizationRegistration memory registration,
        euint64 amount,
        euint64 remainingAmount,
        ebool accepted
    ) private {
        _authorizations[registration.authorizationHash] = CreditAuthorization({
            loanEscrow: registration.loanEscrow,
            expectedPayer: registration.expectedPayer,
            expectedAmount: registration.expectedAmount,
            deadline: registration.deadline,
            payer: registration.expectedPayer,
            amountHandle: euint64.unwrap(amount),
            acceptanceHandle: ebool.unwrap(accepted),
            commitmentHash: registration.commitmentHash,
            remainingAmountHandle: euint64.unwrap(remainingAmount),
            releasedTo: address(0),
            releasedAmountHandle: bytes32(0),
            fromCommitment: true,
            acceptanceFinalized: false,
            accepted: false,
            received: true,
            consumed: false,
            released: false
        });
    }

    function _receiveCommitment(bytes32 commitmentHash, address from, euint64 amount) private returns (ebool accepted) {
        LenderCreditCommitment storage commitment = _lenderCreditCommitments[commitmentHash];
        if (!commitment.registered) {
            revert CommitmentDoesNotExist(commitmentHash);
        }
        if (block.timestamp > commitment.expiry) {
            revert CommitmentExpired(commitmentHash);
        }
        if (from != commitment.manager) {
            revert UnexpectedPayer(commitment.manager, from);
        }
        if (commitment.received) {
            revert CommitmentAlreadyReceived(commitmentHash);
        }
        if (commitment.consumed) {
            revert CommitmentAlreadyConsumed(commitmentHash);
        }

        FHE.allowThis(amount);
        commitment.amountHandle = euint64.unwrap(amount);
        commitment.received = true;

        emit LenderCreditEscrowed(commitmentHash, from, commitment.amountHandle);

        accepted = FHE.asEbool(true);
        FHE.allowTransient(accepted, msg.sender);
    }

    function _registerAuthorization(
        bytes32 authorizationHash,
        bytes32 commitmentHash,
        address loanEscrow,
        address expectedPayer,
        uint256 expectedAmount,
        uint64 deadline
    ) private {
        _validateAuthorizationRegistration(authorizationHash, loanEscrow, expectedPayer, expectedAmount, deadline);
        AuthorizationRegistration memory registration = AuthorizationRegistration({
            authorizationHash: authorizationHash,
            commitmentHash: commitmentHash,
            loanEscrow: loanEscrow,
            expectedPayer: expectedPayer,
            expectedAmount: expectedAmount,
            deadline: deadline
        });
        if (_bindCommitmentAuthorization(registration)) {
            emit CreditAuthorizationRegistered(authorizationHash, loanEscrow, expectedPayer);
            return;
        }

        _storeUnreceivedAuthorization(authorizationHash, loanEscrow, expectedPayer, expectedAmount, deadline);
        emit CreditAuthorizationRegistered(authorizationHash, loanEscrow, expectedPayer);
    }

    function _validateAuthorizationRegistration(
        bytes32 authorizationHash,
        address loanEscrow,
        address expectedPayer,
        uint256 expectedAmount,
        uint64 deadline
    ) private view {
        if (authorizationHash == bytes32(0)) {
            revert InvalidAuthorizationHash();
        }
        if (loanEscrow == address(0)) {
            revert InvalidLoanEscrow();
        }
        if (expectedPayer == address(0)) {
            revert InvalidExpectedPayer();
        }
        if (expectedAmount == 0 || expectedAmount > type(uint64).max) {
            revert InvalidExpectedAmount();
        }
        if (deadline <= block.timestamp) {
            revert InvalidDeadline();
        }
        if (_authorizations[authorizationHash].expectedAmount != 0) {
            revert AuthorizationAlreadyRegistered(authorizationHash);
        }
    }

    function _storeUnreceivedAuthorization(
        bytes32 authorizationHash,
        address loanEscrow,
        address expectedPayer,
        uint256 expectedAmount,
        uint64 deadline
    ) private {
        _authorizations[authorizationHash] = CreditAuthorization({
            loanEscrow: loanEscrow,
            expectedPayer: expectedPayer,
            expectedAmount: expectedAmount,
            deadline: deadline,
            payer: address(0),
            amountHandle: bytes32(0),
            acceptanceHandle: bytes32(0),
            commitmentHash: bytes32(0),
            remainingAmountHandle: bytes32(0),
            releasedTo: address(0),
            releasedAmountHandle: bytes32(0),
            fromCommitment: false,
            acceptanceFinalized: false,
            accepted: false,
            received: false,
            consumed: false,
            released: false
        });
    }

    function onConfidentialTransferReceived(
        address,
        address from,
        euint64 amount,
        bytes calldata data
    ) external returns (ebool) {
        if (msg.sender != token) {
            revert UnauthorizedToken(msg.sender);
        }

        bytes32 authorizationHash = abi.decode(data, (bytes32));
        CreditAuthorization storage authorization = _authorizations[authorizationHash];
        if (authorization.expectedAmount == 0) {
            return _receiveCommitment(authorizationHash, from, amount);
        }
        if (block.timestamp > authorization.deadline) {
            revert AuthorizationExpired(authorizationHash);
        }
        if (from != authorization.expectedPayer) {
            revert UnexpectedPayer(authorization.expectedPayer, from);
        }
        if (authorization.received) {
            revert AuthorizationAlreadyRegistered(authorizationHash);
        }

        authorization.payer = from;
        FHE.allowThis(amount);
        authorization.amountHandle = euint64.unwrap(amount);
        ebool accepted = FHE.eq(amount, uint64(authorization.expectedAmount));
        FHE.allowThis(accepted);
        FHE.makePubliclyDecryptable(accepted);
        authorization.acceptanceHandle = ebool.unwrap(accepted);
        authorization.acceptanceFinalized = false;
        authorization.accepted = false;
        authorization.received = true;

        emit ConfidentialCreditReceived(
            authorizationHash,
            from,
            authorization.amountHandle,
            authorization.acceptanceHandle
        );

        FHE.allowTransient(accepted, msg.sender);
        return accepted;
    }

    function finalizeCreditAcceptance(
        bytes32 authorizationHash,
        bool accepted,
        bytes calldata decryptionProof
    ) external {
        CreditAuthorization storage authorization = _requireAuthorization(authorizationHash);
        if (!authorization.received || authorization.acceptanceHandle == bytes32(0)) {
            revert CreditAcceptanceNotReady(authorizationHash);
        }
        if (authorization.acceptanceFinalized) {
            revert CreditAcceptanceAlreadyFinalized(authorizationHash);
        }

        bytes32[] memory handles = new bytes32[](1);
        handles[0] = authorization.acceptanceHandle;
        FHE.checkSignatures(handles, abi.encode(accepted), decryptionProof);

        if (accepted) {
            authorization.acceptanceFinalized = true;
            authorization.accepted = true;
        } else {
            if (authorization.fromCommitment) {
                _lenderCreditCommitments[authorization.commitmentHash].boundAuthorizationHash = bytes32(0);
                delete _authorizations[authorizationHash];
            } else {
                authorization.payer = address(0);
                authorization.amountHandle = bytes32(0);
                authorization.acceptanceHandle = bytes32(0);
                authorization.remainingAmountHandle = bytes32(0);
                authorization.acceptanceFinalized = false;
                authorization.accepted = false;
                authorization.received = false;
            }
        }

        emit CreditAcceptanceFinalized(authorizationHash, accepted);
    }

    function consumeCredit(bytes32 authorizationHash, address loanEscrow) external returns (uint256 creditedAmount) {
        CreditAuthorization storage authorization = _requireAuthorization(authorizationHash);
        _requireCreditConsumer(authorization, loanEscrow);
        _requireCreditAccepted(authorizationHash, authorization);
        if (authorization.consumed) {
            revert CreditAlreadyConsumed(authorizationHash);
        }

        authorization.consumed = true;
        if (authorization.fromCommitment) {
            LenderCreditCommitment storage commitment = _lenderCreditCommitments[authorization.commitmentHash];
            commitment.amountHandle = authorization.remainingAmountHandle;
            commitment.boundAuthorizationHash = bytes32(0);
        }
        creditedAmount = authorization.expectedAmount;
        emit CreditConsumed(authorizationHash, loanEscrow);
    }

    function _requireCreditConsumer(CreditAuthorization storage authorization, address loanEscrow) private view {
        if (loanEscrow != authorization.loanEscrow) {
            revert UnexpectedLoanEscrow(authorization.loanEscrow, loanEscrow);
        }
        if (msg.sender != authorization.loanEscrow) {
            revert UnauthorizedCreditConsumer(msg.sender, authorization.loanEscrow);
        }
    }

    function _requireCreditAccepted(bytes32 authorizationHash, CreditAuthorization storage authorization) private view {
        if (block.timestamp > authorization.deadline) {
            revert AuthorizationExpired(authorizationHash);
        }
        if (!authorization.received) {
            revert CreditNotReceived(authorizationHash);
        }
        if (!authorization.acceptanceFinalized) {
            revert CreditAcceptanceNotFinalized(authorizationHash);
        }
        if (!authorization.accepted) {
            revert CreditRejected(authorizationHash);
        }
    }

    function releaseCredit(
        bytes32 authorizationHash,
        address loanEscrow,
        address recipient
    ) external returns (bytes32 releasedAmountHandle) {
        if (recipient == address(0)) {
            revert InvalidRecipient();
        }

        CreditAuthorization storage authorization = _requireAuthorization(authorizationHash);
        if (loanEscrow != authorization.loanEscrow) {
            revert UnexpectedLoanEscrow(authorization.loanEscrow, loanEscrow);
        }
        if (msg.sender != authorization.loanEscrow) {
            revert UnauthorizedCreditConsumer(msg.sender, authorization.loanEscrow);
        }
        if (!authorization.consumed) {
            revert CreditNotReceived(authorizationHash);
        }
        if (authorization.released) {
            revert CreditAlreadyReleased(authorizationHash);
        }

        euint64 amount = euint64.wrap(authorization.amountHandle);
        FHE.allowTransient(amount, token);
        euint64 releasedAmount = IERC7984(token).confidentialTransfer(recipient, amount);
        releasedAmountHandle = euint64.unwrap(releasedAmount);
        authorization.released = true;
        authorization.releasedTo = recipient;
        authorization.releasedAmountHandle = releasedAmountHandle;

        emit CreditReleased(authorizationHash, loanEscrow, recipient, releasedAmountHandle);
    }

    function getAuthorization(bytes32 authorizationHash) external view returns (CreditAuthorization memory) {
        return _requireAuthorization(authorizationHash);
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

    function _requireAuthorization(
        bytes32 authorizationHash
    ) private view returns (CreditAuthorization storage authorization) {
        authorization = _authorizations[authorizationHash];
        if (authorization.expectedAmount == 0) {
            revert AuthorizationDoesNotExist(authorizationHash);
        }
    }
}
