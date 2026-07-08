// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title DemoVestingToken
/// @notice Faucet ERC20-style token for demos only.
/// @dev This is not an ERC-7984 confidential token and must not be used as production collateral.
contract DemoVestingToken {
    string public name;
    string public symbol;
    uint8 public decimals = 18;
    uint256 public constant FAUCET_AMOUNT = 10_000 ether;
    uint256 public constant FAUCET_COOLDOWN = 1 hours;

    uint256 public totalSupply;
    mapping(address account => uint256 balance) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;
    mapping(address account => uint256 timestamp) public lastFaucetAt;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);
    event DemoFaucetClaimed(address indexed account, uint256 amount);

    error InvalidRecipient();
    error InsufficientBalance(uint256 available, uint256 required);
    error InsufficientAllowance(uint256 available, uint256 required);
    error FaucetCooldownActive(uint256 nextClaimAt);

    constructor(string memory name_, string memory symbol_) {
        name = bytes(name_).length == 0 ? "Demo Vested Collateral" : name_;
        symbol = bytes(symbol_).length == 0 ? "dVEST" : symbol_;
    }

    function faucet() external returns (uint256 amount) {
        uint256 nextClaimAt = lastFaucetAt[msg.sender] + FAUCET_COOLDOWN;
        if (lastFaucetAt[msg.sender] != 0 && block.timestamp < nextClaimAt) {
            revert FaucetCooldownActive(nextClaimAt);
        }

        lastFaucetAt[msg.sender] = block.timestamp;
        amount = FAUCET_AMOUNT;
        _mint(msg.sender, amount);
        emit DemoFaucetClaimed(msg.sender, amount);
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
