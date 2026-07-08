// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {MockConfidentialCreditAdapter} from "../mocks/MockConfidentialCreditAdapter.sol";

/// @title DemoCreditFaucet
/// @notice Demo wrapper for registering cleartext credit readiness against MockConfidentialCreditAdapter.
/// @dev This is not an ERC-7984 token and is not privacy preserving. Disable it outside demo networks.
contract DemoCreditFaucet {
    MockConfidentialCreditAdapter public immutable creditAdapter;

    event DemoCreditCommitmentIssued(bytes32 indexed commitmentHash, address indexed manager, uint64 expiry);
    event DemoCreditAuthorized(bytes32 indexed authorizationHash, address indexed payer, uint256 amount);

    error InvalidCreditAdapter();

    constructor(MockConfidentialCreditAdapter creditAdapter_) {
        if (address(creditAdapter_) == address(0)) {
            revert InvalidCreditAdapter();
        }

        creditAdapter = creditAdapter_;
    }

    function issueDemoCreditCommitment(bytes32 commitmentHash, uint64 expiry) external {
        creditAdapter.registerLenderCreditCommitment(commitmentHash, msg.sender, expiry);
        emit DemoCreditCommitmentIssued(commitmentHash, msg.sender, expiry);
    }

    function authorizeDemoCredit(bytes32 authorizationHash, address payer, uint256 amount) external {
        creditAdapter.authorizeCredit(authorizationHash, payer, amount);
        emit DemoCreditAuthorized(authorizationHash, payer, amount);
    }
}
