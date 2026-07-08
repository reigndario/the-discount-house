# Codex Delta — Identity & Privacy Respec

## Summary

Replace the previous Phase 1 `ProtocolAccountId` design with direct Zama/ERC-7984/TokenOps-compatible participant addressing.

Phase 1 should optimize for existing Zama ecosystem compatibility and confidential economic terms, not full identity anonymity.

## Required Changes

### Remove from Phase 1

- `ProtocolAccountId` as primary participant identifier
- protocol account registry as required infrastructure
- assumptions that wallet identity is private
- assumptions that TokenOps hides recipient/counterparty addresses end-to-end

### Add to Phase 1

- public/best-effort pseudonymous EVM addresses where required
- encrypted address fields where supported by Zama contracts
- publicly callable operational functions
- authorization via capabilities/permissions rather than visible caller identity
- explicit documentation of transaction-layer metadata leakage

## Contract Design Guidance

Bad pattern:

```solidity
function makeLoanPayment(uint256 loanId, ...) external {
    require(msg.sender == loans[loanId].borrower);
    ...
}
```

Preferred pattern:

```solidity
function makeLoanPayment(uint256 loanId, EncryptedPayment calldata payment, PaymentAuth calldata auth) external {
    // caller may be borrower, lender, relayer, privacy router, or future keeper
    // validate payment authorization / token transfer / ciphertext ACL / replay protection
    // credit payment to loan
}
```

Bad pattern:

```solidity
function checkDefault(uint256 loanId) external onlyLender(loanId) { ... }
```

Preferred pattern:

```solidity
function checkDefault(uint256 loanId) external {
    // anyone may call
    // if default condition resolves true, escrow reassigns vesting control/beneficiary
}
```

## Updated Privacy Matrix

| Item | Phase 1 Status |
|---|---|
| Principal | Confidential |
| Interest rate | Confidential |
| Duration | Confidential unless intentionally coarse-public |
| Grace period | Confidential |
| Payment due dates | Confidential, with timing leakage from calls |
| Payment sufficiency | Confidential; only boolean result revealed as needed |
| Vesting amount | Confidential |
| cUSDC balances/transfers | Confidential if ERC-7984 implementation supports it |
| Borrower/lender transaction sender | Public |
| Borrower/lender stored identity | Best effort encrypted where supported |
| Match/default transaction timing | Public |
| Default occurrence | Public if state transition succeeds |

## Function Compatibility Rule

All core lifecycle functions should be callable by a future privacy layer. Therefore, do not encode business logic that requires the visible caller to be the economic party unless absolutely necessary.

Use one or more of:

- signed authorizations
- nonce/replay protection
- escrowed asset custody
- confidential token allowance/permission model
- fhEVM ACL permissions
- encrypted state checks
- role/capability tokens

## Future Phase 2 Extension Points

Keep interfaces compatible with:

- relayer/meta-transaction systems
- account abstraction wallets
- stealth address workflows
- anonymous/credential-based eligibility systems
- Siphon-like privacy routers
- protocol account registry if later required

## Product Language Update

Do not claim Phase 1 provides anonymous borrowing/lending.

Use:

> Confidential terms and confidential settlement.

Avoid:

> Anonymous counterparties.

