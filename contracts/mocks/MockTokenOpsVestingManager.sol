// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ITokenOpsVestingManager} from "../interfaces/ITokenOpsVestingManager.sol";

contract MockTokenOpsVestingManager is ITokenOpsVestingManager {
    mapping(bytes32 vestingId => VestingInfo info) private _vestingInfo;
    mapping(bytes32 vestingId => PendingTransfer pendingTransfer) private _pendingTransfers;

    event DirectVestingTransfer(bytes32 indexed vestingId, address indexed oldRecipient, address indexed newRecipient);
    event VestingTransferInitiated(
        bytes32 indexed vestingId,
        address indexed oldRecipient,
        address indexed newRecipient,
        uint48 expiresAt
    );
    event VestingTransferAccepted(
        bytes32 indexed vestingId,
        address indexed oldRecipient,
        address indexed newRecipient
    );

    function seedVesting(bytes32 vestingId, address recipient) external {
        _vestingInfo[vestingId] = VestingInfo({
            recipient: recipient,
            startTimestamp: uint48(block.timestamp),
            endTimestamp: uint48(block.timestamp + 365 days),
            revokeTimestamp: 0,
            cliffReleaseTimestamp: uint48(block.timestamp + 90 days),
            releaseIntervalSecs: uint48(1 days),
            timelock: 0,
            initialUnlockBps: 0,
            cliffAmountBps: 0,
            isRevocable: true
        });
        delete _pendingTransfers[vestingId];
    }

    function getVestingInfo(bytes32 vestingId) external view returns (VestingInfo memory) {
        return _vestingInfo[vestingId];
    }

    function getPendingVestingTransfer(bytes32 vestingId) external view returns (PendingTransfer memory) {
        return _pendingTransfers[vestingId];
    }

    function initiateVestingTransfer(bytes32 vestingId, address newRecipient, uint48 transferDurationSeconds) external {
        address oldRecipient = _vestingInfo[vestingId].recipient;
        require(oldRecipient != address(0), "MockTokenOps: vesting missing");
        require(msg.sender == oldRecipient, "MockTokenOps: caller is not recipient");
        require(newRecipient != address(0), "MockTokenOps: invalid recipient");
        require(transferDurationSeconds != 0, "MockTokenOps: invalid duration");

        uint256 expiresAt = block.timestamp + transferDurationSeconds;
        require(expiresAt <= type(uint48).max, "MockTokenOps: duration overflow");

        _pendingTransfers[vestingId] = PendingTransfer({
            newRecipient: newRecipient,
            initiatedAt: uint48(block.timestamp),
            expiresAt: uint48(expiresAt)
        });

        emit VestingTransferInitiated(vestingId, oldRecipient, newRecipient, uint48(expiresAt));
    }

    function acceptVestingTransfer(bytes32 vestingId) external {
        PendingTransfer memory pending = _pendingTransfers[vestingId];
        address oldRecipient = _vestingInfo[vestingId].recipient;
        require(oldRecipient != address(0), "MockTokenOps: vesting missing");
        require(pending.newRecipient == msg.sender, "MockTokenOps: caller is not pending recipient");
        require(pending.expiresAt >= block.timestamp, "MockTokenOps: transfer expired");

        _vestingInfo[vestingId].recipient = pending.newRecipient;
        delete _pendingTransfers[vestingId];

        emit VestingTransferAccepted(vestingId, oldRecipient, msg.sender);
    }

    function directVestingTransfer(bytes32 vestingId, address newOwner) external {
        address oldRecipient = _vestingInfo[vestingId].recipient;
        require(msg.sender == oldRecipient, "MockTokenOps: caller is not recipient");
        _vestingInfo[vestingId].recipient = newOwner;
        delete _pendingTransfers[vestingId];
        emit DirectVestingTransfer(vestingId, oldRecipient, newOwner);
    }
}
