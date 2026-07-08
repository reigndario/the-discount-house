# Confidential Vesting Credit Architecture

This repository implements a production-grade confidential vesting-backed credit protocol targeted first at local and
Sepolia testnet deployment. Testnet deployment is a safety and regulatory constraint, not a reduction in software
quality.

## Core Components

- `ConfidentialPreferenceBook`: Preference Bundle storage with narrow public discovery metadata and encrypted exact
  preferences. Public metadata is limited to side, collateral token address, TokenOps manager address, ASCII principal
  ceiling bucket, ASCII duration ceiling bucket, expiry/status, and backing IDs needed for execution readiness. Bucket
  labels are opaque fixed ASCII bytes32 values such as `P<000150` and `D<000720`; the contracts use them for coarse
  routing only and do not parse exact min-max terms. Exact ranges, targets, direction, and priority are fhEVM handles.
  Lender executable readiness is checked through the configured credit
  adapter's commitment verifier rather than a book-local hash alone.
- `BondManager`: economic defense against preference probing.
- `NashNegotiationEngine`: execute-only matching over executable Preference Bundles. It accepts caller-supplied
  candidate IDs for gas bounds, verifies opposite-side/same-market/executable status, chooses the oldest executable
  compatible candidate, and locks the two candidate preferences. Selected encrypted term handles are then computed
  field-by-field to stay inside fhEVM HCU limits. Once all six fields are computed, `commitEncryptedTerms` recomputes
  only the aggregate encrypted feasibility bit, commits the pending match by `termsHash` and `encryptedTermsHash`, and
  requests public decryption of that aggregate bit. Free preview is intentionally absent. Finalization verifies a KMS
  public-decryption proof for the aggregate feasibility bit only; if feasible, the engine marks the attempt succeeded
  and consumes sibling bundles sharing the matched backing. If infeasible, the engine marks the attempt failed and
  unlocks the preferences without exposing field-level reasons.
- `MatchSettlementCoordinator`: public/relayer-callable bridge from executed match attempts to bond refund/slash and
  escrow creation. Successful settlement verifies both the public `termsHash` and encrypted selected-term commitment,
  checks escrow borrower/lender addresses against the managers of the matched borrower/lender Preference Bundles, and
  verifies that the escrow config uses the matched TokenOps backing evidence and lender credit commitment.
- `LoanEscrowFactory` and `LoanEscrow`: bilateral vesting/cUSDC escrow, activation, repayment, and default enforcement.
  Each escrow stores `termsHash`, `encryptedTermsHash`, and opaque one-time funding/repayment authorization commitments
  rather than public principal or total-due amounts. Funding and repayment are credited through
  `IConfidentialCreditAdapter`; the local mock discloses test amounts in placeholder adapter calls, while production
  wiring should consume ERC-7984 confidential transfer handles and ACL permissions.
- `ERC7984CreditAdapter`: receives ERC-7984 transfer callbacks through the OpenZeppelin receiver interface, binds
  encrypted amount handles to replay-protected escrow authorizations, and returns an encrypted equality check against
  the expected protocol amount. It also supports reusable lender credit commitments backed by adapter-held confidential
  token transfers. When a loan activates, funding is released to the borrower; when it is repaid, repayment is released
  to the lender. Sepolia validates confidential cUSDC release to the borrower/lender, and the current `cUSDCMock`
  wrapper also validates public unwrap/finalize into underlying `USDCMock`.
- `TokenOpsVestingAdapter`: integration boundary for TokenOps confidential vesting manager semantics. Sepolia validation
  confirmed the pending-transfer custody path, final release path, unpledged-custody recovery path, and compatibility
  with real TokenOps vesting ID `bytes32(0)`. Recovery initiates return to the original borrower and clears adapter
  custody after borrower acceptance.

Deferred/reference:

- `ProtocolAccountRegistry`: durable protocol accounts controlled by one or more wallets. The v0.5 Phase 1 path does not
  use protocol account IDs as the primary participant abstraction.

## Privacy Model

The protocol uses Zama fhEVM handles and ACLs for sensitive values. Preference ranges, targets, direction, priority,
selected terms, encrypted feasibility, repayment state, and operational amounts should remain confidential wherever the
fhEVM stack supports it. The aggregate feasibility bit is publicly decrypted only at match finalization so settlement
can be enforced. Public metadata remains limited to role side, asset/manager addresses, principal and duration buckets,
expiry/status, backing readiness, state transitions, commitments where needed, aggregate match success/failure, and
unavoidable transaction timing.

## Implementation Standard

Local development uses the official Zama Hardhat template and mock FHE runtime for fast deterministic tests. Contract
code must still be written against real fhEVM and OpenZeppelin Confidential Contracts types. Sepolia is the first real
encrypted network target.

Known integration risks are tracked in `docs/INTEGRATION_RISKS.md`.
