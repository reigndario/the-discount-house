// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {FHE, euint8, euint64, externalEuint8, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {IConfidentialCreditCommitmentVerifier} from "./interfaces/IConfidentialCreditCommitmentVerifier.sol";
import {ITokenOpsVestingManager} from "./interfaces/ITokenOpsVestingManager.sol";

/// @title ConfidentialPreferenceBook
/// @notice Stores encrypted preference bundles with coarse public bucket indexing.
/// @dev Exact preference ranges, directions, priorities, and bundle ordering are not public Phase 1 metadata.
contract ConfidentialPreferenceBook is ZamaEthereumConfig {
    enum Side {
        Borrower,
        Lender
    }

    enum PreferenceStatus {
        None,
        Submitted,
        Cancelled,
        Expired,
        Superseded,
        Executable,
        Consumed
    }

    struct PublicMetadata {
        uint8 side;
        address collateralToken;
        address tokenOpsManager;
        bytes32 principalBucket;
        bytes32 durationBucket;
        uint64 expiry;
    }

    struct EncryptedRangeInput {
        externalEuint64 min;
        externalEuint64 max;
        externalEuint64 target;
    }

    struct EncryptedFieldInput {
        EncryptedRangeInput range;
        externalEuint8 direction;
        externalEuint8 priority;
    }

    struct EncryptedRange {
        euint64 min;
        euint64 max;
        euint64 target;
    }

    struct EncryptedField {
        EncryptedRange range;
        euint8 direction;
        euint8 priority;
    }

    struct BundleInput {
        PublicMetadata metadata;
        bytes32 backingId;
        EncryptedFieldInput collateralAmount;
        EncryptedFieldInput principal;
        EncryptedFieldInput collateralTokenPriceE8;
        EncryptedFieldInput interestBps;
        EncryptedFieldInput durationDays;
        EncryptedFieldInput gracePeriodDays;
        bytes inputProof;
    }

    struct PreferenceBundle {
        address manager;
        PublicMetadata metadata;
        bytes32 backingId;
        PreferenceStatus status;
        uint64 executableAt;
        uint256 executableSequence;
        EncryptedField collateralAmount;
        EncryptedField principal;
        EncryptedField collateralTokenPriceE8;
        EncryptedField interestBps;
        EncryptedField durationDays;
        EncryptedField gracePeriodDays;
        bytes32 supersededBy;
    }

    struct BorrowerBackingEvidence {
        address manager;
        address tokenOpsManager;
        address vestingAdapter;
        bytes32 vestingId;
        bool registered;
    }

    struct LenderBackingEvidence {
        address manager;
        address creditAdapter;
        bytes32 commitmentHash;
        uint64 expiry;
        bool registered;
    }

    uint8 public constant MAX_CANDIDATES = 32;

    address public owner;
    address public authorizedMatcher;

    mapping(bytes32 preferenceId => PreferenceBundle preference) private _preferences;
    mapping(address manager => uint256 nonce) private _managerNonces;
    mapping(bytes32 bucketKey => bytes32[] preferenceIds) private _bucketPreferences;
    mapping(bytes32 preferenceId => uint256 positionPlusOne) private _bucketPositionPlusOne;
    mapping(bytes32 backingId => bytes32[] preferenceIds) private _backingPreferences;
    mapping(bytes32 backingId => BorrowerBackingEvidence evidence) private _borrowerBackingEvidence;
    mapping(bytes32 backingId => LenderBackingEvidence evidence) private _lenderBackingEvidence;
    uint256 private _nextExecutableSequence;

    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event AuthorizedMatcherSet(address indexed matcher);
    event PreferenceCreated(
        bytes32 indexed preferenceId,
        uint8 indexed side,
        bytes32 indexed bucketKey,
        address collateralToken,
        address tokenOpsManager,
        bytes32 principalBucket,
        bytes32 durationBucket,
        uint64 expiry
    );
    event PreferenceCancelled(bytes32 indexed preferenceId);
    event PreferenceExpired(bytes32 indexed preferenceId);
    event PreferenceSuperseded(bytes32 indexed oldPreferenceId, bytes32 indexed newPreferenceId);
    event BorrowerBackingRegistered(
        bytes32 indexed backingId,
        address indexed manager,
        address indexed tokenOpsManager,
        address vestingAdapter,
        bytes32 vestingId
    );
    event LenderBackingRegistered(
        bytes32 indexed backingId,
        address indexed manager,
        address indexed creditAdapter,
        bytes32 commitmentHash,
        uint64 expiry
    );
    event BackingExecutable(bytes32 indexed backingId, uint256 activatedCount);
    event PreferenceConsumed(bytes32 indexed preferenceId);

    error InvalidOwner();
    error InvalidMatcher();
    error InvalidManager();
    error InvalidSide();
    error InvalidCollateralToken();
    error InvalidTokenOpsManager();
    error InvalidPrincipalBucket();
    error InvalidDurationBucket();
    error InvalidExpiry();
    error InvalidBacking();
    error InvalidEncryptedInput();
    error PreferenceDoesNotExist(bytes32 preferenceId);
    error PreferenceNotSubmitted(bytes32 preferenceId);
    error PreferenceNotExpired(bytes32 preferenceId);
    error BackingDoesNotExist(bytes32 backingId);
    error BackingNotExecutable(bytes32 backingId);
    error InvalidVestingAdapter();
    error InvalidCreditAdapter();
    error InvalidCommitment();
    error UnauthorizedPreferenceManager(bytes32 preferenceId, address caller);
    error UnauthorizedMatchConsumer(address caller);
    error InvalidMatchedPreferences();

    modifier onlyOwner() {
        if (msg.sender != owner) {
            revert InvalidOwner();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function createPreferenceBundle(BundleInput calldata input) external returns (bytes32 preferenceId) {
        _validateBundleInput(input);
        preferenceId = _createPreferenceBundle(input);
    }

    function _createPreferenceBundle(BundleInput calldata input) private returns (bytes32 preferenceId) {
        uint256 nonce = ++_managerNonces[msg.sender];
        preferenceId = keccak256(abi.encode(address(this), block.chainid, msg.sender, nonce));
        PreferenceBundle storage preference = _preferences[preferenceId];
        preference.manager = msg.sender;
        preference.metadata = input.metadata;
        preference.backingId = input.backingId;
        preference.status = PreferenceStatus.Submitted;
        preference.collateralAmount = _fieldFromExternal(input.collateralAmount, input.inputProof);
        preference.principal = _fieldFromExternal(input.principal, input.inputProof);
        preference.collateralTokenPriceE8 = _fieldFromExternal(input.collateralTokenPriceE8, input.inputProof);
        preference.interestBps = _fieldFromExternal(input.interestBps, input.inputProof);
        preference.durationDays = _fieldFromExternal(input.durationDays, input.inputProof);
        preference.gracePeriodDays = _fieldFromExternal(input.gracePeriodDays, input.inputProof);
        _backingPreferences[input.backingId].push(preferenceId);

        emit PreferenceCreated(
            preferenceId,
            input.metadata.side,
            bucketKey(input.metadata),
            input.metadata.collateralToken,
            input.metadata.tokenOpsManager,
            input.metadata.principalBucket,
            input.metadata.durationBucket,
            input.metadata.expiry
        );
    }

    function cancelPreferenceBundle(bytes32 preferenceId) external {
        PreferenceBundle storage preference = _requireSubmittedPreference(preferenceId);
        _requireManager(preferenceId, preference);

        _deactivate(preferenceId, preference, PreferenceStatus.Cancelled);
        emit PreferenceCancelled(preferenceId);
    }

    function expirePreferenceBundle(bytes32 preferenceId) external {
        PreferenceBundle storage preference = _requireSubmittedPreference(preferenceId);
        if (block.timestamp < preference.metadata.expiry) {
            revert PreferenceNotExpired(preferenceId);
        }

        _deactivate(preferenceId, preference, PreferenceStatus.Expired);
        emit PreferenceExpired(preferenceId);
    }

    function registerBorrowerBacking(
        bytes32 backingId,
        address tokenOpsManager,
        address vestingAdapter,
        bytes32 vestingId
    ) external {
        _validateBorrowerBacking(backingId, tokenOpsManager, vestingAdapter);
        _borrowerBackingEvidence[backingId] = BorrowerBackingEvidence({
            manager: msg.sender,
            tokenOpsManager: tokenOpsManager,
            vestingAdapter: vestingAdapter,
            vestingId: vestingId,
            registered: true
        });
        emit BorrowerBackingRegistered(backingId, msg.sender, tokenOpsManager, vestingAdapter, vestingId);
    }

    function registerLenderBacking(
        bytes32 backingId,
        address creditAdapter,
        bytes32 commitmentHash,
        uint64 expiry
    ) external {
        _validateLenderBacking(backingId, creditAdapter, commitmentHash, expiry);
        _lenderBackingEvidence[backingId] = LenderBackingEvidence({
            manager: msg.sender,
            creditAdapter: creditAdapter,
            commitmentHash: commitmentHash,
            expiry: expiry,
            registered: true
        });
        emit LenderBackingRegistered(backingId, msg.sender, creditAdapter, commitmentHash, expiry);
    }

    function activateBacking(bytes32 backingId) external returns (uint256 activatedCount) {
        bytes32[] storage ids = _backingPreferences[backingId];
        if (ids.length == 0) {
            revert BackingDoesNotExist(backingId);
        }

        for (uint256 i = 0; i < ids.length; i++) {
            bytes32 preferenceId = ids[i];
            PreferenceBundle storage preference = _preferences[preferenceId];
            if (preference.manager != msg.sender || preference.status != PreferenceStatus.Submitted) {
                continue;
            }
            if (!_isBackingExecutable(preference)) {
                revert BackingNotExecutable(backingId);
            }
            preference.status = PreferenceStatus.Executable;
            preference.executableAt = uint64(block.timestamp);
            preference.executableSequence = ++_nextExecutableSequence;
            _addToBucket(bucketKey(preference.metadata), preferenceId);
            activatedCount++;
        }

        if (activatedCount == 0) {
            revert BackingDoesNotExist(backingId);
        }
        emit BackingExecutable(backingId, activatedCount);
    }

    function supersedePreferenceBundle(
        bytes32 oldPreferenceId,
        BundleInput calldata input
    ) external returns (bytes32 newPreferenceId) {
        PreferenceBundle storage oldPreference = _requireSubmittedPreference(oldPreferenceId);
        _requireManager(oldPreferenceId, oldPreference);
        _validateBundleInput(input);

        if (Side(input.metadata.side) != Side(oldPreference.metadata.side)) {
            revert InvalidSide();
        }
        if (input.backingId != oldPreference.backingId) {
            revert InvalidBacking();
        }

        _deactivate(oldPreferenceId, oldPreference, PreferenceStatus.Superseded);
        newPreferenceId = _createPreferenceBundle(input);
        oldPreference.supersededBy = newPreferenceId;
        emit PreferenceSuperseded(oldPreferenceId, newPreferenceId);
    }

    function consumeMatchedPreferences(bytes32 takerPreferenceId, bytes32 makerPreferenceId) external {
        if (msg.sender != authorizedMatcher) {
            revert UnauthorizedMatchConsumer(msg.sender);
        }
        PreferenceBundle storage takerPreference = _requireSubmittedPreference(takerPreferenceId);
        PreferenceBundle storage makerPreference = _requireSubmittedPreference(makerPreferenceId);

        if (
            takerPreferenceId == makerPreferenceId ||
            takerPreference.metadata.side == makerPreference.metadata.side ||
            marketKey(takerPreference.metadata) != marketKey(makerPreference.metadata)
        ) {
            revert InvalidMatchedPreferences();
        }

        _consumeBacking(takerPreference.backingId);
        _consumeBacking(makerPreference.backingId);
    }

    function getPreferenceBundle(bytes32 preferenceId) external view returns (PreferenceBundle memory) {
        PreferenceBundle memory preference = _preferences[preferenceId];
        if (preference.status == PreferenceStatus.None) {
            revert PreferenceDoesNotExist(preferenceId);
        }
        return preference;
    }

    function getBucketPreferenceIds(bytes32 key) external view returns (bytes32[] memory) {
        return _bucketPreferences[key];
    }

    function getBackingPreferenceIds(bytes32 backingId) external view returns (bytes32[] memory) {
        return _backingPreferences[backingId];
    }

    function getBorrowerBackingEvidence(bytes32 backingId) external view returns (BorrowerBackingEvidence memory) {
        return _borrowerBackingEvidence[backingId];
    }

    function getLenderBackingEvidence(bytes32 backingId) external view returns (LenderBackingEvidence memory) {
        return _lenderBackingEvidence[backingId];
    }

    function isBackingExecutable(bytes32 preferenceId) external view returns (bool) {
        PreferenceBundle storage preference = _requireSubmittedPreference(preferenceId);
        return _isBackingExecutable(preference);
    }

    function bucketCount(bytes32 key) external view returns (uint256) {
        return _bucketPreferences[key].length;
    }

    function isBucketEmpty(bytes32 key) external view returns (bool) {
        return _bucketPreferences[key].length == 0;
    }

    function availableCounterparties(uint8 side, bytes32 key) external view returns (uint256) {
        _requireValidSide(side);
        return _bucketPreferences[key].length;
    }

    function bucketKey(PublicMetadata memory metadata) public pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    metadata.side,
                    metadata.collateralToken,
                    metadata.tokenOpsManager,
                    metadata.principalBucket,
                    metadata.durationBucket
                )
            );
    }

    function marketKey(PublicMetadata memory metadata) public pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    metadata.collateralToken,
                    metadata.tokenOpsManager,
                    metadata.principalBucket,
                    metadata.durationBucket
                )
            );
    }

    function managerNonce(address manager) external view returns (uint256) {
        return _managerNonces[manager];
    }

    function setAuthorizedMatcher(address matcher) external onlyOwner {
        if (matcher == address(0)) {
            revert InvalidMatcher();
        }
        authorizedMatcher = matcher;
        emit AuthorizedMatcherSet(matcher);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) {
            revert InvalidOwner();
        }
        address oldOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }

    function _fieldFromExternal(
        EncryptedFieldInput calldata input,
        bytes calldata inputProof
    ) private returns (EncryptedField memory field) {
        field.range.min = FHE.fromExternal(input.range.min, inputProof);
        field.range.max = FHE.fromExternal(input.range.max, inputProof);
        field.range.target = FHE.fromExternal(input.range.target, inputProof);
        field.direction = FHE.fromExternal(input.direction, inputProof);
        field.priority = FHE.fromExternal(input.priority, inputProof);
        _allowField(field);
    }

    function _allowField(EncryptedField memory field) private {
        FHE.allowThis(field.range.min);
        FHE.allowThis(field.range.max);
        FHE.allowThis(field.range.target);
        FHE.allowThis(field.direction);
        FHE.allowThis(field.priority);
        if (authorizedMatcher != address(0)) {
            FHE.allow(field.range.min, authorizedMatcher);
            FHE.allow(field.range.max, authorizedMatcher);
            FHE.allow(field.range.target, authorizedMatcher);
            FHE.allow(field.direction, authorizedMatcher);
            FHE.allow(field.priority, authorizedMatcher);
        }
    }

    function _deactivate(
        bytes32 preferenceId,
        PreferenceBundle storage preference,
        PreferenceStatus newStatus
    ) private {
        preference.status = newStatus;
        _removeFromBucket(bucketKey(preference.metadata), preferenceId);
    }

    function _consumeBacking(bytes32 backingId) private {
        bytes32[] storage ids = _backingPreferences[backingId];
        for (uint256 i = 0; i < ids.length; i++) {
            bytes32 preferenceId = ids[i];
            PreferenceBundle storage preference = _preferences[preferenceId];
            if (preference.status == PreferenceStatus.Submitted || preference.status == PreferenceStatus.Executable) {
                _deactivate(preferenceId, preference, PreferenceStatus.Consumed);
                emit PreferenceConsumed(preferenceId);
            }
        }
    }

    function _addToBucket(bytes32 key, bytes32 preferenceId) private {
        _bucketPreferences[key].push(preferenceId);
        _bucketPositionPlusOne[preferenceId] = _bucketPreferences[key].length;
    }

    function _removeFromBucket(bytes32 key, bytes32 preferenceId) private {
        uint256 positionPlusOne = _bucketPositionPlusOne[preferenceId];
        if (positionPlusOne == 0) {
            return;
        }
        uint256 index = positionPlusOne - 1;
        bytes32[] storage ids = _bucketPreferences[key];
        bytes32 lastPreferenceId = ids[ids.length - 1];
        if (index != ids.length - 1) {
            ids[index] = lastPreferenceId;
            _bucketPositionPlusOne[lastPreferenceId] = index + 1;
        }
        ids.pop();
        _bucketPositionPlusOne[preferenceId] = 0;
    }

    function _isBackingExecutable(PreferenceBundle storage preference) private view returns (bool) {
        if (Side(preference.metadata.side) == Side.Borrower) {
            BorrowerBackingEvidence storage evidence = _borrowerBackingEvidence[preference.backingId];
            if (
                !evidence.registered ||
                evidence.manager != preference.manager ||
                evidence.tokenOpsManager != preference.metadata.tokenOpsManager
            ) {
                return false;
            }
            ITokenOpsVestingManager.VestingInfo memory info = ITokenOpsVestingManager(evidence.tokenOpsManager)
                .getVestingInfo(evidence.vestingId);
            return info.recipient == evidence.vestingAdapter;
        }

        LenderBackingEvidence storage lenderEvidence = _lenderBackingEvidence[preference.backingId];
        return
            lenderEvidence.registered &&
            lenderEvidence.manager == preference.manager &&
            lenderEvidence.expiry > block.timestamp &&
            IConfidentialCreditCommitmentVerifier(lenderEvidence.creditAdapter).isCreditCommitmentExecutable(
                lenderEvidence.commitmentHash,
                preference.manager
            );
    }

    function _requireSubmittedPreference(
        bytes32 preferenceId
    ) private view returns (PreferenceBundle storage preference) {
        preference = _preferences[preferenceId];
        if (preference.status == PreferenceStatus.None) {
            revert PreferenceDoesNotExist(preferenceId);
        }
        if (preference.status != PreferenceStatus.Submitted && preference.status != PreferenceStatus.Executable) {
            revert PreferenceNotSubmitted(preferenceId);
        }
    }

    function _validateBundleInput(BundleInput calldata input) private view {
        if (msg.sender == address(0)) {
            revert InvalidManager();
        }
        _validateMetadata(input.metadata);
        _validateEncryptedBacking(input);
    }

    function _validateMetadata(PublicMetadata calldata metadata) private view {
        _requireValidSide(metadata.side);
        if (metadata.collateralToken == address(0)) {
            revert InvalidCollateralToken();
        }
        if (metadata.side == uint8(Side.Borrower) && metadata.tokenOpsManager == address(0)) {
            revert InvalidTokenOpsManager();
        }
        if (metadata.principalBucket == bytes32(0)) {
            revert InvalidPrincipalBucket();
        }
        if (metadata.durationBucket == bytes32(0)) {
            revert InvalidDurationBucket();
        }
        if (metadata.expiry <= block.timestamp) {
            revert InvalidExpiry();
        }
    }

    function _validateEncryptedBacking(BundleInput calldata input) private pure {
        if (input.backingId == bytes32(0)) {
            revert InvalidBacking();
        }
        if (input.inputProof.length == 0) {
            revert InvalidEncryptedInput();
        }
    }

    function _validateBorrowerBacking(bytes32 backingId, address tokenOpsManager, address vestingAdapter) private pure {
        if (backingId == bytes32(0)) {
            revert InvalidBacking();
        }
        if (tokenOpsManager == address(0)) {
            revert InvalidTokenOpsManager();
        }
        if (vestingAdapter == address(0)) {
            revert InvalidVestingAdapter();
        }
    }

    function _validateLenderBacking(
        bytes32 backingId,
        address creditAdapter,
        bytes32 commitmentHash,
        uint64 expiry
    ) private view {
        if (backingId == bytes32(0)) {
            revert InvalidBacking();
        }
        if (creditAdapter == address(0)) {
            revert InvalidCreditAdapter();
        }
        if (commitmentHash == bytes32(0)) {
            revert InvalidCommitment();
        }
        if (expiry <= block.timestamp) {
            revert InvalidExpiry();
        }
    }

    function _requireValidSide(uint8 side) private pure {
        if (side > uint8(Side.Lender)) {
            revert InvalidSide();
        }
    }

    function _requireManager(bytes32 preferenceId, PreferenceBundle storage preference) private view {
        if (msg.sender != preference.manager) {
            revert UnauthorizedPreferenceManager(preferenceId, msg.sender);
        }
    }
}
