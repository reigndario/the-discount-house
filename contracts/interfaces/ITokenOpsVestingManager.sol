// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

interface ITokenOpsVestingManager {
    struct VestingInfo {
        address recipient;
        uint48 startTimestamp;
        uint48 endTimestamp;
        uint48 revokeTimestamp;
        uint48 cliffReleaseTimestamp;
        uint48 releaseIntervalSecs;
        uint48 timelock;
        uint16 initialUnlockBps;
        uint16 cliffAmountBps;
        bool isRevocable;
    }

    struct PendingTransfer {
        address newRecipient;
        uint48 initiatedAt;
        uint48 expiresAt;
    }

    function getVestingInfo(bytes32 vestingId) external view returns (VestingInfo memory);
    function getPendingVestingTransfer(bytes32 vestingId) external view returns (PendingTransfer memory);
    function initiateVestingTransfer(bytes32 vestingId, address newRecipient, uint48 transferDurationSeconds) external;
    function acceptVestingTransfer(bytes32 vestingId) external;
    function directVestingTransfer(bytes32 vestingId, address newOwner) external;
}
