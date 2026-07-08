# Architecture Decision Record

## ADR-001: Use protocol accounts instead of raw wallets

### Decision

Use protocol accounts as the primary counterparty identity abstraction. Wallets authenticate and operate accounts, but preferences, reputation, active loans, permissions, and future credentials belong to protocol accounts.

### Rationale

Production financial systems need key rotation, institutional use, multisig support, delegated permissions, recovery, and future credential integration. Wallet-only identity would make these harder and would fragment reputation.

### Consequences

- MVP requires a `ProtocolAccountRegistry`.
- Wallet privacy is not solved in MVP.
- Future account abstraction and anonymous credentials remain possible.

## ADR-002: Use ERC-7984 confidential tokens for cUSDC and confidential assets

### Decision

Use ERC-7984-compatible confidential tokens where possible, particularly for confidential cUSDC.

### Rationale

ERC-7984 is documented by OpenZeppelin as a confidential fungible token implementation where balances and transfer amounts are represented as ciphertext handles.

### Consequences

- Contracts interact with encrypted handles instead of plain token amounts.
- Operator approvals and ACL/decryption flows must be modeled explicitly.
- Integration tests must use Zama/fhEVM-compatible tooling.

## ADR-003: Use TokenOps confidential vesting where possible

### Decision

Use TokenOps vesting as the vesting substrate rather than building a replacement.

### Rationale

TokenOps SDK documents confidential vesting on FHEVM and transfer-related hooks, including `useInitiateVestingTransfer`, `useAcceptVestingTransfer`, and `useDirectVestingTransfer`. TokenOps also provides ACL-controlled encrypted amount views.

### Consequences

- LoanEscrow must integrate with TokenOps manager/vesting abstractions.
- TokenOps schedules are documented as plaintext while amounts are encrypted; the protocol privacy model must account for this.
- If TokenOps transfer semantics constrain smart-contract custody, implement an adapter rather than forking the vesting system immediately.

## ADR-004: Use ranked constraints, not utility curves, for MVP

### Decision

Participants submit ordered preference cards consisting of constraints over principal, interest rate, duration, and grace period.

### Rationale

Ranked constraints are easier for users to understand and easier to implement in fhEVM than utility curves or continuous optimization. They are compatible with a drag-and-drop UI.

### Consequences

- Preference lists must be bounded.
- The Nash bargaining approximation uses rank-derived surplus rather than arbitrary utility weights.
- Future utility curves can be added as an advanced mode.

## ADR-005: Use one protocol-defined negotiation algorithm

### Decision

MVP uses one deterministic algorithm: bounded Nash bargaining approximation over ranked constraints.

### Rationale

Multiple algorithms fragment liquidity, complicate audits, and make user expectations harder to manage.

### Consequences

- All users participate in the same market mechanism.
- Algorithm upgrades require governance or a versioned contract.

## ADR-006: Asynchronous maker/taker model

### Decision

Preferences remain in the book until cancelled, expired, matched, or superseded. Negotiation executes when a taker initiates an attempt.

### Rationale

The user model is closer to market makers and takers than periodic batch clearing. Takers pay execution costs and attempt negotiation when online.

### Consequences

- The book must remove or mark stale/taken preferences.
- Function-call timing may leak interaction metadata.
- Candidate discovery requires public coarse metadata or future private routing.

## ADR-007: Economic defense against probing

### Decision

Require match-attempt bonds. Failed attempts are slashed and split between probed counterparties and the protocol treasury.

### Rationale

Repeated failed queries can act as side-channel probes. Economic cost discourages probing and compensates counterparties.

### Consequences

- Thin markets need higher bonds or cooldowns.
- Candidate sets should have a target minimum size where available.
- Failed attempts reveal no reason.

## ADR-008: No mark-to-market liquidation

### Decision

Do not use price-based liquidation. Default is based solely on missed confidential cUSDC payment.

### Rationale

This avoids oracle dependence and continuous collateral valuation, substantially simplifying the protocol.

### Consequences

- Lender remedy is reassignment of vesting beneficiary/control.
- Collateral remains vesting; lender receives the future vesting stream.

## ADR-009: Private identity deferred to Phase 2

### Decision

MVP does as much privacy as possible using protocol accounts, encrypted values, ACLs, and minimized public metadata, but does not attempt full sender anonymity.

### Rationale

fhEVM hides values, not transaction graph metadata. Strong identity privacy likely requires relayers, account abstraction, stealth addresses, or credential systems.

### Consequences

- MVP should be explicit that public transaction timing and caller addresses may leak metadata.
- Phase 2 should include private identity design.
