# Demo contracts

These contracts are separated from the core protocol on purpose. They are convenience pieces for local and Sepolia
demonstrations: faucets, demo vesting issuance, and cleartext credit registration helpers.

Warnings:

- These contracts are not production ERC-7984 token implementations.
- These contracts are not production TokenOps vesting contracts.
- `DemoUsdToken` can mint arbitrary demo USD and is intentionally not supply controlled.
- Each `DemoTokenOpsVestingFactory` is bound to exactly one demo collateral token.
- Demo credit helpers disclose values that the production ERC-7984 path should keep confidential.
- Use these contracts to make the demo site self-service, then replace or disable them before any production deployment.
