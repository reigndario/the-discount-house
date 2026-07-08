// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ITokenOpsVestingManager} from "../interfaces/ITokenOpsVestingManager.sol";

/// @title DemoTokenOpsVestingFactory
/// @notice Demo-only vesting manager/factory compatible with TokenOpsVestingAdapter tests.
/// @dev This is not a production TokenOps manager. It stores cleartext demo metadata for local and Sepolia demos.
contract DemoTokenOpsVestingFactory is ITokenOpsVestingManager {
    uint48 public constant DEFAULT_DURATION = 365 days;
    uint48 public constant DEFAULT_CLIFF = 90 days;
    uint48 public constant DEFAULT_INTERVAL = 1 days;

    address public immutable collateralToken;

    mapping(bytes32 vestingId => VestingInfo info) private _vestingInfo;
    mapping(bytes32 vestingId => PendingTransfer pendingTransfer) private _pendingTransfers;
    mapping(bytes32 vestingId => uint256 amount) public vestingAmount;
    mapping(address creator => uint256 nonce) public nonces;

    event DemoVestingCreated(
        bytes32 indexed vestingId,
        address indexed creator,
        address indexed recipient,
        uint256 amount
    );
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
    event DirectVestingTransfer(bytes32 indexed vestingId, address indexed oldRecipient, address indexed newRecipient);

    error InvalidCollateralToken();
    error InvalidRecipient();
    error InvalidAmount();
    error VestingDoesNotExist(bytes32 vestingId);
    error VestingAlreadyExists(bytes32 vestingId);
    error UnauthorizedRecipient(address caller, address expectedRecipient);

    constructor(address collateralToken_) {
        if (collateralToken_ == address(0)) {
            revert InvalidCollateralToken();
        }

        collateralToken = collateralToken_;
    }

    function createDemoVesting(address recipient, uint256 amount) external returns (bytes32 vestingId) {
        if (recipient == address(0)) {
            revert InvalidRecipient();
        }
        if (amount == 0) {
            revert InvalidAmount();
        }

        uint256 nonce = nonces[msg.sender]++;
        vestingId = keccak256(abi.encode(address(this), block.chainid, msg.sender, recipient, amount, nonce));
        _createVesting(vestingId, msg.sender, recipient, amount);
    }

    function createDemoVestingWithId(bytes32 vestingId, address recipient, uint256 amount) external {
        if (recipient == address(0)) {
            revert InvalidRecipient();
        }
        if (amount == 0) {
            revert InvalidAmount();
        }

        _createVesting(vestingId, msg.sender, recipient, amount);
    }

    function getVestingInfo(bytes32 vestingId) external view returns (VestingInfo memory) {
        return _vestingInfo[vestingId];
    }

    function getPendingVestingTransfer(bytes32 vestingId) external view returns (PendingTransfer memory) {
        return _pendingTransfers[vestingId];
    }

    function initiateVestingTransfer(bytes32 vestingId, address newRecipient, uint48 transferDurationSeconds) external {
        if (newRecipient == address(0)) {
            revert InvalidRecipient();
        }
        if (transferDurationSeconds == 0) {
            revert InvalidAmount();
        }

        VestingInfo storage info = _vestingInfo[vestingId];
        address oldRecipient = info.recipient;
        if (oldRecipient == address(0)) {
            revert VestingDoesNotExist(vestingId);
        }
        if (msg.sender != oldRecipient) {
            revert UnauthorizedRecipient(msg.sender, oldRecipient);
        }

        uint256 expiresAt = block.timestamp + transferDurationSeconds;
        if (expiresAt > type(uint48).max) {
            revert InvalidAmount();
        }

        _pendingTransfers[vestingId] = PendingTransfer({
            newRecipient: newRecipient,
            initiatedAt: uint48(block.timestamp),
            expiresAt: uint48(expiresAt)
        });

        emit VestingTransferInitiated(vestingId, oldRecipient, newRecipient, uint48(expiresAt));
    }

    function acceptVestingTransfer(bytes32 vestingId) external {
        PendingTransfer memory pending = _pendingTransfers[vestingId];
        VestingInfo storage info = _vestingInfo[vestingId];
        address oldRecipient = info.recipient;
        if (oldRecipient == address(0)) {
            revert VestingDoesNotExist(vestingId);
        }
        if (msg.sender != pending.newRecipient) {
            revert UnauthorizedRecipient(msg.sender, pending.newRecipient);
        }
        if (pending.expiresAt < block.timestamp) {
            revert UnauthorizedRecipient(msg.sender, pending.newRecipient);
        }

        info.recipient = pending.newRecipient;
        delete _pendingTransfers[vestingId];

        emit VestingTransferAccepted(vestingId, oldRecipient, msg.sender);
    }

    function directVestingTransfer(bytes32 vestingId, address newOwner) external {
        if (newOwner == address(0)) {
            revert InvalidRecipient();
        }

        VestingInfo storage info = _vestingInfo[vestingId];
        address oldRecipient = info.recipient;
        if (oldRecipient == address(0)) {
            revert VestingDoesNotExist(vestingId);
        }
        if (msg.sender != oldRecipient) {
            revert UnauthorizedRecipient(msg.sender, oldRecipient);
        }

        info.recipient = newOwner;
        delete _pendingTransfers[vestingId];
        emit DirectVestingTransfer(vestingId, oldRecipient, newOwner);
    }

    function _createVesting(bytes32 vestingId, address creator, address recipient, uint256 amount) internal {
        if (_vestingInfo[vestingId].recipient != address(0)) {
            revert VestingAlreadyExists(vestingId);
        }

        _vestingInfo[vestingId] = VestingInfo({
            recipient: recipient,
            startTimestamp: uint48(block.timestamp),
            endTimestamp: uint48(block.timestamp + DEFAULT_DURATION),
            revokeTimestamp: 0,
            cliffReleaseTimestamp: uint48(block.timestamp + DEFAULT_CLIFF),
            releaseIntervalSecs: DEFAULT_INTERVAL,
            timelock: 0,
            initialUnlockBps: 0,
            cliffAmountBps: 0,
            isRevocable: true
        });
        vestingAmount[vestingId] = amount;
        delete _pendingTransfers[vestingId];

        emit DemoVestingCreated(vestingId, creator, recipient, amount);
    }
}
