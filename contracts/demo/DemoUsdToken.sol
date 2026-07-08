// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title DemoUsdToken
/// @notice Faucet ERC20-style USD token for demos only.
/// @dev This is not a production ERC-7984 confidential stablecoin and must not be used in production settlement.
contract DemoUsdToken {
    string public name = "Demo USD";
    string public symbol = "dUSD";
    uint8 public decimals = 18;

    uint256 public totalSupply;
    mapping(address account => uint256 balance) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);
    event DemoUsdMinted(address indexed recipient, uint256 amount);

    error InvalidRecipient();
    error InvalidAmount();
    error InsufficientBalance(uint256 available, uint256 required);
    error InsufficientAllowance(uint256 available, uint256 required);

    function faucet(uint256 amount) external returns (uint256 mintedAmount) {
        if (amount == 0) {
            revert InvalidAmount();
        }

        _mint(msg.sender, amount);
        emit DemoUsdMinted(msg.sender, amount);
        return amount;
    }

    function mintTo(address recipient, uint256 amount) external returns (uint256 mintedAmount) {
        if (amount == 0) {
            revert InvalidAmount();
        }

        _mint(recipient, amount);
        emit DemoUsdMinted(recipient, amount);
        return amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 availableAllowance = allowance[from][msg.sender];
        if (availableAllowance < amount) {
            revert InsufficientAllowance(availableAllowance, amount);
        }

        allowance[from][msg.sender] = availableAllowance - amount;
        _transfer(from, to, amount);
        return true;
    }

    function _mint(address to, uint256 amount) internal {
        if (to == address(0)) {
            revert InvalidRecipient();
        }

        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function _transfer(address from, address to, uint256 amount) internal {
        if (to == address(0)) {
            revert InvalidRecipient();
        }

        uint256 availableBalance = balanceOf[from];
        if (availableBalance < amount) {
            revert InsufficientBalance(availableBalance, amount);
        }

        balanceOf[from] = availableBalance - amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}
