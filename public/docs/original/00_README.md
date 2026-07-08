# Confidential Vesting-Backed Credit Protocol — Architecture Package

This package is a handoff-ready architecture set for a production-oriented protocol built on Zama fhEVM, ERC-7984 confidential tokens, TokenOps confidential vesting, and custom private negotiation / loan escrow contracts.

## Document map

1. `01_PRD.md` — product requirements and user journeys.
2. `02_ADR.md` — architecture decisions and alternatives considered.
3. `03_SYSTEM_ARCHITECTURE.md` — components, trust boundaries, and integrations.
4. `04_PROTOCOL_SPEC.md` — protocol mechanics, state machines, matching, escrow, default.
5. `05_SECURITY_THREAT_MODEL.md` — risks, trust assumptions, attacks, mitigations.
6. `06_CODEX_IMPLEMENTATION_PLAN.md` — implementation milestones, interfaces, acceptance criteria.
7. `07_MARKETING_POSITIONING_APPENDIX.md` — terminology and positioning notes.

## Core idea

The protocol is a Confidential Preference Book for vesting-backed credit. Borrowers and lenders submit private ranked constraints. A taker initiates an encrypted Nash-style negotiation against the opposite side of the book. If the match succeeds, both sides escrow assets, the loan activates, and repayment/default is enforced by the loan escrow contract.

## Key decisions

- Protocol accounts, not raw wallets, are the main participants.
- MVP negotiates four fields: principal, interest rate, duration, grace period.
- Negotiation uses ranked constraints and a bounded Nash bargaining approximation.
- cUSDC is confidential.
- Vesting collateral is escrowed before activation.
- Lender capital is escrowed before activation.
- No mark-to-market liquidation.
- Default means missed confidential cUSDC payment; remedy is vesting beneficiary reassignment to lender.
- Public function calls are acceptable; exact amounts/terms/due dates remain private where the stack allows.
- Failed match attempts require a bond, slashed and split between probed counterparties and protocol treasury.

## External facts used

- TokenOps SDK docs describe confidential vesting, airdrop, and disperse on FHEVM, with encrypted handles and ACL-controlled views.
- TokenOps vesting docs list transfer-related hooks: `useInitiateVestingTransfer`, `useAcceptVestingTransfer`, `useCancelVestingTransfer`, and `useDirectVestingTransfer`.
- TokenOps vesting docs state schedules are plaintext while amounts are encrypted handles; this affects the privacy model.
- OpenZeppelin documents ERC-7984 as a confidential fungible token implementation where balances and transfer amounts are ciphertext handles.

## Suggested review order

Review `02_ADR.md` first to confirm decisions, then `04_PROTOCOL_SPEC.md`, then `06_CODEX_IMPLEMENTATION_PLAN.md`.

## v0.4 Respec Addendum

This package now includes a respec that supersedes the earlier Phase 1 Protocol Account assumption:

- `08_IDENTITY_PRIVACY_RESPEC.md` — revised identity/privacy architecture
- `09_CODEX_DELTA_RESPEC.md` — concise Codex implementation delta

Key change: Phase 1 should not require Protocol Accounts. Use Zama/ERC-7984/TokenOps-compatible addressing, keep economic terms confidential, and treat transaction-layer identity privacy as Phase 2.

## v0.5 UX Addendum

Additional UX handoff files:

- `10_PREFERENCE_BUILDER_UX_SPEC.md` — preference-builder philosophy, data model, scoring approach, and Codex implementation guidance.
- `10_PREFERENCE_BUILDER_UX_ANNOTATED.png` — annotated visual mockup of the proposed builder UI.

This addendum clarifies that preference cards are ranked constraint bundles with internal utility coloring, not merely exact term packages.
