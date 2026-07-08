// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title IConfidentialCreditCommitmentVerifier
/// @notice Read-only readiness check for reusable lender credit commitments.
interface IConfidentialCreditCommitmentVerifier {
    function isCreditCommitmentExecutable(
        bytes32 commitmentHash,
        address manager
    ) external view returns (bool executable);
}
