# Security and Threat Model

## 1. Security goals

- Prevent public disclosure of principal, interest rate, duration, grace period, vesting amount, cUSDC amounts, ranked constraints, and repayment amounts.
- Prevent activation unless both sides escrow sufficient assets.
- Prevent double-pledging of vesting positions.
- Prevent free probing of private preferences.
- Ensure default/reassignment only occurs when protocol conditions are met.
- Minimize trusted off-chain assumptions where possible.

## 2. Non-goals for MVP

- Full transaction graph anonymity.
- Full due-date timing obfuscation.
- Preventing all inference from successful default/reassignment events.
- Eliminating Zama gateway/KMS trust assumptions.
- Regulatory eligibility verification.

## 3. Trust assumptions

### Zama fhEVM / gateway

The protocol assumes the fhEVM and gateway/KMS infrastructure correctly enforce encryption, ACLs, decryption permissions, and encrypted computation semantics. Gateway/key-management trust remains part of the system.

### TokenOps vesting

The protocol assumes TokenOps contracts correctly implement vesting, transfer, claim, ACL, and disclosure semantics. Integration testing must verify transfer-to-escrow and reassignment flows.

### ERC-7984 confidential token

The protocol assumes ERC-7984 token contracts correctly preserve confidential balances/transfers and enforce operator approvals.

## 4. Threats and mitigations

### Repeated probing attack

Attack: A taker repeatedly attempts matches to infer private terms from success/failure.

Mitigations:

- Match-attempt bond.
- Slashing on failed attempts.
- Split slashed bond between counterparties and treasury.
- Minimum candidate-set size where available.
- Higher bonds in thin markets.
- Cooldowns after failed attempts.
- No failure reason disclosure.

### Single-counterparty probing

Attack: Taker probes one counterparty at a time to isolate their private constraints.

Mitigations:

- Target minimum batch size.
- Thin markets require all available counterparties in the bucket.
- Higher bond for smaller batches.
- Batch-level success/failure only where possible.

### Double-pledging collateral

Attack: Borrower uses the same vesting position for multiple loans.

Mitigations:

- LoanEscrow must control/custody the vesting position before activation.
- Vesting adapter maintains pledged status.
- Activation fails if position already pledged.

### Underfunded lender

Attack: Lender negotiates but does not fund.

Mitigations:

- Loan not active until lender cUSDC escrow sufficiency check passes.
- Funding deadline.
- Failed activation allows borrower unwind.
- Optional future non-performance penalties.

### Under-collateralized borrower

Attack: Borrower negotiates but lacks sufficient vesting amount.

Mitigations:

- Loan not active until vesting escrow and encrypted sufficiency check pass.
- Borrower must transfer/control vesting position before activation.
- No principal release until `canActivate = true`.

### Default griefing

Attack: Anyone repeatedly calls `checkDefault` to harass or infer timing.

Mitigations:

- No sensitive failure reason.
- Optional cooldown for false default checks.
- Optional small call fee or bond if griefing becomes material.
- Successful default remains publicly visible by design.

### Event leakage

Attack: Observers infer private terms from event data.

Mitigations:

- Do not emit exact amounts, terms, dates, ranks, or reasons.
- Use coarse bucket IDs only.
- Emit generic state transitions.

### Identity linkage

Attack: Observers link borrower/lender identities through caller addresses and timing.

Mitigations:

- Protocol accounts separate user identity from wallet addresses.
- Minimize public metadata.
- Defer relayers, stealth addresses, and anonymous credentials to Phase 2.

### Malicious frontend

Attack: Frontend misrepresents encrypted terms or transaction effects.

Mitigations:

- Provide transaction preview/decode.
- Use typed SDK wrappers.
- Encourage independent clients.
- Strong tests and reference UI.

### Reentrancy / callback issues

Attack: Token or vesting transfer hooks create reentrancy or state inconsistency.

Mitigations:

- Use checks-effects-interactions.
- Reentrancy guards.
- State transition locks.
- Explicit integration tests with TokenOps and ERC-7984 contracts.

## 5. Invariants

- A loan cannot be ACTIVE unless borrower and lender escrows are sufficient.
- A vesting position cannot back more than one ACTIVE loan.
- Principal cannot be released before activation.
- Default reassignment cannot happen unless default predicate resolves true.
- Repaid loans cannot default.
- Defaulted loans cannot return collateral to borrower.
- Failed match attempts reveal no reason.
- Slashed failed-attempt bond is split according to protocol config.

## 6. Audit focus areas

- fhEVM ACL and decryption flows.
- TokenOps transfer/reassignment semantics.
- ERC-7984 operator approvals and confidential transfer flows.
- Negotiation tie-breakers.
- Bond/slashing accounting.
- Loan activation race conditions.
- Default check timing and replay protections.
