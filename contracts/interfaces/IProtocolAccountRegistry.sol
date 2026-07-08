// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

interface IProtocolAccountRegistry {
    function OWNER_ROLE() external view returns (bytes32);
    function OPERATOR_ROLE() external view returns (bytes32);
    function hasAccountRole(uint256 accountId, address wallet, bytes32 role) external view returns (bool);
}
