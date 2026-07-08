// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {FHE, ebool, euint8, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ConfidentialPreferenceBook} from "./ConfidentialPreferenceBook.sol";

/// @title NashNegotiationEngine
/// @notice Execute-only matcher for encrypted Preference Bundles.
/// @dev Free public previews are intentionally omitted to reduce probing leakage.
contract NashNegotiationEngine is ZamaEthereumConfig {
    uint8 public constant MAX_CANDIDATES = 32;
    uint8 public constant TERM_FIELD_COUNT = 6;
    uint8 private constant ALL_TERMS_COMPUTED_MASK = 0x3f;

    enum AttemptStatus {
        None,
        Succeeded,
        Failed,
        Pending
    }

    struct MatchAttempt {
        address caller;
        bytes32 takerPreferenceId;
        bytes32 makerPreferenceId;
        bytes32 bucketKey;
        uint64 attemptedAt;
        AttemptStatus status;
        bytes32 termsHash;
        bytes32 encryptedTermsHash;
    }

    struct EncryptedSelectedTerms {
        euint64 collateralAmount;
        euint64 principal;
        euint64 collateralTokenPriceE8;
        euint64 interestBps;
        euint64 durationDays;
        euint64 gracePeriodDays;
        ebool feasible;
    }

    ConfidentialPreferenceBook public immutable preferenceBook;

    mapping(bytes32 attemptId => MatchAttempt attempt) private _attempts;
    mapping(bytes32 attemptId => EncryptedSelectedTerms terms) private _encryptedTerms;
    mapping(bytes32 attemptId => uint8 computedMask) private _computedTermMask;
    mapping(bytes32 preferenceId => bool locked) private _lockedPreferences;
    uint256 private _nonce;

    event MatchAttempted(
        bytes32 indexed attemptId,
        bytes32 indexed takerPreferenceId,
        bytes32 indexed bucketKey,
        uint256 candidateCount
    );
    event MatchSucceeded(bytes32 indexed attemptId, bytes32 indexed makerPreferenceId, bytes32 termsHash);
    event MatchFailed(bytes32 indexed attemptId);
    event MatchTermComputed(bytes32 indexed attemptId, uint8 indexed fieldIndex, bytes32 termHandle);
    event EncryptedTermsCommitted(bytes32 indexed attemptId, bytes32 encryptedTermsHash);
    event MatchFinalizationRequested(bytes32 indexed attemptId, bytes32 feasibilityHandle);

    error InvalidPreferenceBook();
    error InvalidCandidateSet();
    error InvalidTakerPreference();
    error PreferenceNotExecutable(bytes32 preferenceId);
    error SameSidePreference(bytes32 takerPreferenceId, bytes32 makerPreferenceId);
    error BucketMismatch(bytes32 takerPreferenceId, bytes32 makerPreferenceId);
    error AttemptDoesNotExist(bytes32 attemptId);
    error AttemptNotPending(bytes32 attemptId);
    error InvalidTermField(uint8 fieldIndex);
    error MatchTermAlreadyComputed(bytes32 attemptId, uint8 fieldIndex);
    error MatchTermsNotReady(bytes32 attemptId);

    constructor(ConfidentialPreferenceBook preferenceBook_) {
        if (address(preferenceBook_) == address(0)) {
            revert InvalidPreferenceBook();
        }
        preferenceBook = preferenceBook_;
    }

    function executeMatch(
        bytes32 takerPreferenceId,
        bytes32[] calldata makerPreferenceIds
    ) external returns (bytes32 attemptId) {
        _validateCandidateSet(makerPreferenceIds.length);
        ConfidentialPreferenceBook.PreferenceBundle memory taker = _requireExecutableTaker(takerPreferenceId);

        bytes32 takerBucketKey = preferenceBook.bucketKey(taker.metadata);
        bytes32 takerMarketKey = preferenceBook.marketKey(taker.metadata);
        attemptId = keccak256(abi.encode(address(this), block.chainid, ++_nonce, msg.sender, takerPreferenceId));
        emit MatchAttempted(attemptId, takerPreferenceId, takerBucketKey, makerPreferenceIds.length);

        bytes32 bestMakerPreferenceId = _selectBestMaker(takerPreferenceId, taker, takerMarketKey, makerPreferenceIds);

        if (bestMakerPreferenceId == bytes32(0)) {
            _attempts[attemptId] = MatchAttempt({
                caller: msg.sender,
                takerPreferenceId: takerPreferenceId,
                makerPreferenceId: bytes32(0),
                bucketKey: takerBucketKey,
                attemptedAt: uint64(block.timestamp),
                status: AttemptStatus.Failed,
                termsHash: bytes32(0),
                encryptedTermsHash: bytes32(0)
            });
            emit MatchFailed(attemptId);
            return attemptId;
        }

        _attempts[attemptId] = MatchAttempt({
            caller: msg.sender,
            takerPreferenceId: takerPreferenceId,
            makerPreferenceId: bestMakerPreferenceId,
            bucketKey: takerBucketKey,
            attemptedAt: uint64(block.timestamp),
            status: AttemptStatus.Pending,
            termsHash: bytes32(0),
            encryptedTermsHash: bytes32(0)
        });
        _lockedPreferences[takerPreferenceId] = true;
        _lockedPreferences[bestMakerPreferenceId] = true;
    }

    function _requireExecutableTaker(
        bytes32 takerPreferenceId
    ) private view returns (ConfidentialPreferenceBook.PreferenceBundle memory taker) {
        taker = preferenceBook.getPreferenceBundle(takerPreferenceId);
        if (!_isExecutable(takerPreferenceId, taker)) {
            revert PreferenceNotExecutable(takerPreferenceId);
        }
    }

    function _selectBestMaker(
        bytes32 takerPreferenceId,
        ConfidentialPreferenceBook.PreferenceBundle memory taker,
        bytes32 takerMarketKey,
        bytes32[] calldata makerPreferenceIds
    ) private view returns (bytes32 bestMakerPreferenceId) {
        uint256 bestExecutableSequence = type(uint256).max;
        for (uint256 i = 0; i < makerPreferenceIds.length; i++) {
            bytes32 makerPreferenceId = makerPreferenceIds[i];
            ConfidentialPreferenceBook.PreferenceBundle memory maker = preferenceBook.getPreferenceBundle(
                makerPreferenceId
            );
            _requireCompatibleMetadata(takerPreferenceId, taker, makerPreferenceId, maker, takerMarketKey);
            if (!_isExecutable(makerPreferenceId, maker)) {
                continue;
            }

            if (_isBetterMaker(makerPreferenceId, maker, bestMakerPreferenceId, bestExecutableSequence)) {
                bestMakerPreferenceId = makerPreferenceId;
                bestExecutableSequence = maker.executableSequence;
            }
        }
    }

    function _isBetterMaker(
        bytes32 makerPreferenceId,
        ConfidentialPreferenceBook.PreferenceBundle memory maker,
        bytes32 bestMakerPreferenceId,
        uint256 bestExecutableSequence
    ) private pure returns (bool) {
        return
            maker.executableSequence < bestExecutableSequence ||
            (maker.executableSequence == bestExecutableSequence && makerPreferenceId < bestMakerPreferenceId);
    }

    function getAttempt(bytes32 attemptId) external view returns (MatchAttempt memory) {
        MatchAttempt memory attempt = _attempts[attemptId];
        if (attempt.status == AttemptStatus.None) {
            revert AttemptDoesNotExist(attemptId);
        }
        return attempt;
    }

    function getEncryptedTerms(bytes32 attemptId) external view returns (EncryptedSelectedTerms memory) {
        MatchAttempt memory attempt = _attempts[attemptId];
        if (attempt.status == AttemptStatus.None) {
            revert AttemptDoesNotExist(attemptId);
        }
        return _encryptedTerms[attemptId];
    }

    function isPreferenceLocked(bytes32 preferenceId) external view returns (bool) {
        return _lockedPreferences[preferenceId];
    }

    function computedTermMask(bytes32 attemptId) external view returns (uint8) {
        MatchAttempt memory attempt = _attempts[attemptId];
        if (attempt.status == AttemptStatus.None) {
            revert AttemptDoesNotExist(attemptId);
        }
        return _computedTermMask[attemptId];
    }

    function computeSelectedTerm(bytes32 attemptId, uint8 fieldIndex) external {
        if (fieldIndex >= TERM_FIELD_COUNT) {
            revert InvalidTermField(fieldIndex);
        }

        MatchAttempt storage attempt = _attempts[attemptId];
        if (attempt.status == AttemptStatus.None) {
            revert AttemptDoesNotExist(attemptId);
        }
        if (attempt.status != AttemptStatus.Pending) {
            revert AttemptNotPending(attemptId);
        }
        uint8 fieldBit = uint8(uint256(1) << fieldIndex);
        uint8 computedMask = _computedTermMask[attemptId];
        if (computedMask & fieldBit != 0) {
            revert MatchTermAlreadyComputed(attemptId, fieldIndex);
        }

        ConfidentialPreferenceBook.PreferenceBundle memory taker = preferenceBook.getPreferenceBundle(
            attempt.takerPreferenceId
        );
        ConfidentialPreferenceBook.PreferenceBundle memory maker = preferenceBook.getPreferenceBundle(
            attempt.makerPreferenceId
        );
        (
            ConfidentialPreferenceBook.EncryptedField memory takerField,
            ConfidentialPreferenceBook.EncryptedField memory makerField
        ) = _encryptedTermFields(taker, maker, fieldIndex);

        (euint64 selected, ) = _selectFieldTerm(takerField, makerField);
        EncryptedSelectedTerms storage terms = _encryptedTerms[attemptId];
        _storeSelectedTerm(terms, fieldIndex, selected);

        uint8 nextComputedMask = computedMask | fieldBit;
        _computedTermMask[attemptId] = nextComputedMask;
        emit MatchTermComputed(attemptId, fieldIndex, euint64.unwrap(selected));
    }

    function commitEncryptedTerms(bytes32 attemptId) external {
        MatchAttempt storage attempt = _attempts[attemptId];
        if (attempt.status == AttemptStatus.None) {
            revert AttemptDoesNotExist(attemptId);
        }
        if (attempt.status != AttemptStatus.Pending) {
            revert AttemptNotPending(attemptId);
        }
        if (_computedTermMask[attemptId] != ALL_TERMS_COMPUTED_MASK) {
            revert MatchTermsNotReady(attemptId);
        }
        if (attempt.encryptedTermsHash != bytes32(0)) {
            revert MatchTermAlreadyComputed(attemptId, TERM_FIELD_COUNT);
        }

        ConfidentialPreferenceBook.PreferenceBundle memory taker = preferenceBook.getPreferenceBundle(
            attempt.takerPreferenceId
        );
        ConfidentialPreferenceBook.PreferenceBundle memory maker = preferenceBook.getPreferenceBundle(
            attempt.makerPreferenceId
        );
        EncryptedSelectedTerms storage terms = _encryptedTerms[attemptId];
        terms.feasible = _aggregateFeasibility(taker, maker);
        _finalizeEncryptedTermsCommit(attemptId, attempt, terms);
    }

    function finalizeMatchFeasibility(
        bytes32 attemptId,
        bool feasible,
        bytes calldata decryptionProof
    ) external returns (AttemptStatus status) {
        MatchAttempt storage attempt = _attempts[attemptId];
        if (attempt.status == AttemptStatus.None) {
            revert AttemptDoesNotExist(attemptId);
        }
        if (attempt.status != AttemptStatus.Pending) {
            revert AttemptNotPending(attemptId);
        }
        if (attempt.encryptedTermsHash == bytes32(0)) {
            revert MatchTermsNotReady(attemptId);
        }

        EncryptedSelectedTerms storage terms = _encryptedTerms[attemptId];
        bytes32[] memory handles = new bytes32[](1);
        handles[0] = ebool.unwrap(terms.feasible);
        FHE.checkSignatures(handles, abi.encode(feasible), decryptionProof);

        _lockedPreferences[attempt.takerPreferenceId] = false;
        _lockedPreferences[attempt.makerPreferenceId] = false;
        if (!feasible) {
            attempt.status = AttemptStatus.Failed;
            emit MatchFailed(attemptId);
            return AttemptStatus.Failed;
        }

        attempt.status = AttemptStatus.Succeeded;
        preferenceBook.consumeMatchedPreferences(attempt.takerPreferenceId, attempt.makerPreferenceId);
        emit MatchSucceeded(attemptId, attempt.makerPreferenceId, attempt.termsHash);
        return AttemptStatus.Succeeded;
    }

    function _aggregateFeasibility(
        ConfidentialPreferenceBook.PreferenceBundle memory taker,
        ConfidentialPreferenceBook.PreferenceBundle memory maker
    ) private returns (ebool feasible) {
        feasible = _isFieldFeasible(taker.collateralAmount, maker.collateralAmount);
        feasible = FHE.and(feasible, _isFieldFeasible(taker.principal, maker.principal));
        feasible = FHE.and(feasible, _isFieldFeasible(taker.collateralTokenPriceE8, maker.collateralTokenPriceE8));
        feasible = FHE.and(feasible, _isFieldFeasible(taker.interestBps, maker.interestBps));
        feasible = FHE.and(feasible, _isFieldFeasible(taker.durationDays, maker.durationDays));
        feasible = FHE.and(feasible, _isFieldFeasible(taker.gracePeriodDays, maker.gracePeriodDays));
    }

    function _isFieldFeasible(
        ConfidentialPreferenceBook.EncryptedField memory taker,
        ConfidentialPreferenceBook.EncryptedField memory maker
    ) private returns (ebool) {
        return FHE.le(FHE.max(taker.range.min, maker.range.min), FHE.min(taker.range.max, maker.range.max));
    }

    function _finalizeEncryptedTermsCommit(
        bytes32 attemptId,
        MatchAttempt storage attempt,
        EncryptedSelectedTerms storage terms
    ) private {
        FHE.makePubliclyDecryptable(terms.feasible);

        bytes32 encryptedTermsHash = keccak256(
            abi.encode(
                euint64.unwrap(terms.collateralAmount),
                euint64.unwrap(terms.principal),
                euint64.unwrap(terms.collateralTokenPriceE8),
                euint64.unwrap(terms.interestBps),
                euint64.unwrap(terms.durationDays),
                euint64.unwrap(terms.gracePeriodDays),
                ebool.unwrap(terms.feasible)
            )
        );
        attempt.encryptedTermsHash = encryptedTermsHash;
        attempt.termsHash = keccak256(
            abi.encode(
                address(this),
                block.chainid,
                attempt.takerPreferenceId,
                attempt.makerPreferenceId,
                encryptedTermsHash
            )
        );

        emit EncryptedTermsCommitted(attemptId, encryptedTermsHash);
        emit MatchFinalizationRequested(attemptId, ebool.unwrap(terms.feasible));
    }

    function _selectFieldTerm(
        ConfidentialPreferenceBook.EncryptedField memory taker,
        ConfidentialPreferenceBook.EncryptedField memory maker
    ) private returns (euint64 selected, ebool feasible) {
        euint64 overlapMin = FHE.max(taker.range.min, maker.range.min);
        euint64 overlapMax = FHE.min(taker.range.max, maker.range.max);
        feasible = FHE.le(overlapMin, overlapMax);
        euint64 midpoint = _midpoint(overlapMin, overlapMax);
        euint64 takerPreferred = _preferredValue(taker);
        euint64 makerPreferred = _preferredValue(maker);

        selected = midpoint;
        euint64 bestScore = _combinedDistance(taker, maker, takerPreferred, makerPreferred, selected);
        (selected, bestScore) = _selectBetterCandidate(
            taker,
            maker,
            takerPreferred,
            makerPreferred,
            _clamp(taker.range.target, overlapMin, overlapMax),
            selected,
            bestScore
        );
        (selected, ) = _selectBetterCandidate(
            taker,
            maker,
            takerPreferred,
            makerPreferred,
            _clamp(maker.range.target, overlapMin, overlapMax),
            selected,
            bestScore
        );
    }

    function _encryptedTermFields(
        ConfidentialPreferenceBook.PreferenceBundle memory taker,
        ConfidentialPreferenceBook.PreferenceBundle memory maker,
        uint8 fieldIndex
    )
        private
        pure
        returns (
            ConfidentialPreferenceBook.EncryptedField memory takerField,
            ConfidentialPreferenceBook.EncryptedField memory makerField
        )
    {
        if (fieldIndex == 0) {
            return (taker.collateralAmount, maker.collateralAmount);
        }
        if (fieldIndex == 1) {
            return (taker.principal, maker.principal);
        }
        if (fieldIndex == 2) {
            return (taker.collateralTokenPriceE8, maker.collateralTokenPriceE8);
        }
        if (fieldIndex == 3) {
            return (taker.interestBps, maker.interestBps);
        }
        if (fieldIndex == 4) {
            return (taker.durationDays, maker.durationDays);
        }
        return (taker.gracePeriodDays, maker.gracePeriodDays);
    }

    function _storeSelectedTerm(EncryptedSelectedTerms storage terms, uint8 fieldIndex, euint64 selected) private {
        if (fieldIndex == 0) {
            terms.collateralAmount = selected;
        } else if (fieldIndex == 1) {
            terms.principal = selected;
        } else if (fieldIndex == 2) {
            terms.collateralTokenPriceE8 = selected;
        } else if (fieldIndex == 3) {
            terms.interestBps = selected;
        } else if (fieldIndex == 4) {
            terms.durationDays = selected;
        } else {
            terms.gracePeriodDays = selected;
        }
    }

    function _selectBetterCandidate(
        ConfidentialPreferenceBook.EncryptedField memory taker,
        ConfidentialPreferenceBook.EncryptedField memory maker,
        euint64 takerPreferred,
        euint64 makerPreferred,
        euint64 candidate,
        euint64 current,
        euint64 currentScore
    ) private returns (euint64 selected, euint64 selectedScore) {
        euint64 candidateScore = _combinedDistance(taker, maker, takerPreferred, makerPreferred, candidate);
        ebool candidateWins = FHE.lt(candidateScore, currentScore);
        selected = FHE.select(candidateWins, candidate, current);
        selectedScore = FHE.select(candidateWins, candidateScore, currentScore);
    }

    function _combinedDistance(
        ConfidentialPreferenceBook.EncryptedField memory taker,
        ConfidentialPreferenceBook.EncryptedField memory maker,
        euint64 takerPreferred,
        euint64 makerPreferred,
        euint64 candidate
    ) private returns (euint64) {
        return
            FHE.add(
                _weightedDistance(candidate, takerPreferred, taker.priority),
                _weightedDistance(candidate, makerPreferred, maker.priority)
            );
    }

    function _weightedDistance(euint64 candidate, euint64 preferred, euint8 priority) private returns (euint64) {
        return FHE.mul(_distance(candidate, preferred), priority);
    }

    function _preferredValue(
        ConfidentialPreferenceBook.EncryptedField memory field
    ) private returns (euint64 preferred) {
        euint64 midpoint = _midpoint(field.range.min, field.range.max);
        preferred = midpoint;
        preferred = FHE.select(FHE.eq(field.direction, uint8(0)), field.range.min, preferred);
        preferred = FHE.select(FHE.eq(field.direction, uint8(1)), field.range.max, preferred);
        preferred = FHE.select(FHE.eq(field.direction, uint8(2)), field.range.target, preferred);
    }

    function _distance(euint64 left, euint64 right) private returns (euint64) {
        ebool leftGreater = FHE.gt(left, right);
        return FHE.select(leftGreater, FHE.sub(left, right), FHE.sub(right, left));
    }

    function _midpoint(euint64 minValue, euint64 maxValue) private returns (euint64) {
        return FHE.add(minValue, FHE.shr(FHE.sub(maxValue, minValue), 1));
    }

    function _clamp(euint64 value, euint64 minValue, euint64 maxValue) private returns (euint64) {
        return FHE.min(FHE.max(value, minValue), maxValue);
    }

    function _allowEncryptedTerms(EncryptedSelectedTerms storage terms) private {
        FHE.allowThis(terms.collateralAmount);
        FHE.allowThis(terms.principal);
        FHE.allowThis(terms.collateralTokenPriceE8);
        FHE.allowThis(terms.interestBps);
        FHE.allowThis(terms.durationDays);
        FHE.allowThis(terms.gracePeriodDays);
        FHE.allowThis(terms.feasible);
    }

    function _requireCompatibleMetadata(
        bytes32 takerPreferenceId,
        ConfidentialPreferenceBook.PreferenceBundle memory taker,
        bytes32 makerPreferenceId,
        ConfidentialPreferenceBook.PreferenceBundle memory maker,
        bytes32 takerMarketKey
    ) private view {
        if (takerPreferenceId == makerPreferenceId) {
            revert InvalidTakerPreference();
        }
        if (maker.metadata.side == taker.metadata.side) {
            revert SameSidePreference(takerPreferenceId, makerPreferenceId);
        }
        if (preferenceBook.marketKey(maker.metadata) != takerMarketKey) {
            revert BucketMismatch(takerPreferenceId, makerPreferenceId);
        }
    }

    function _isExecutable(
        bytes32 preferenceId,
        ConfidentialPreferenceBook.PreferenceBundle memory preference
    ) private view returns (bool) {
        return
            !_lockedPreferences[preferenceId] &&
            preference.status == ConfidentialPreferenceBook.PreferenceStatus.Executable &&
            preference.metadata.expiry > block.timestamp;
    }

    function _validateCandidateSet(uint256 candidateCount) private pure {
        if (candidateCount == 0 || candidateCount > MAX_CANDIDATES) {
            revert InvalidCandidateSet();
        }
    }
}
