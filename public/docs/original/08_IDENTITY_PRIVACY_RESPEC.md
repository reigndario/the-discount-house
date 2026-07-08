# Identity & Privacy Respec v0.4

## Purpose

This document supersedes the earlier Phase 1 assumption that the protocol should be built around `ProtocolAccountId` as the primary participant abstraction.

After revisiting Zama address semantics, TokenOps/ERC-7984 behavior, and future privacy-layer compatibility, the Phase 1 design should be simplified:

> Use native EVM addresses and Zama-compatible encrypted address values where supported. Do not introduce Protocol Accounts in Phase 1 unless a later implementation blocker requires them.

## Key Finding

Zama fhEVM can encrypt values, including address-like values in contract state, but it does not automatically hide transaction sender metadata.

The distinction is critical:

| Concept | Privacy Status |
|---|---|
| `msg.sender` / transaction sender | Public EVM metadata |
| Function call timing | Public blockchain metadata |
| Encrypted amounts / terms / due dates | Confidential via fhEVM |
| Encrypted address stored as contract state | Confidential if implemented as encrypted state and ACL-controlled |
| Token recipient addresses in common ERC-style interfaces | Often public unless contract specifically supports encrypted recipient semantics |

OpenZeppelin’s audit of the TokenOps/Zama confidential airdrop system explicitly states that “confidential” in that reviewed context meant hidden token amounts, while recipient addresses were not hidden. This means the protocol must not assume TokenOps automatically gives end-to-end identity privacy at the transaction layer.

## Revised Phase 1 Identity Position

Phase 1 shall provide:

- confidential loan terms
- confidential principal
- confidential interest rate
- confidential due dates
- confidential grace periods
- confidential repayment sufficiency
- confidential vesting/cUSDC amounts
- best-effort participant privacy where supported by Zama encrypted address primitives

Phase 1 shall not claim:

- hidden transaction sender identity
- hidden wallet graph
- full borrower/lender anonymity
- unlinkability of function calls
- private counterparties at the mempool/transaction layer

## Protocol Account Decision

Earlier drafts recommended `ProtocolAccountId` as the primary identity abstraction. That is now deferred.

Rationale:

1. The current goal is to maximize compatibility with Zama, ERC-7984, and TokenOps.
2. Protocol Accounts add complexity before proving they are necessary.
3. They do not, by themselves, solve transaction-layer privacy.
4. Future privacy layers can be integrated if operational functions avoid hard `msg.sender == borrower/lender` assumptions.

Phase 1 should use:

```solidity
address borrowerWallet;
address lenderWallet;
```

where unavoidable for EVM/TokenOps compatibility, and encrypted address/state handles where supported:

```solidity
eaddress borrowerEncrypted;
eaddress lenderEncrypted;
```

Implementation should avoid designing the core loan lifecycle around wallet addresses more than necessary.

## Publicly Callable Function Design

Operational functions should generally be publicly callable:

- `attemptMatch(...)`
- `fundLoan(...)`
- `makeLoanPayment(...)`
- `checkDefault(...)`
- `finalizeRepayment(...)`
- `cancelExpiredMatch(...)`
- `unwindFailedActivation(...)`

Do not require privacy-sensitive actions to be called only by the visible borrower/lender EOA.

Avoid:

```solidity
require(msg.sender == borrower);
```

for functions where relayers, account abstraction, stealth wallets, privacy routers, or delegated agents should later be able to call on behalf of a party.

Prefer:

- explicit loan identifiers
- encrypted inputs
- token allowances/permissions
- signed capabilities
- ACL permissions over ciphertexts
- escrow state checks
- replay-protected authorizations

## Payment Function Compatibility

`makeLoanPayment` should be compatible with future privacy solutions.

The function should not require that the caller is visibly the borrower. Instead it should accept or derive:

- `loanId`
- encrypted cUSDC payment amount
- proof/handle that funds were transferred or escrowed
- authorization/capability permitting the payment to be credited to the loan

A third-party relayer or privacy system should be able to call the function as long as:

1. the confidential cUSDC transfer succeeds;
2. the loan receives credit for the payment;
3. the ciphertext permissions are valid;
4. replay protection passes.

This preserves compatibility with future relayer, account abstraction, stealth address, or Siphon-like privacy integrations.

## TokenOps Integration Respec

TokenOps vesting transfer/reassignment remains central to the protocol.

However, the protocol should treat TokenOps identity privacy conservatively:

- use TokenOps for confidential vesting and transfer/reassignment primitives;
- verify exact TokenOps vesting recipient semantics during implementation;
- do not assume recipient identity is hidden unless the specific contract interface and implementation prove it;
- if TokenOps requires public recipient addresses, record that as a Phase 1 privacy limitation.

Recommended Phase 1 vesting flow remains:

1. Borrower holds TokenOps vesting position.
2. Borrower transfers vesting position/control to `LoanEscrow`.
3. `LoanEscrow` controls reassignment based on repayment/default state.
4. On full repayment, vesting control returns to borrower.
5. On default, vesting beneficiary/control transfers to lender.

## Phase 2 Identity / Privacy Layer

Phase 2 may introduce one or more of:

- relayers
- account abstraction
- stealth addresses
- privacy wallets
- encrypted identity credentials
- selective disclosure credentials
- anonymous credentials
- Siphon-like FHE + ZK transaction privacy
- protocol accounts for institutional delegation and recovery

Protocol Accounts should be reconsidered only when there is a concrete requirement for:

- key rotation
- institutional multi-wallet control
- delegated permissions
- account recovery
- reputation continuity across wallets
- private credential binding

## Security/Privacy Statement

The protocol’s Phase 1 privacy claim should be:

> The protocol protects economically sensitive values and terms using Zama fhEVM, including amounts, schedules, repayment sufficiency, and negotiation preferences. It does not guarantee transaction-layer anonymity in Phase 1.

Do not market Phase 1 as hiding borrower/lender identities unless a tested privacy layer is integrated.

## Implementation Guidance for Codex

Codex should update architecture and contract plans as follows:

1. Remove `ProtocolAccountId` from the Phase 1 core model.
2. Use EVM addresses where required for TokenOps/ERC-7984 compatibility.
3. Use encrypted address fields only where supported and useful.
4. Keep operational functions publicly callable.
5. Avoid hard authorization based solely on `msg.sender` for borrower/lender actions.
6. Use signed capabilities, escrow state, ACL permissions, and encrypted checks instead.
7. Preserve clean extension points for relayers/privacy wallets/stealth accounts.
8. Document Phase 1 identity privacy as best-effort only.

