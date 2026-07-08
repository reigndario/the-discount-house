// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title ProtocolAccountRegistry
/// @notice Durable protocol accounts for wallets, permissions, preferences, loans, and future credentials.
contract ProtocolAccountRegistry {
    bytes32 public constant OWNER_ROLE = keccak256("OWNER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant VIEWER_ROLE = keccak256("VIEWER_ROLE");
    bytes32 public constant RECOVERY_ROLE = keccak256("RECOVERY_ROLE");
    bytes32 public constant COMPLIANCE_ROLE = keccak256("COMPLIANCE_ROLE");

    uint256 private _nextAccountId = 1;

    mapping(uint256 accountId => bool exists) private _accountExists;
    mapping(uint256 accountId => uint256 count) private _ownerCount;
    mapping(uint256 accountId => mapping(address wallet => mapping(bytes32 role => bool granted))) private _roles;

    event AccountCreated(uint256 indexed accountId, address indexed initialOwner);
    event WalletRoleGranted(uint256 indexed accountId, address indexed wallet, bytes32 indexed role);
    event WalletRoleRevoked(uint256 indexed accountId, address indexed wallet, bytes32 indexed role);

    error AccountDoesNotExist(uint256 accountId);
    error InvalidWallet();
    error InvalidRole();
    error Unauthorized(uint256 accountId, address wallet);
    error CannotRemoveLastOwner(uint256 accountId);

    modifier accountExists(uint256 accountId) {
        if (!_accountExists[accountId]) {
            revert AccountDoesNotExist(accountId);
        }
        _;
    }

    modifier onlyAccountOwner(uint256 accountId) {
        if (!_roles[accountId][msg.sender][OWNER_ROLE]) {
            revert Unauthorized(accountId, msg.sender);
        }
        _;
    }

    function createAccount(address initialOwner) external returns (uint256 accountId) {
        _requireWallet(initialOwner);

        accountId = _nextAccountId++;
        _accountExists[accountId] = true;
        _grantRole(accountId, initialOwner, OWNER_ROLE);

        emit AccountCreated(accountId, initialOwner);
    }

    function addWallet(
        uint256 accountId,
        address wallet,
        bytes32 role
    ) external accountExists(accountId) onlyAccountOwner(accountId) {
        _grantRole(accountId, wallet, role);
    }

    function removeWallet(
        uint256 accountId,
        address wallet,
        bytes32 role
    ) external accountExists(accountId) onlyAccountOwner(accountId) {
        _requireWallet(wallet);
        _requireRole(role);

        if (!_roles[accountId][wallet][role]) {
            return;
        }

        if (role == OWNER_ROLE) {
            if (_ownerCount[accountId] == 1) {
                revert CannotRemoveLastOwner(accountId);
            }
            _ownerCount[accountId] -= 1;
        }

        _roles[accountId][wallet][role] = false;
        emit WalletRoleRevoked(accountId, wallet, role);
    }

    function hasAccountRole(uint256 accountId, address wallet, bytes32 role) external view returns (bool) {
        return _roles[accountId][wallet][role];
    }

    function accountExistsPublic(uint256 accountId) external view returns (bool) {
        return _accountExists[accountId];
    }

    function ownerCount(uint256 accountId) external view returns (uint256) {
        return _ownerCount[accountId];
    }

    function nextAccountId() external view returns (uint256) {
        return _nextAccountId;
    }

    function _grantRole(uint256 accountId, address wallet, bytes32 role) private {
        _requireWallet(wallet);
        _requireRole(role);

        if (_roles[accountId][wallet][role]) {
            return;
        }

        _roles[accountId][wallet][role] = true;
        if (role == OWNER_ROLE) {
            _ownerCount[accountId] += 1;
        }

        emit WalletRoleGranted(accountId, wallet, role);
    }

    function _requireWallet(address wallet) private pure {
        if (wallet == address(0)) {
            revert InvalidWallet();
        }
    }

    function _requireRole(bytes32 role) private pure {
        if (
            role != OWNER_ROLE &&
            role != OPERATOR_ROLE &&
            role != VIEWER_ROLE &&
            role != RECOVERY_ROLE &&
            role != COMPLIANCE_ROLE
        ) {
            revert InvalidRole();
        }
    }
}
