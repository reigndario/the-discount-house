// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title BondManager
/// @notice Handles match-attempt bonds, failed-attempt slashing, treasury splits, and taker cooldowns.
contract BondManager {
    uint16 public constant BPS_DENOMINATOR = 10_000;

    enum AttemptStatus {
        None,
        Posted,
        Refunded,
        Slashed
    }

    struct BondConfig {
        uint256 baseBondWei;
        uint16 configuredMinBatchSize;
        uint16 treasuryShareBps;
        uint16 thinMarketPenaltyBps;
        uint32 failedAttemptCooldownSeconds;
    }

    struct BondAttempt {
        address taker;
        uint256 takerAccountId;
        uint256 bondAmount;
        uint256 candidateCount;
        uint256 availableCounterparties;
        uint64 postedAt;
        AttemptStatus status;
    }

    address public owner;
    address public treasury;
    BondConfig public config;

    mapping(address caller => bool authorizedSettler) public authorizedSettlers;
    mapping(bytes32 attemptId => BondAttempt attempt) private _attempts;
    mapping(address taker => uint256 cooldownUntil) public takerCooldownUntil;
    uint256 private _nonce;
    bool private _settling;

    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event BondConfigUpdated(BondConfig config);
    event SettlerAuthorized(address indexed settler, bool authorized);
    event BondPosted(
        bytes32 indexed attemptId,
        address indexed taker,
        uint256 indexed takerAccountId,
        uint256 bondAmount,
        uint256 candidateCount,
        uint256 availableCounterparties
    );
    event BondRefunded(bytes32 indexed attemptId, address indexed taker, uint256 amount);
    event BondSlashed(bytes32 indexed attemptId, uint256 treasuryAmount, uint256 counterpartyAmount);

    error InvalidOwner();
    error InvalidTreasury();
    error InvalidConfig();
    error UnauthorizedSettler(address caller);
    error EmptyMarket();
    error InvalidCandidateSet();
    error InsufficientBatchSize(uint256 requiredBatchSize, uint256 candidateCount);
    error InsufficientBond(uint256 requiredBond, uint256 suppliedBond);
    error TakerInCooldown(address taker, uint256 cooldownUntil);
    error AttemptDoesNotExist(bytes32 attemptId);
    error AttemptNotPosted(bytes32 attemptId);
    error TransferFailed(address recipient, uint256 amount);
    error ReentrantSettlement();

    modifier onlyOwner() {
        if (msg.sender != owner) {
            revert InvalidOwner();
        }
        _;
    }

    modifier onlyAuthorizedSettler() {
        if (!authorizedSettlers[msg.sender]) {
            revert UnauthorizedSettler(msg.sender);
        }
        _;
    }

    modifier nonReentrantSettlement() {
        if (_settling) {
            revert ReentrantSettlement();
        }
        _settling = true;
        _;
        _settling = false;
    }

    constructor(address treasury_, BondConfig memory config_) {
        if (treasury_ == address(0)) {
            revert InvalidTreasury();
        }

        owner = msg.sender;
        treasury = treasury_;
        authorizedSettlers[msg.sender] = true;
        _setConfig(config_);

        emit OwnershipTransferred(address(0), msg.sender);
        emit TreasuryUpdated(address(0), treasury_);
        emit SettlerAuthorized(msg.sender, true);
    }

    function postBond(
        uint256 takerAccountId,
        uint256 candidateCount,
        uint256 availableCounterparties
    ) external payable returns (bytes32 attemptId) {
        _validateCandidateSet(candidateCount, availableCounterparties);

        uint256 cooldownUntil = takerCooldownUntil[msg.sender];
        if (block.timestamp < cooldownUntil) {
            revert TakerInCooldown(msg.sender, cooldownUntil);
        }

        uint256 requiredBond = quoteBond(candidateCount, availableCounterparties);
        if (msg.value < requiredBond) {
            revert InsufficientBond(requiredBond, msg.value);
        }

        attemptId = keccak256(abi.encode(address(this), block.chainid, ++_nonce, msg.sender, takerAccountId));
        _attempts[attemptId] = BondAttempt({
            taker: msg.sender,
            takerAccountId: takerAccountId,
            bondAmount: msg.value,
            candidateCount: candidateCount,
            availableCounterparties: availableCounterparties,
            postedAt: uint64(block.timestamp),
            status: AttemptStatus.Posted
        });

        emit BondPosted(attemptId, msg.sender, takerAccountId, msg.value, candidateCount, availableCounterparties);
    }

    function refundBond(bytes32 attemptId) external onlyAuthorizedSettler nonReentrantSettlement {
        BondAttempt storage attempt = _requirePostedAttempt(attemptId);
        attempt.status = AttemptStatus.Refunded;

        _sendValue(attempt.taker, attempt.bondAmount);
        emit BondRefunded(attemptId, attempt.taker, attempt.bondAmount);
    }

    function slashBond(
        bytes32 attemptId,
        address payable[] calldata counterparties
    ) external onlyAuthorizedSettler nonReentrantSettlement {
        BondAttempt storage attempt = _requirePostedAttempt(attemptId);
        if (counterparties.length == 0) {
            revert InvalidCandidateSet();
        }

        attempt.status = AttemptStatus.Slashed;
        takerCooldownUntil[attempt.taker] = block.timestamp + config.failedAttemptCooldownSeconds;

        uint256 treasuryAmount = (attempt.bondAmount * config.treasuryShareBps) / BPS_DENOMINATOR;
        uint256 counterpartyPool = attempt.bondAmount - treasuryAmount;
        uint256 perCounterparty = counterpartyPool / counterparties.length;
        uint256 remainder = counterpartyPool - (perCounterparty * counterparties.length);

        _sendValue(treasury, treasuryAmount + remainder);
        for (uint256 i = 0; i < counterparties.length; i++) {
            _sendValue(counterparties[i], perCounterparty);
        }

        emit BondSlashed(attemptId, treasuryAmount + remainder, counterpartyPool - remainder);
    }

    function quoteBond(uint256 candidateCount, uint256 availableCounterparties) public view returns (uint256) {
        _validateCandidateSet(candidateCount, availableCounterparties);

        uint256 requiredBatchSize = requiredBatchSizeFor(availableCounterparties);
        uint256 requiredBond = config.baseBondWei;

        if (candidateCount < config.configuredMinBatchSize) {
            uint256 missingCandidates = config.configuredMinBatchSize - candidateCount;
            requiredBond += (config.baseBondWei * config.thinMarketPenaltyBps * missingCandidates) / BPS_DENOMINATOR;
        }

        if (candidateCount < requiredBatchSize) {
            revert InsufficientBatchSize(requiredBatchSize, candidateCount);
        }

        return requiredBond;
    }

    function requiredBatchSizeFor(uint256 availableCounterparties) public view returns (uint256) {
        if (availableCounterparties == 0) {
            return 0;
        }
        uint256 configuredMin = config.configuredMinBatchSize;
        return availableCounterparties < configuredMin ? availableCounterparties : configuredMin;
    }

    function getAttempt(bytes32 attemptId) external view returns (BondAttempt memory) {
        BondAttempt memory attempt = _attempts[attemptId];
        if (attempt.status == AttemptStatus.None) {
            revert AttemptDoesNotExist(attemptId);
        }
        return attempt;
    }

    function setConfig(BondConfig calldata config_) external onlyOwner {
        _setConfig(config_);
    }

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) {
            revert InvalidTreasury();
        }
        address oldTreasury = treasury;
        treasury = treasury_;
        emit TreasuryUpdated(oldTreasury, treasury_);
    }

    function setAuthorizedSettler(address settler, bool authorized) external onlyOwner {
        if (settler == address(0)) {
            revert InvalidOwner();
        }
        authorizedSettlers[settler] = authorized;
        emit SettlerAuthorized(settler, authorized);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) {
            revert InvalidOwner();
        }
        address oldOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }

    function _setConfig(BondConfig memory config_) private {
        if (
            config_.baseBondWei == 0 ||
            config_.configuredMinBatchSize == 0 ||
            config_.treasuryShareBps > BPS_DENOMINATOR ||
            config_.thinMarketPenaltyBps > BPS_DENOMINATOR
        ) {
            revert InvalidConfig();
        }

        config = config_;
        emit BondConfigUpdated(config_);
    }

    function _validateCandidateSet(uint256 candidateCount, uint256 availableCounterparties) private view {
        if (availableCounterparties == 0) {
            revert EmptyMarket();
        }
        if (candidateCount == 0 || candidateCount > availableCounterparties) {
            revert InvalidCandidateSet();
        }

        uint256 requiredBatchSize = requiredBatchSizeFor(availableCounterparties);
        if (candidateCount < requiredBatchSize) {
            revert InsufficientBatchSize(requiredBatchSize, candidateCount);
        }
    }

    function _requirePostedAttempt(bytes32 attemptId) private view returns (BondAttempt storage attempt) {
        attempt = _attempts[attemptId];
        if (attempt.status == AttemptStatus.None) {
            revert AttemptDoesNotExist(attemptId);
        }
        if (attempt.status != AttemptStatus.Posted) {
            revert AttemptNotPosted(attemptId);
        }
    }

    function _sendValue(address recipient, uint256 amount) private {
        if (amount == 0) {
            return;
        }
        (bool ok, ) = recipient.call{value: amount}("");
        if (!ok) {
            revert TransferFailed(recipient, amount);
        }
    }
}
