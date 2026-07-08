# Product Requirements Document

## 1. Product objective

Build a production-oriented confidential credit protocol where a borrower can privately borrow confidential cUSDC against a confidential vesting position. The protocol should allow private borrower/lender preferences, deterministic encrypted negotiation, bilateral escrow before activation, and payment-default enforcement through vesting beneficiary reassignment.

## 2. Primary users

### Borrower

A participant with an existing confidential vesting position who wants liquidity before vesting completion without publicly revealing vesting amount, desired principal, acceptable rate, repayment schedule, or negotiating preferences.

### Lender

A participant with confidential cUSDC who wants to lend against future vested tokens without publicly revealing available capital, required rate, desired duration, or risk constraints.

### Taker

A borrower or lender who is online and initiates an attempt to negotiate against the opposite side of the confidential preference book. In MVP, takers are self-interested parties rather than external keepers.

### Protocol account

A protocol-level account representing a participant. A protocol account may control multiple wallets, preferences, active loans, reputation, permissions, and future credentials.

## 3. MVP scope

The MVP supports one borrower and one lender per loan. Syndication is out of scope.

The MVP negotiates four fields:

1. Principal
2. Interest rate
3. Duration
4. Grace period

The MVP uses ranked constraints rather than explicit utility curves. Users express acceptable preferences through a simple UI and reorder them from most preferred to least preferred.

## 4. User journeys

### Borrower creates a preference profile

1. Borrower connects wallet to a protocol account.
2. Borrower selects a vesting position.
3. Borrower creates ranked borrowing preferences.
4. Borrower authorizes relevant encrypted data access for protocol operations.
5. Borrower publishes coarse public metadata and encrypted preferences.

### Lender creates a preference profile

1. Lender connects wallet to a protocol account.
2. Lender confirms confidential cUSDC availability.
3. Lender creates ranked lending preferences.
4. Lender publishes coarse public metadata and encrypted preferences.

### Taker initiates negotiation

1. Taker chooses a public bucket or candidate set.
2. Taker posts a match-attempt bond.
3. Protocol evaluates candidate counterparties using encrypted Nash bargaining approximation.
4. If no match is found, bond is partially or fully slashed.
5. If match is found, final terms are made decryptable only to borrower and lender.

### Loan activation

1. Borrower transfers or escrows TokenOps vesting position into LoanEscrow.
2. Lender escrows confidential cUSDC into LoanEscrow.
3. LoanEscrow verifies sufficient collateral and lender capital using encrypted checks.
4. Public output reveals only activation success/failure.
5. If successful, cUSDC principal is released to borrower and loan becomes active.

### Repayment

1. Borrower pays confidential cUSDC according to the private schedule.
2. LoanEscrow records encrypted payment state.
3. If fully repaid, vesting control/benefit is returned to borrower.

### Default

1. Anyone may call `checkDefault(loanId)`.
2. LoanEscrow privately evaluates whether a due date plus grace period has passed and payment is insufficient.
3. If default is true, vesting beneficiary/control is reassigned to lender.
4. Public observers may learn that default execution occurred, but not the private terms, amount, or due date.

## 5. UX requirements

### Ranked constraints UI

The UI should present preference cards. Each card includes:

- Principal
- Interest rate limit
- Duration
- Grace period

Users add cards, fill values using dropdowns/sliders/validated inputs, and drag cards into preference order.

The UI must not expose internal concepts such as Nash product, encrypted surplus, or utility weights.

### Discovery UI

Discovery should use coarse public buckets:

- Asset/vesting class
- Principal range
- Duration range
- Availability/expiry
- Optional coarse dealability tier

Fine-grained terms remain encrypted.

## 6. Non-goals for MVP

- Full private identity.
- External keeper rewards.
- Syndicated loans.
- Price-based liquidations.
- Continuous market clearing.
- Complex utility curves.
- Multiple negotiation algorithms.
- Regulatory credentialing / KYC.

## 7. Success criteria

The MVP is successful if it can:

- Register borrower and lender protocol accounts.
- Store encrypted ranked preferences.
- Run bounded Nash-style negotiation.
- Require bilateral escrow before activation.
- Activate a confidential loan.
- Track confidential repayment.
- Execute default-based vesting reassignment.
- Prevent free probing through failed-attempt bonds.
