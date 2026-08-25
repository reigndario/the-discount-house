# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

The Discount House ("confidential-vesting-credit") is an unaudited, experimental confidential vesting-backed
credit protocol built on Zama fhEVM, OpenZeppelin Confidential Contracts, ERC-7984 confidential tokens, and
TokenOps confidential vesting integration. Borrowers and lenders publish encrypted ranked preferences plus
coarse public discovery metadata; a taker posts a bond and attempts bounded matching against the opposite side
of the book, and successful matches proceed into bilateral escrow before activation.

Target networks are local Hardhat (mock fhEVM runtime) and Sepolia testnet (real fhEVM). Any feature relying on
ACLs, encrypted comparison, relayer behavior, or gateway decryption must be validated on Sepolia before it is
considered done — local mock-runtime tests passing is not sufficient proof.

## Commands

```
npm ci                      # install
npm run compile              # compile contracts (also runs on test/coverage)
npm test                     # run Hardhat test suite (mock fhEVM runtime)
npm run test:sepolia         # run test suite against Sepolia
npx hardhat test test/LoanEscrow.ts   # run a single test file
npm run lint                 # solhint + eslint + prettier check
npm run lint:sol             # solhint only
npm run lint:ts              # eslint only
npm run prettier:write       # auto-format
npm run coverage             # solidity-coverage
npm run demo:local           # scripted end-to-end protocol run against local Hardhat network
npm run test:ui              # scripts/ui-smoke.mjs browser UI smoke test
```

Local deployment:

```
npm run deploy:hardhat        # in-process Hardhat network, all contracts
npm run chain                 # terminal 1: long-running local node
npm run deploy:localhost      # terminal 2: deploy to that node
npm run manifest:localhost    # writes public/deployment-manifest.json for UI/SDK wiring
```

`deploy:*` and `manifest:*` scripts each have `hardhat`, `localhost`, and `sepolia` variants, and `deploy:core:*`
/ `deploy:demo:*` variants scoped by hardhat-deploy tags (`Core`, `Demo`).

Sepolia smoke tests (`scripts/sepolia-*.ts`, run via `npm run smoke:sepolia:*`) exercise individual real-network
flows (ERC-7984 credit/commitment/unwrap/wrong-amount, TokenOps collateral, loan escrow, match settlement,
preference submission) and are the actual verification method for fhEVM-dependent behavior — prefer running the
relevant smoke script over trusting local mock test output when touching encrypted-path code.

Sepolia requires Hardhat vars (`npx hardhat vars set MNEMONIC|INFURA_API_KEY|ETHERSCAN_API_KEY`); the config
hard-fails if the default public Hardhat mnemonic is used on `--network sepolia`.

## Architecture

Contract flow, in order of a loan's lifecycle:

1. **`ConfidentialPreferenceBook`** — stores Preference Bundles. Public metadata is limited to side, collateral
   token, TokenOps manager address, ASCII principal/duration buckets, expiry/status, and backing IDs; exact
   ranges, targets, direction, and priority are fhEVM encrypted handles. Lender executable-readiness is checked
   via the configured credit adapter's commitment verifier, not a book-local hash.
2. **`BondManager`** — takers post bonds before a match attempt; economic deterrent against preference probing.
3. **`NashNegotiationEngine`** — execute-only matching over executable bundles (no free preview). Caller supplies
   candidate IDs for gas bounds; the engine verifies opposite-side/same-market/executable status, picks the
   oldest executable compatible candidate, locks both preferences, and computes selected encrypted term handles
   field-by-field (to stay under fhEVM HCU limits). `commitEncryptedTerms` then recomputes only the aggregate
   encrypted feasibility bit, commits by `termsHash`/`encryptedTermsHash`, and requests public decryption of just
   that bit. Finalization verifies the KMS public-decryption proof; success consumes sibling bundles sharing the
   matched backing, failure unlocks preferences without exposing field-level reasons.
4. **`MatchSettlementCoordinator`** — public/relayer-callable bridge from executed match attempts to bond
   refund/slash and escrow creation. Verifies both public `termsHash` and encrypted selected-term commitment,
   checks escrow borrower/lender against the matched bundles' managers, and verifies escrow config against
   matched TokenOps backing evidence and lender credit commitment.
5. **`LoanEscrowFactory` / `LoanEscrow`** — bilateral escrow, activation, repayment, default enforcement. Stores
   `termsHash`, `encryptedTermsHash`, and opaque one-time funding/repayment authorization commitments rather
   than public principal/total-due amounts. Funding and repayment flow through `IConfidentialCreditAdapter`.
6. **`ERC7984CreditAdapter`** — production credit adapter. Receives ERC-7984 transfer callbacks via the OZ
   receiver interface, binds encrypted amount handles to replay-protected escrow authorizations, returns an
   encrypted equality check against the expected amount, and supports reusable lender credit commitments backed
   by adapter-held confidential token transfers. Releases funding to borrower on activation, repayment to lender
   on repay. `contracts/mocks` has a local `MockConfidentialCreditAdapter` (discloses test amounts) used in
   non-Sepolia invariant tests.
7. **`TokenOpsVestingAdapter`** — integration boundary for TokenOps confidential vesting manager custody: pending
   transfer, final release, unpledged-custody recovery (returns to original borrower, clears adapter custody
   after acceptance), compatible with TokenOps vesting ID `bytes32(0)`.

**`ProtocolAccountRegistry`** is deferred/reference-only — not part of the current v0.5 Phase 1 participant model.

Privacy model: preference ranges/targets/direction/priority, selected terms, encrypted feasibility, repayment
state, and operational amounts stay confidential as fhEVM handles/ACLs wherever the stack supports it. The
aggregate feasibility bit is the *only* thing publicly decrypted, and only at match finalization, so settlement
can be enforced on-chain. See `docs/ARCHITECTURE.md` for the full model and `docs/INTEGRATION_RISKS.md` for
known integration risks.

Supporting layers:
- `src/protocolSdk.ts` — TypeScript SDK for bundle construction, coarse buckets, term hashes, bond quotes; built
  to `dist/` and exported as `./protocol-sdk`.
- `src/metamask-wallet.js` — bundled via `esbuild` (`npm run build:wallet`) into `public/vendor/` for browser use.
- `public/` — static browser UI (borrower/lender perspective switching, ranked preference construction, bucket
  discovery, bond quote calc, contract-aware submission). Reads `public/deployment-manifest.json` (generated,
  git-ignored; `public/deployment-manifest.example.json` is the checked-in schema) for contract wiring. Loan
  settlement controls needing mock collateral/credit are disabled rather than routed to mocks on real networks.
- `deploy/` — hardhat-deploy scripts, tagged `Core` and `Demo`.
- `contracts/demo`, `contracts/mocks`, `contracts/interfaces` — demo-only contracts, test mocks
  (`MockConfidentialCreditAdapter`, `cUSDCMock`, `USDCMock`, TokenOps manager mock), and external interfaces.

Docs worth reading before non-trivial changes: `docs/ARCHITECTURE.md`, `docs/INTEGRATION_RISKS.md`,
`docs/PRE_TESTNET_RUNBOOK.md`, `docs/LIVE_MATCH_ORCHESTRATION.md`, `docs/UI_LOAN_FLOW_WALKTHROUGH.md`.
