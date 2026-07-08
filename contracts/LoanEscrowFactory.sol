// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {LoanEscrow} from "./LoanEscrow.sol";

/// @title LoanEscrowFactory
/// @notice Creates escrow contracts for successful confidential preference matches.
contract LoanEscrowFactory {
    mapping(bytes32 loanId => address escrow) public escrowForLoan;
    uint256 private _nonce;

    event LoanCreated(bytes32 indexed loanId, address indexed escrow, bytes32 indexed termsHash);

    error LoanAlreadyExists(bytes32 loanId);

    function createLoanEscrow(LoanEscrow.LoanConfig calldata config) external returns (bytes32 loanId, address escrow) {
        loanId = keccak256(
            abi.encode(address(this), block.chainid, ++_nonce, config.termsHash, config.encryptedTermsHash)
        );
        if (escrowForLoan[loanId] != address(0)) {
            revert LoanAlreadyExists(loanId);
        }

        escrow = address(new LoanEscrow(config));
        escrowForLoan[loanId] = escrow;

        emit LoanCreated(loanId, escrow, config.termsHash);
    }
}
