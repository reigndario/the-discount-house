# Phase 1 Respec Plan

This plan incorporates the v0.5 identity/privacy and preference-builder respec.

## Direction Change

Phase 1 no longer treats `ProtocolAccountId` as the primary participant abstraction. The protocol should optimize for
Zama fhEVM, ERC-7984, and TokenOps compatibility first, while preserving future extension points for stronger identity
privacy.

Phase 1 provides confidential economic terms and confidential settlement checks. It does not claim anonymous
counterparties or transaction-layer privacy.

## Phase 1 Identity Model

- Use native EVM addresses where ERC-7984 or TokenOps require them.
- Use encrypted address/state handles only where supported and useful.
- Avoid building the lifecycle around visible caller identity.
- Do not require visible borrower/lender EOAs to call operational functions when a signed capability, token permission,
  escrow state, or ACL proof can authorize the action instead.
- Keep relayer, account abstraction, stealth wallet, and privacy-router compatibility open.

`ProtocolAccountRegistry` remains useful research/reference code, but it is deferred from the Phase 1 core path unless a
specific integration blocker makes it necessary.

## Public Versus Private Data

Public / coarse:

- preference object existence
- side
- collateral token address
- TokenOps manager address when relevant
- coarse principal bucket as raw fixed ASCII in `bytes32`
- coarse duration bucket as raw fixed ASCII in `bytes32`
- expiry / status
- match attempt timing
- match success or failure
- default occurrence if state transition succeeds

Confidential where feasible:

- exact principal
- exact interest rate
- exact duration
- grace period
- bundle ranges
- preference direction and importance
- candidate evaluation results
- selected final terms until revealed to parties
- vesting amount
- cUSDC amounts and repayment sufficiency

Explicit Phase 1 limitations:

- transaction sender is public
- function timing is public
- TokenOps recipient/counterparty identity and `vestingId` are expected to be public in collateral operations because
  TokenOps functions and events expose `bytes32 vestingId`
- stored identity is best-effort encrypted only where supported

Immediate confidential preference decisions to resolve before testnet:

1. Which fields are public coarse coordination metadata versus private exact matching data? Decision: public metadata is
   limited to side, collateral token address, TokenOps manager address when relevant, raw fixed-ASCII principal bucket,
   raw fixed-ASCII duration bucket, expiry, and status. There is no separate asset bucket. Exact collateral amount,
   implied token price, interest rate, grace period, direction, priority, and exact bundle ordering remain private
   matching data.
2. Should exact preference ranges be stored as fhEVM encrypted handles, off-chain encrypted payloads, or a hybrid?
   Decision: exact preference values should be represented as fhEVM encrypted handles on-chain. The added complexity is
   acceptable. Browser-local storage is the recovery/editing path for rich UI state that is not part of canonical
   matching. Bundle labels are browser-side only.
3. Should direction and priority be public, encrypted, or only included in an encrypted payload? Decision: direction and
   priority should be encrypted if possible.
4. `participantCommitment` is not essential to the current matching or lifecycle path and should be removed unless a
   concrete authorization/privacy need emerges.
5. TokenOps collateral operations use `address tokenOpsManager` plus `bytes32 vestingId`; do not add a speculative
   vesting-position commitment. Keep `vestingId` out of the preference bundle if possible, but treat it as public once
   the collateral pledge/transfer path touches TokenOps.
6. Should Phase 1 prove private exact matching on-chain, or public coarse matching plus confidential settlement checks?
   Decision: Phase 1 should target private exact matching on-chain. Public buckets are only candidate-discovery/routing
   metadata; the matching engine should evaluate exact encrypted preference ranges, encrypted direction, and encrypted
   priority where fhEVM supports it.
7. Which final loan terms are revealed publicly, and which remain visible only to authorized parties/contracts?
   Decision: final negotiated economic terms should remain private as much as feasible. Public data should be limited to
   operational status, object IDs, commitments/hashes, and timestamps needed for lifecycle calls. Principal, collateral
   amount, implied token price, interest rate, repayment amount/sufficiency, and preference-derived scoring should
   remain encrypted where supported.
8. How does the UI recover and edit encrypted bundles after submission? Decision: Phase 1 uses browser-local storage
   only for UI recovery/editing of rich bundle state. There is no on-chain encrypted payload fallback and no off-chain
   recovery service in this phase.
9. Should bundle ordering/rank be public? Decision: remove public rank from the canonical on-chain bundle unless a
   concrete protocol execution requirement reappears. UI ordering remains browser-local. If matching needs ordering or
   fallback weight, represent it as encrypted matching data rather than a public rank label.
10. How should authorization work with encrypted preferences and relayer-compatible lifecycle calls? Decision:
    authorization should remain minimal and contract-centered. The submitting manager controls preference cancellation
    and supersession; protocol contracts receive ACL access to compute and settle encrypted handles; lifecycle
    operations remain relayer-callable where state proofs, token permissions, adapter custody, or authorization hashes
    prove validity. Execution assurance is a separate gate: preferences may be submitted before backing is ready, but
    matching should only use executable active bundles. Borrower executable readiness requires TokenOps collateral
    pledge/control verification; lender executable readiness requires confidential credit escrow or authorization
    verification. This prevents unbacked offers from becoming matchable without tying operational calls to visible
    borrower/lender EOAs.
11. How should candidate discovery work? Decision: maintain an on-chain public bucket index of active/executable
    preference IDs keyed by the approved coarse metadata. This intentionally exposes market structure, depth, and bucket
    liquidity while exact preferences and economic terms remain encrypted. Treat that aggregate market visibility as a
    product feature, not a privacy failure.
12. How should failed matching/probing be controlled? Decision: remove free `previewMatch` entirely from the
    production/testnet path. Matching should be bonded or, preferably, gated by full execution readiness. Because a bond
    is only a partial capital commitment, require full prerequisite commitment where feasible: borrower collateral
    pledged/controlled and lender confidential credit escrowed or irrevocably authorized before exact matching returns
    any answer other than inadequate escrow/readiness. Successful matching should atomically create or irreversibly bind
    the loan commitment where possible; failed exact matching must reveal no field-level reason. If gas cost is too low
    to discourage probing, add an extra taker cost for match execution. Local implementation now finalizes encrypted
    infeasible matches as failed from the aggregate feasibility proof, unlocks the candidate preferences, and lets
    `MatchSettlementCoordinator` slash the taker bond without publishing field-level mismatch reasons.
13. How should executable readiness be backed? Decision: use reusable collateral/credit commitments rather than
    per-bundle duplicated escrow. A borrower can pledge one TokenOps collateral position or collateral vault that backs
    multiple alternative encrypted preference bundles; a lender can escrow or irrevocably authorize confidential credit
    once and reference that backing from multiple alternatives. The protocol must reserve/consume backing on successful
    match to prevent double commitment.
14. What happens to alternative bundles sharing one backing commitment after a match? Decision: consume/cancel all
    sibling bundles sharing the matched backing commitment in Phase 1. This applies to borrower collateral and lender
    credit for the first testnet design. The credit adapter can preserve an encrypted lender-credit remainder after a
    partial draw, but republishing/reusing that remainder across sibling bundles remains a later flow.
15. Who chooses the candidate set for matching? Decision: use caller-supplied candidate IDs for bounded gas, but require
    every supplied candidate to be an active executable member of the matching public bucket index, opposite side, and
    otherwise compatible with the taker metadata. This preserves flexibility without allowing candidates outside the
    indexed market surface.
16. How should the matcher choose among multiple compatible candidates without leaking scores? Decision: for Phase 1,
    use private exact feasibility, then choose among compatible candidates by a deterministic public tie-break that does
    not depend on caller-supplied order. Do not expose utility, scoring, or field-level match quality. Encrypted scoring
    can be added later if tractable.
17. How should lender credit commitments fund smaller loans? Decision: support a partial-draw model in
    `ERC7984CreditAdapter`. A lender commitment greater than the selected loan principal should be sufficient; the
    adapter must privately check committed confidential credit is at least the expected draw, release only the drawn
    amount to the borrower, and preserve/refund the encrypted remainder to the lender or reusable commitment accounting.
    Implemented locally: commitment-backed funding now uses encrypted sufficiency (`committed >= draw`) and stores an
    encrypted remainder handle for the commitment after consumption.
18. Which public tie-break should be used among compatible candidates? Decision: choose the oldest executable candidate,
    using a monotonic `executableSequence` assigned when backing becomes executable, not when an unbacked preference is
    merely created. Break any remaining ties by lowest `preferenceId`.
19. How should final terms be selected once two encrypted bundles are compatible? Decision: target an encrypted
    finite-candidate Nash/welfare selection rather than taker-proposed terms. For each field, evaluate a bounded set of
    candidate values such as overlap min, overlap max, overlap midpoint, borrower target clamped to overlap, and lender
    target clamped to overlap. Compute encrypted borrower and lender utility from encrypted ranges, direction, and
    priority; select the term package that maximizes encrypted Nash-style joint utility where fhEVM supports the needed
    comparisons. Do not expose intermediate utility, field scores, or rejected candidates. If implementation constraints
    require simplification, degrade to a documented deterministic rule rather than a caller-chosen proposal.
20. How should optimizer implementation risk be managed? Decision: keep matching modular. Separate executable-state
    checks, encrypted feasibility, term selection, winner selection, and loan commitment so the finite-candidate
    optimizer can be improved or replaced without rewriting the protocol path.
21. What implementation order has the best delivery odds? Decision: implement in dependency order: first canonical
    public/encrypted preference data model and bucket index; second reusable backing commitments and executable gating;
    third execute-only matching without free previews; fourth encrypted feasibility and modular term selection; fifth
    escrow/private-term rewiring; sixth browser wiring and regression tests. The contract path through reusable backing,
    matching, escrow creation, confidential funding release, and repayment release is implemented and locally tested.

## Contract Plan Updates

Near-term contract work should prioritize:

1. `ConfidentialPreferenceBook` refactor from protocol-account ownership to direct participant/capability-compatible
   creation.
2. Backing evidence and executable gating. Borrower backing now requires registered TokenOps evidence and verifies that
   the configured TokenOps vesting manager reports the vesting schedule recipient as the vesting adapter before the
   backing can become executable. Lender backing now requires an explicit registered credit commitment with adapter,
   commitment hash, and expiry, and the Preference Book asks the adapter to confirm that the commitment is executable
   for the lender manager before activation. The ERC-7984 adapter now makes that commitment executable only after it
   receives confidential token custody for the commitment hash; Sepolia validation passed.
3. `NashNegotiationEngine` execute-only candidate selection is implemented. Match execution now creates a pending
   attempt and locks the taker/maker preferences. Selected terms are computed in six staged transactions to stay inside
   fhEVM per-transaction HCU limits. For each field, the engine evaluates the overlap midpoint plus each side's clamped
   encrypted target and selects the value with the lowest encrypted priority-weighted distance to the parties' encrypted
   preferred values. `commitEncryptedTerms` then recomputes only the aggregate encrypted feasibility bit, stores
   `encryptedTermsHash`, and requires `finalizeMatchFeasibility` to verify the KMS public-decryption proof for that
   aggregate bit before settlement. Exact terms, priorities, directions, and field-level feasibility remain private.
   Infeasible finalized attempts become failed attempts and can be settled through bond slashing. Successful encrypted
   match execution, staged term computation, aggregate feasibility public decryption, and finalization are validated on
   Sepolia.
4. `MatchSettlementCoordinator` connecting successful/failed match results to bond settlement and loan escrow creation.
   Initial implementation is complete. Successful settlement now binds the clear escrow config to both the public match
   `termsHash` and encrypted selected-term commitment, and rejects borrower/lender addresses that do not match the
   matched Preference Bundle managers. Successful settlement into a matched Sepolia loan escrow is validated; the failed
   settlement path remains local-test covered.
5. `LoanEscrowFactory` and `LoanEscrow` with publicly callable lifecycle functions. Initial adapter-backed
   implementation is complete; escrows store the encrypted selected-term commitment, the public terms hash, and opaque
   funding/repayment authorization commitments rather than public principal or total-due amounts. The ERC-7984 adapter
   now proof-gates credit consumption on public decryption of the encrypted callback acceptance bit, and the correct-
   amount callback/finalization path has been validated on Sepolia against canonical `cUSDCMock`. Wrong-amount callback
   rejection and adapter retry behavior are also validated. Full escrow funding/repayment wiring now releases borrower
   and lender confidential cUSDC on Sepolia. Public unwrap/finalize is validated for the current `cUSDCMock` wrapper;
   balance-level refund accounting after callback failure remains a follow-up.
6. `PaymentAuth` / capability structs for repayment, activation, and cancellation flows. Replay-protected authorization
   structs, escrow-owned adapter authorization registration, and adapter credit consumption are implemented in
   `LoanEscrow`; deployed-token permission and ciphertext ACL checks remain.
7. TokenOps and ERC-7984 integration tests on Sepolia. `ERC7984CreditAdapter` now binds callback handles to escrow
   authorizations, uses exact encrypted amount equality for one-off transfers, uses encrypted sufficiency plus encrypted
   remainder accounting for reusable lender commitments, and requires a verified public-decryption proof before
   consumption. The live correct-amount and wrong-amount `cUSDCMock` adapter paths are validated. LoanEscrow
   funding/repayment, reusable lender commitment custody, real TokenOps custody/release, TokenOps unpledged recovery,
   successful matched escrow lifecycle, failed-match bond slashing, and `cUSDCMock` public unwrap/finalize are also
   validated. Balance-level refund accounting after a wrong-amount callback remains a follow-up.

Avoid:

- `require(msg.sender == borrower)` for payment/default/finalization paths.
- public UI or event surfaces that expose raw wallet identity unless that address is necessarily public due to the
  underlying token or vesting primitive.
- marketing claims of anonymous borrowing or lending.

## UI Plan Updates

The UI should model a Confidential Preference Book, not application accounts.

Immediate UI direction:

- A global Borrower/Lender toggle controls the user perspective across pages.
- `Book` is the public discovery surface for coarse opposite-side buckets.
- `Builder` creates browser-local ordered Preference Bundles and submits encrypted active-bundle data.
- `Loans` is the role-aware execution surface for live match attempts and escrow lifecycle actions. The equivalent
  Sepolia smoke paths validate relayer finality, TokenOps custody semantics, ERC-7984 confidential credit callbacks,
  successful settlement, and failed-match bond slashing; the browser path still needs manual wallet validation.
- Each bundle has hard constraints, directional preferences, implied collateral exchange-rate display, and the five-axis
  priority polygon.
- Save action is framed as encrypted preference submission.
- TypeScript SDK helpers cover local bundle construction and coarse bucket derivation; the browser UI must not expose
  local match previews or field-level diagnostics as production behavior.

The UI may use local labels for browser-local data, but should not show wallet addresses or imply the app collects a
user directory.
