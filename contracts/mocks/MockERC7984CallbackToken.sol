// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ERC7984} from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";

contract MockERC7984CallbackToken is ZamaEthereumConfig, ERC7984 {
    constructor() ERC7984("Mock Confidential USD", "mcUSD", "") {}

    function mint(address to, externalEuint64 encryptedAmount, bytes calldata inputProof) external returns (euint64) {
        euint64 amount = FHE.fromExternal(encryptedAmount, inputProof);
        return _mint(to, amount);
    }
}
