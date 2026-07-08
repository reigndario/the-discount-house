// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ITokenOpsVestingManager} from "./interfaces/ITokenOpsVestingManager.sol";

/// @title TokenOpsVestingAdapter
/// @notice Custody boundary for TokenOps confidential vesting schedules used as loan collateral.
/// @dev Borrowers transfer vesting schedules to this adapter before pledge registration.
contract TokenOpsVestingAdapter {
    enum PledgeStatus {
        None,
        Pledged,
        ReleasePending,
        Released
    }

    uint48 public constant DEFAULT_TRANSFER_DURATION_SECONDS = 604800;

    struct Pledge {
        address manager;
        bytes32 vestingId;
        address borrower;
        address loanEscrow;
        address releasedTo;
        PledgeStatus status;
    }

    mapping(bytes32 pledgeId => Pledge pledge) private _pledges;
    mapping(address manager => mapping(bytes32 vestingId => bytes32 pledgeId)) private _pledgeByVesting;
    mapping(address manager => mapping(bytes32 vestingId => address borrower)) private _custodiedBorrower;

    event PendingVestingAccepted(address indexed manager, bytes32 indexed vestingId, address indexed borrower);
    event VestingPledged(
        bytes32 indexed pledgeId,
        address indexed manager,
        bytes32 indexed vestingId,
        address borrower,
        address loanEscrow
    );
    event VestingReleaseInitiated(bytes32 indexed pledgeId, address indexed recipient, uint48 expiresAt);
    event VestingReleased(bytes32 indexed pledgeId, address indexed recipient);
    event UnpledgedVestingRecoveryInitiated(
        address indexed manager,
        bytes32 indexed vestingId,
        address indexed borrower,
        uint48 expiresAt
    );
    event UnpledgedVestingRecovered(address indexed manager, bytes32 indexed vestingId, address indexed borrower);

    error InvalidManager();
    error InvalidBorrower();
    error InvalidRecipient();
    error VestingNotControlledByAdapter(address actualRecipient);
    error VestingBorrowerMismatch(address expectedBorrower, address actualBorrower);
    error VestingAlreadyPledged(bytes32 pledgeId);
    error VestingAlreadyCustodied(address borrower);
    error PendingTransferMissing();
    error PendingTransferRecipientMismatch(address expectedRecipient, address actualRecipient);
    error PendingTransferExpired(uint48 expiresAt);
    error UnpledgedVestingNotCustodied(address manager, bytes32 vestingId);
    error PledgeDoesNotExist(bytes32 pledgeId);
    error PledgeNotActive(bytes32 pledgeId);
    error PledgeReleaseNotPending(bytes32 pledgeId);
    error ReleaseRecipientMismatch(address expectedRecipient, address actualRecipient);
    error UnauthorizedEscrow(bytes32 pledgeId, address caller);

    function acceptPendingVestingTransfer(address manager, bytes32 vestingId, address borrower) external {
        _requireManagerVestingBorrower(manager, borrower);

        address custodiedBorrower = _custodiedBorrower[manager][vestingId];
        if (custodiedBorrower != address(0)) {
            revert VestingAlreadyCustodied(custodiedBorrower);
        }

        ITokenOpsVestingManager tokenOpsManager = ITokenOpsVestingManager(manager);
        ITokenOpsVestingManager.VestingInfo memory info = tokenOpsManager.getVestingInfo(vestingId);
        if (info.recipient != borrower) {
            revert VestingBorrowerMismatch(borrower, info.recipient);
        }

        _requirePendingTransfer(tokenOpsManager, vestingId, address(this));

        tokenOpsManager.acceptVestingTransfer(vestingId);

        info = tokenOpsManager.getVestingInfo(vestingId);
        if (info.recipient != address(this)) {
            revert VestingNotControlledByAdapter(info.recipient);
        }

        _custodiedBorrower[manager][vestingId] = borrower;

        emit PendingVestingAccepted(manager, vestingId, borrower);
    }

    function registerPledge(address manager, bytes32 vestingId, address borrower) external returns (bytes32 pledgeId) {
        if (manager == address(0)) {
            revert InvalidManager();
        }
        if (borrower == address(0)) {
            revert InvalidBorrower();
        }

        bytes32 existingPledgeId = _pledgeByVesting[manager][vestingId];
        if (existingPledgeId != bytes32(0)) {
            revert VestingAlreadyPledged(existingPledgeId);
        }

        address custodiedBorrower = _custodiedBorrower[manager][vestingId];
        if (custodiedBorrower != borrower) {
            revert VestingBorrowerMismatch(borrower, custodiedBorrower);
        }

        ITokenOpsVestingManager.VestingInfo memory info = ITokenOpsVestingManager(manager).getVestingInfo(vestingId);
        if (info.recipient != address(this)) {
            revert VestingNotControlledByAdapter(info.recipient);
        }

        pledgeId = keccak256(abi.encode(address(this), block.chainid, manager, vestingId, borrower, msg.sender));
        _pledges[pledgeId] = Pledge({
            manager: manager,
            vestingId: vestingId,
            borrower: borrower,
            loanEscrow: msg.sender,
            releasedTo: address(0),
            status: PledgeStatus.Pledged
        });
        _pledgeByVesting[manager][vestingId] = pledgeId;

        emit VestingPledged(pledgeId, manager, vestingId, borrower, msg.sender);
    }

    function releasePledge(bytes32 pledgeId, address recipient) external {
        if (recipient == address(0) || recipient == address(this)) {
            revert InvalidRecipient();
        }

        Pledge storage pledge = _pledges[pledgeId];
        if (pledge.status == PledgeStatus.None) {
            revert PledgeDoesNotExist(pledgeId);
        }
        if (pledge.status != PledgeStatus.Pledged) {
            revert PledgeNotActive(pledgeId);
        }
        if (msg.sender != pledge.loanEscrow) {
            revert UnauthorizedEscrow(pledgeId, msg.sender);
        }

        ITokenOpsVestingManager tokenOpsManager = ITokenOpsVestingManager(pledge.manager);
        ITokenOpsVestingManager.VestingInfo memory info = tokenOpsManager.getVestingInfo(pledge.vestingId);
        if (info.recipient != address(this)) {
            revert VestingNotControlledByAdapter(info.recipient);
        }

        pledge.status = PledgeStatus.ReleasePending;
        pledge.releasedTo = recipient;

        tokenOpsManager.initiateVestingTransfer(pledge.vestingId, recipient, DEFAULT_TRANSFER_DURATION_SECONDS);

        ITokenOpsVestingManager.PendingTransfer memory pending = tokenOpsManager.getPendingVestingTransfer(
            pledge.vestingId
        );
        if (pending.newRecipient != recipient) {
            revert PendingTransferRecipientMismatch(recipient, pending.newRecipient);
        }

        emit VestingReleaseInitiated(pledgeId, recipient, pending.expiresAt);
    }

    function renewReleaseTransfer(bytes32 pledgeId) external {
        Pledge storage pledge = _pledges[pledgeId];
        if (pledge.status == PledgeStatus.None) {
            revert PledgeDoesNotExist(pledgeId);
        }
        if (pledge.status != PledgeStatus.ReleasePending) {
            revert PledgeReleaseNotPending(pledgeId);
        }

        ITokenOpsVestingManager tokenOpsManager = ITokenOpsVestingManager(pledge.manager);
        ITokenOpsVestingManager.VestingInfo memory info = tokenOpsManager.getVestingInfo(pledge.vestingId);
        if (info.recipient == pledge.releasedTo) {
            _completeRelease(pledgeId, pledge);
            return;
        }
        if (info.recipient != address(this)) {
            revert VestingNotControlledByAdapter(info.recipient);
        }

        tokenOpsManager.initiateVestingTransfer(pledge.vestingId, pledge.releasedTo, DEFAULT_TRANSFER_DURATION_SECONDS);

        ITokenOpsVestingManager.PendingTransfer memory pending = tokenOpsManager.getPendingVestingTransfer(
            pledge.vestingId
        );
        if (pending.newRecipient != pledge.releasedTo) {
            revert PendingTransferRecipientMismatch(pledge.releasedTo, pending.newRecipient);
        }

        emit VestingReleaseInitiated(pledgeId, pledge.releasedTo, pending.expiresAt);
    }

    function completeRelease(bytes32 pledgeId) external {
        Pledge storage pledge = _pledges[pledgeId];
        if (pledge.status == PledgeStatus.None) {
            revert PledgeDoesNotExist(pledgeId);
        }
        if (pledge.status != PledgeStatus.ReleasePending) {
            revert PledgeReleaseNotPending(pledgeId);
        }

        ITokenOpsVestingManager.VestingInfo memory info = ITokenOpsVestingManager(pledge.manager).getVestingInfo(
            pledge.vestingId
        );
        if (info.recipient != pledge.releasedTo) {
            revert ReleaseRecipientMismatch(pledge.releasedTo, info.recipient);
        }

        _completeRelease(pledgeId, pledge);
    }

    function recoverUnpledgedVesting(address manager, bytes32 vestingId) external returns (address borrower) {
        borrower = _requireUnpledgedCustody(manager, vestingId);
        ITokenOpsVestingManager tokenOpsManager = ITokenOpsVestingManager(manager);
        ITokenOpsVestingManager.VestingInfo memory info = tokenOpsManager.getVestingInfo(vestingId);
        if (info.recipient == borrower) {
            delete _custodiedBorrower[manager][vestingId];
            emit UnpledgedVestingRecovered(manager, vestingId, borrower);
            return borrower;
        }
        if (info.recipient != address(this)) {
            revert VestingNotControlledByAdapter(info.recipient);
        }

        tokenOpsManager.initiateVestingTransfer(vestingId, borrower, DEFAULT_TRANSFER_DURATION_SECONDS);
        ITokenOpsVestingManager.PendingTransfer memory pending = tokenOpsManager.getPendingVestingTransfer(vestingId);
        if (pending.newRecipient != borrower) {
            revert PendingTransferRecipientMismatch(borrower, pending.newRecipient);
        }

        emit UnpledgedVestingRecoveryInitiated(manager, vestingId, borrower, pending.expiresAt);
    }

    function completeUnpledgedVestingRecovery(address manager, bytes32 vestingId) external {
        address borrower = _requireUnpledgedCustody(manager, vestingId);
        ITokenOpsVestingManager.VestingInfo memory info = ITokenOpsVestingManager(manager).getVestingInfo(vestingId);
        if (info.recipient != borrower) {
            revert ReleaseRecipientMismatch(borrower, info.recipient);
        }

        delete _custodiedBorrower[manager][vestingId];
        emit UnpledgedVestingRecovered(manager, vestingId, borrower);
    }

    function getPledge(bytes32 pledgeId) external view returns (Pledge memory) {
        Pledge memory pledge = _pledges[pledgeId];
        if (pledge.status == PledgeStatus.None) {
            revert PledgeDoesNotExist(pledgeId);
        }
        return pledge;
    }

    function pledgeForVesting(address manager, bytes32 vestingId) external view returns (bytes32) {
        return _pledgeByVesting[manager][vestingId];
    }

    function custodiedBorrowerForVesting(address manager, bytes32 vestingId) external view returns (address) {
        return _custodiedBorrower[manager][vestingId];
    }

    function _requireManagerVestingBorrower(address manager, address borrower) private pure {
        if (manager == address(0)) {
            revert InvalidManager();
        }
        if (borrower == address(0)) {
            revert InvalidBorrower();
        }
    }

    function _requireUnpledgedCustody(address manager, bytes32 vestingId) private view returns (address borrower) {
        if (manager == address(0)) {
            revert InvalidManager();
        }

        borrower = _custodiedBorrower[manager][vestingId];
        if (borrower == address(0)) {
            revert UnpledgedVestingNotCustodied(manager, vestingId);
        }

        bytes32 existingPledgeId = _pledgeByVesting[manager][vestingId];
        if (existingPledgeId != bytes32(0)) {
            revert VestingAlreadyPledged(existingPledgeId);
        }
    }

    function _requirePendingTransfer(
        ITokenOpsVestingManager tokenOpsManager,
        bytes32 vestingId,
        address expectedRecipient
    ) private view {
        ITokenOpsVestingManager.PendingTransfer memory pending = tokenOpsManager.getPendingVestingTransfer(vestingId);
        if (pending.initiatedAt == 0) {
            revert PendingTransferMissing();
        }
        if (pending.newRecipient != expectedRecipient) {
            revert PendingTransferRecipientMismatch(expectedRecipient, pending.newRecipient);
        }
        if (pending.expiresAt < block.timestamp) {
            revert PendingTransferExpired(pending.expiresAt);
        }
    }

    function _completeRelease(bytes32 pledgeId, Pledge storage pledge) private {
        pledge.status = PledgeStatus.Released;
        _pledgeByVesting[pledge.manager][pledge.vestingId] = bytes32(0);
        _custodiedBorrower[pledge.manager][pledge.vestingId] = address(0);

        emit VestingReleased(pledgeId, pledge.releasedTo);
    }
}
