# SCAFFOLDING.md
> Generated: 2026-08-25
> Project: The Discount House (confidential-vesting-credit)
> Stack: Solidity 0.8.27 / Hardhat / Zama fhEVM / OpenZeppelin Confidential Contracts / ERC-7984 / TokenOps SDK / TypeScript / vanilla JS browser UI
> Current state: Core protocol contracts, TypeScript SDK, and browser UI are implemented and pass local mock-runtime tests; most encrypted-path flows are already validated on Sepolia. Remaining work is manual UI/wallet validation, durable indexing, hardening, and release infrastructure — not new protocol design.

---

## Project Summary

The Discount House is a confidential vesting-backed credit protocol: borrowers and lenders publish encrypted
ranked preferences plus coarse public discovery metadata to `ConfidentialPreferenceBook`, a taker posts a bond
and attempts bounded matching via `NashNegotiationEngine`, and successful matches settle into bilateral
`LoanEscrow` custody backed by TokenOps vesting collateral and ERC-7984 confidential credit. The core contract
suite, SDK, and browser UI already exist and are exercised by a Hardhat mock-runtime test suite plus a battery of
Sepolia smoke scripts covering nearly every economically meaningful path (match execution, settlement, bond
slashing, TokenOps custody, ERC-7984 funding/repayment/unwrap). What remains is closing the gap between
"contract paths proven via scripts" and "a person can do this in the browser with a wallet," plus the
production-hardening items the README already calls out as outstanding.

**Inferred intent:** Reach a state where the full borrower/lender loan lifecycle can be manually exercised
end-to-end through the browser UI on Sepolia, with the remaining security/dependency/CI gaps closed before any
public demo or wider testnet exposure.
**Confidence:** High — the README's own "Current State" / "Next" sections, `docs/PRE_TESTNET_RUNBOOK.md`, and
`docs/INTEGRATION_RISKS.md` are explicit and consistent about what's done and what's outstanding.

---

## What Already Exists

| Area | Status | Notes |
|---|---|---|
| Core protocol contracts | ✅ Done | `ConfidentialPreferenceBook`, `NashNegotiationEngine`, `MatchSettlementCoordinator`, `BondManager`, `LoanEscrowFactory`/`LoanEscrow`, `TokenOpsVestingAdapter`, `ERC7984CreditAdapter` all implemented and tested |
| `ProtocolAccountRegistry` | 🔧 Partial | Contract exists but explicitly deferred/reference-only, not wired into the v0.5 participant model |
| Hardhat mock-runtime test suite | ✅ Done | One test file per core contract plus SDK surface tests in `test/` |
| Sepolia smoke scripts | ✅ Done | 9 scripts in `scripts/sepolia-*` covering credit, commitment, unwrap, wrong-amount, collateral, escrow, match settlement, failed match, preferences |
| TypeScript protocol SDK | ✅ Done | `src/protocolSdk.ts`, built to `dist/`, exported as `./protocol-sdk` |
| Browser UI | 🔧 Partial | Book/Builder/Loans/System pages implemented in `public/`; encrypted submission and role-aware match/escrow flows exist but are not yet manually validated end-to-end with a real wallet |
| Local deployment tooling | ✅ Done | `deploy:hardhat`/`deploy:localhost`/`deploy:sepolia`, tagged `Core`/`Demo`, manifest writer |
| Sepolia deployment | ✅ Done | Full core stack deployed and addressed in `docs/PRE_TESTNET_RUNBOOK.md`, post-rotation wallet |
| Durable indexing | ❌ Missing | UI currently relies on a lookback event cache, not durable indexing |
| CI/CD | ❌ Missing | No `.github/workflows`; lint/test/coverage only run locally |
| Dependency audit | 🔧 Partial | `npm audit --omit=dev` clean; dev-dependency audit still has unresolved transitive findings through Hardhat tooling |
| Security/deployment hardening pass | ❌ Missing | README lists this as an explicit outstanding item |

---

## Phase 1: Manual Browser-Wallet Validation

**Goal:** Every contract-validated Sepolia flow (preference submission, match attempt, TokenOps collateral setup,
ERC-7984 funding/repayment) has been manually exercised through the actual browser UI with a connected wallet,
not just via scripts.
**Depends on:** Nothing — the contracts and UI code already exist; this is a testing/validation pass.
**Estimated scope:** Medium

### Checklist

- [ ] Serve `public/` locally (`python3 -m http.server 8080 --bind 0.0.0.0 --directory public`) against the live Sepolia manifest and connect a real wallet
- [ ] Walk the `Builder` page: construct a borrower preference bundle, encrypt via the relayer SDK, and submit to `ConfidentialPreferenceBook.createPreferenceBundle`
- [ ] Repeat the `Builder` walkthrough for a lender-side bundle
- [ ] Walk the `Book` page and confirm coarse bucket discovery reflects the two submitted bundles
- [ ] Walk the `Loans` page: attempt a role-aware match against the opposite-side bucket and confirm the UI drives `NashNegotiationEngine`/`MatchSettlementCoordinator` correctly
- [ ] Validate the real TokenOps collateral setup path in-browser (not `MockTokenOpsVestingManager`) against a live CTTT vesting manager
- [ ] Validate real ERC-7984 funding and repayment release through the `Loans` page against `ERC7984CreditAdapter`
- [ ] Record any UX or wiring bugs found during manual validation as follow-up items in `docs/UI_LOAN_FLOW_WALKTHROUGH.md`

> **External setup:** Requires a Sepolia wallet funded per the budget in `docs/PRE_TESTNET_RUNBOOK.md` (~0.15–0.25 ETH) and a TokenOps CTTT vesting position to pledge as collateral.

---

## Phase 2: Durable Indexing

**Goal:** The UI's public bucket/backing/match/loan discovery no longer depends on the browser's own event
lookback cache and survives a fresh page load or a longer history window without re-scanning from genesis.
**Depends on:** Nothing blocking — can start in parallel with Phase 1, but validate against real data from Phase 1.
**Estimated scope:** Medium

### Checklist

- [ ] Decide the indexing approach (subgraph, a small self-hosted indexer service, or a hosted log-indexing API) and record the decision
- [ ] Define the event set to index: `ConfidentialPreferenceBook` bucket/backing events, `NashNegotiationEngine` match attempts, `MatchSettlementCoordinator` settlement outcomes, `LoanEscrow` lifecycle events
- [ ] Implement the indexer/subgraph against the deployed Sepolia contract addresses in `docs/PRE_TESTNET_RUNBOOK.md`
- [ ] Replace the browser lookback cache in `public/app.js` with reads against the durable index, keeping the lookback cache as a fallback if the index is unreachable
- [ ] Confirm the `System` page surfaces indexer health/status alongside manifest/wallet/contract status

> **Decision required:** Choice of indexing backend (subgraph vs. custom service) affects hosting cost and ops burden — resolve before implementation starts.

---

## Phase 3: Security, Dependency, and Deployment Hardening

**Goal:** The launch blockers named in the README ("dependency tree... npm audit findings... tracked as launch
blockers") and in `docs/INTEGRATION_RISKS.md` are resolved, upgraded, or explicitly risk-accepted, and the
project has a real CI pipeline gating merges.
**Depends on:** Nothing — independent of Phases 1–2.
**Estimated scope:** Medium

### Checklist

- [ ] Run a full dev-dependency audit (`npm audit`) and triage each remaining transitive finding through Hardhat/hardhat-deploy/solidity-coverage tooling: upgrade, override, or explicitly risk-accept with a written note
- [ ] Add a GitHub Actions workflow (`.github/workflows/ci.yml`) that runs `npm ci`, `npm run compile`, `npm run lint`, and `npm test` on every PR
- [ ] Add a second CI job (or step) running `npm run coverage` and publishing/checking the report
- [ ] Validate the two outstanding Sepolia-only items from `docs/INTEGRATION_RISKS.md`: balance-level refund accounting after a wrong-amount ERC-7984 callback, and deployed-token refund/rejection behavior after a callback failure
- [ ] Confirm production behavior if a future confidential USD token does not implement `IERC7984ERC20Wrapper` (per `docs/PRE_TESTNET_RUNBOOK.md` open item) — add an explicit revert/guard if not already present
- [ ] Decide the disposition of `ProtocolAccountRegistry`: integrate into the v0.5 participant model, keep as reference-only with a doc note, or remove

> **External setup:** CI workflow will need Sepolia RPC/Etherscan secrets configured as GitHub Actions secrets only if Sepolia smoke tests are added to CI — recommend keeping Sepolia smokes as a manual/local-only step for now given wallet-funding cost.

---

## Open Questions

These decisions affect the build plan and should be resolved before or during the relevant phase:

1. **Indexing backend choice (Phase 2)** — subgraph vs. self-hosted indexer vs. hosted API. Affects hosting cost, latency, and whether the team wants to run infrastructure.
2. **`ProtocolAccountRegistry` disposition (Phase 3)** — currently implemented but deliberately excluded from the v0.5 Phase 1 participant model; leaving it in the tree unintegrated is itself a small maintenance/audit-surface cost.
3. **Whether Sepolia smoke scripts belong in CI** — they cost real (if small) Sepolia ETH per run and depend on external RPC/Etherscan availability; running them only locally/manually may be preferable to flaky or costly CI runs.

---

## Out of Scope (this cycle)

- **Mainnet or non-Sepolia public deployment** — README and runbook are explicit that Sepolia is the first and only current public target; mainnet readiness is a distinct future cycle.
- **New protocol features beyond the current contract set** — no evidence in docs or code of planned functionality beyond what's implemented; this scaffold is about hardening and validating what exists, not expanding scope.
- **`ProtocolAccountRegistry` integration work** — flagged as an open question above rather than scheduled, since the decision to integrate vs. remove hasn't been made yet.
