// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title IConfidentialCreditAdapter
/// @notice Adapter boundary for confidential cUSDT/cUSDC escrow credits.
/// @dev Implementations should only allow the loan escrow itself to consume its registered credit.
/// Local tests may disclose amounts. Production implementations should consume ERC-7984 encrypted handles.
interface IConfidentialCreditAdapter {
    function registerCreditAuthorization(
        bytes32 authorizationHash,
        address expectedPayer,
        uint256 expectedAmount,
        uint64 deadline
    ) external;

    function registerCreditDrawAuthorization(
        bytes32 authorizationHash,
        bytes32 commitmentHash,
        address expectedPayer,
        uint256 expectedAmount,
        uint64 deadline
    ) external;

    function consumeCredit(bytes32 authorizationHash, address loanEscrow) external returns (uint256 creditedAmount);

    function releaseCredit(
        bytes32 authorizationHash,
        address loanEscrow,
        address recipient
    ) external returns (bytes32 releasedAmountHandle);
}
