# TDH.md: The Discount House Roadmap

Last updated: 2026-10-23

This is the single list of what we are building and in what order. It replaces the checklists in `docs/SCAFFOLDING.md`
and the "TDH Chat Interface, ATP and PWA: Implementation Plan" doc (2026-09-23), and adds the Desk agent. Tick items
here as they land; when a phase is done, mark its status.

Status: ✅ done · 🔨 in progress · ⏳ not started

## The product in one paragraph

Borrowers pledge vesting tokens (held in TokenOps custody) and lenders commit confidential cUSDC. Both publish encrypted
preference bundles to the book; a match settles into an on-chain escrow. **Desk** is the main way people use TDH: one
agent at `/desk` that answers questions, recommends the right product (borrow, lend or ATP), explains what to do next,
and drafts bundles from plain language. **ATP** is a pooled lender fund. **Book** and **Vault** are the market and loan
pages.

## Rules every phase follows

1. **No plaintext bundle content goes to a hosted LLM that TDH runs or chooses.** Amounts, collateral, duration and rate
   targets stay in the browser until they are encrypted. The local skill (Phase 3b) is the one exception by design: it
   runs in the user's own agent, so the text goes to whatever model provider the user has chosen. The skill and its docs
   say so plainly.
2. **Nothing is submitted straight from parsed text.** The user confirms a plain-language recap of the exact object
   first, for bundles and ATP deposits and withdrawals alike.
3. **Encrypted paths are done only after a Sepolia smoke test passes.** Local mock tests are not proof.
4. **CI must stay green.** Every push to `main` runs compile, lint, tests and the site build.

## Phases at a glance

| #   | Phase                               | Status | Depends on    | Who             |
| --- | ----------------------------------- | ------ | ------------- | --------------- |
| 0   | Foundations                         | ✅     |               |                 |
| 1   | Harness validation on Sepolia       | ⏳     | 0             | You, by wallet  |
| 2   | SDK consolidation                   | ⏳     | 0             | Code            |
| 3   | Intent core                         | 🔨     | 2             | Code            |
| 3b  | Bundle interview skill (local)      | ⏳     | 3             | Code            |
| 4   | Desk: chat interface                | ⏳     | 3             | Code            |
| 5   | Desk: confirmation and submission   | ⏳     | 4             | Code + Sepolia  |
| 6   | Desk agent: questions and guidance  | ⏳     | 4             | Code            |
| 7   | Book and Vault in the site          | ⏳     | 2, indexing   | Code + Sepolia  |
| 8   | ATP                                 | ⏳     | 5             | Code + Sepolia  |
| 9   | PWA: offline shell and device tests | ⏳     | 4             | Code + phones   |
| 10  | Hardening and audit                 | ⏳     | Before launch | Code + external |

Phase 1 runs alongside everything else. Phase 3b and Phase 4 can run in parallel once Phase 3 lands, so the skill can be
demoed before the web chat is finished. Phase 6 can start as soon as the Desk chat shell exists (Phase 4) and does not
wait for Phase 5. Parts of Phase 10 can be done any time.

---

## Phase 0: Foundations ✅

What exists today.

- [x] Core contracts: `ConfidentialPreferenceBook`, `BondManager`, `NashNegotiationEngine`,
      `MatchSettlementCoordinator`, `LoanEscrowFactory`/`LoanEscrow`, `ERC7984CreditAdapter`, `TokenOpsVestingAdapter`
- [x] Hardhat mock-runtime test suite (71 tests)
- [x] Sepolia deployment and smoke scripts for credit, commitment, unwrap, wrong amount, collateral, escrow, match
      settlement, failed match and preferences
- [x] TypeScript protocol SDK (`src/protocolSdk.ts`)
- [x] `public/` dev and wallet-testing harness (Book, Builder, Loans, System pages)
- [x] `apps/site`: minimal Bauhaus homepage with the glyph index and privacy disclosure bar, Jost only, app shell with
      placeholder Book, Desk, Vault, ATP and Docs pages
- [x] CI on GitHub Actions: protocol compile, lint and tests; site lint and build
- [x] Installable site: web app manifest and house-logo icons
- [x] User FAQ (`docs/FAQ.md`)

## Phase 1: Harness validation on Sepolia ⏳

**Goal:** prove with a real wallet that the browser can do what the scripts already proved. Findings feed the Desk
build.

- [ ] Serve `public/` against the live Sepolia manifest and connect a wallet
- [ ] Submit a borrower bundle from Builder (relayer encryption, `createPreferenceBundle`)
- [ ] Submit a lender bundle from Builder
- [ ] Confirm Book discovery shows both bundles
- [ ] Run a match from Loans and confirm it drives `NashNegotiationEngine` and `MatchSettlementCoordinator`
- [ ] Set up real TokenOps collateral in the browser (not the mock manager)
- [ ] Fund and repay through Loans against `ERC7984CreditAdapter`
- [ ] Log every bug or UX problem in `docs/UI_LOAN_FLOW_WALKTHROUGH.md`

## Phase 2: SDK consolidation ⏳

**Goal:** move the logic that turns user intent into contract input out of `public/app.js` (untyped, about 6,300 lines)
into the typed, tested SDK, so Desk and the site call one implementation.

- [x] `principalBucketLabel(max)` and `durationBucketLabel(max)` with the bucket tables
- [x] `impliedCollateralPrice(principal, collateral, side)`
- [x] `toContractFields(plain)`: unit scaling (rate x100, price x1e8), priority 1-5 to 0-4, direction mapping
- [x] `defaultsForSide(side)`: default directions, priorities and grace period
- [x] `deriveBackingId(bundleId)`
- [x] `encryptBundleFields(relayer, bookAddress, account, plain)` behind a structural relayer interface, so the SDK
      gains no dependency
- [x] `canonicalBundleHash(plain)` for the confirmation gate
- [x] Make `asciiBucket` work in the browser (no `Buffer`)
- [ ] Switch `scripts/sepolia-preference-submit-smoke.ts` to `encryptBundleFields` and run it on Sepolia
- [x] Unit tests for every new function, including bucket-table edge cases

Migrating `public/app.js` itself to these helpers is optional and comes after Desk ships.

## Phase 3: Intent core 🔨

**Goal:** the brain of Desk's drafting, as pure TypeScript with no UI, in `src/intent/`, tested in mocha.

- [x] `DraftBundle`: each slot is `{ value, source: stated | default | derived | picked, span? }`
- [x] Reducer `(draft, event) -> draft` with no side effects
- [x] Parser `extract(text, context) -> SlotCandidate[]`: numbers with units, ranges, targets ("about"), bounds ("at
      most", "under"), durations, side keywords
- [x] Span verifier: reject any value that does not appear in the user's text
- [x] Dialogue policy: which slot to ask for next and which quick replies to offer
- [x] Fixture corpus of phrasings, including deliberately ambiguous ones
- [x] ATP intents: deposit and withdraw with one amount slot

Extraction runs in the browser with a deterministic parser. It asks a question instead of guessing. A small in-browser
model may be added later behind the same `extract` interface, but it can only propose values, never write them.

## Phase 3b: Bundle interview skill (local) ⏳

**Goal:** the same drafting brain, distributed as an agent skill anyone can install and run locally, alongside the
site's Desk chat, so both technical and non-technical users are served. Both channels share the Phase 3 intent core, so
the intent core must stay free of React and browser dependencies.

- [ ] `skills/bundle-interview/SKILL.md`: interview behavior, one question at a time, never guesses a value
- [ ] Small CLI wrapper around the intent core and SDK: validates a draft and emits the canonical bundle JSON and its
      `canonicalBundleHash`
- [ ] The skill never holds keys and never signs, encrypts or submits; it only produces the bundle JSON
- [ ] Hosted path (default): the user imports the bundle JSON into the site's review step (Phase 5)
- [ ] Local signing page (optional): the same review and signing page packaged to run on localhost. The skill downloads
      it from a tagged GitHub release (never `main`) and verifies a pinned checksum before launching it
- [ ] The review and wallet-approval gate lives in the page, never in the LLM; the page recomputes the hash and requires
      a confirmation the agent cannot give
- [ ] Install and usage docs, including the note that text goes to the user's own model provider
- [ ] Reuses the Phase 6 knowledge base for questions about the products
- [ ] Demo: test the finished skill end to end, from interview to a signed bundle

## Phase 4: Desk, chat interface ⏳

**Goal:** `/desk` becomes a working chat that drafts bundles locally. Desk is one agent with two capabilities: drafting
(this phase) and guidance (Phase 6).

- [ ] Ledger-style transcript: no bubbles or avatars; user turns in Jost 500, Desk turns in Jost 300, 1px rules
- [ ] Sharp-cornered input and buttons, no shadows
- [ ] Entry chips from the homepage glyphs (Borrow, Lend, ATP, Docs); `?side=` from the homepage pre-fills the side
- [ ] Diagram panel: one row per field, ranges as bars with a target tick, empty / stated / default states, priority as
      five squares, "public" or "encrypted" label on every row
- [ ] Collateral picker from the wallet's on-chain positions (custodied vesting or escrowed cUSDC)
- [ ] Wallet connector (viem) and `@zama-fhe/relayer-sdk` browser build in `apps/site`; check COOP/COEP headers
- [ ] Content Security Policy limiting outgoing connections to the RPC and the relayer
- [ ] Desk route drops the colored sidebar accents so the monochrome rule holds
- [ ] Transcript and draft live in memory only; nothing written to `localStorage`
- [ ] No analytics or session replay on Desk or ATP routes
- [ ] Playwright test against local Hardhat

## Phase 5: Desk, confirmation and submission ⏳

**Goal:** nothing is encrypted, signed or submitted until the user confirms a recap bound to a hash of the exact object.

- [ ] States: drafting, review, confirmed, encrypting, signing, submitted; any edit returns to review
- [ ] Recap built from the canonical object passed to `encryptBundleFields`, never from chat text
- [ ] Plain-language copy for every field, with defaults called out ("You didn't state a grace period. Using 7 days.")
- [ ] Confirming stores `canonicalBundleHash`; submission recomputes it and refuses on mismatch
- [ ] Accurate risk copy: the taker posts the bond, and a wrong bundle can be matched into a loan on the wrong terms
- [ ] The accent color appears only in the review state
- [ ] "Import from skill" path: load a bundle JSON from the Phase 3b skill into the same review state; the hash is
      recomputed on import and the gate is identical to a chat-drafted bundle
- [ ] Tests that a hash mismatch or a post-confirm edit blocks submission
- [ ] Manual end-to-end run on Sepolia

## Phase 6: Desk agent, questions and guidance ⏳

**Goal:** people can ask Desk anything about TDH and get clear guidance: what the products are, which one fits them,
what they need before starting, what happens at each step, and what to do next in their own flow.

What Desk answers:

- **Product questions:** how borrowing against vesting works, what lenders earn, what ATP is, haircuts, bonds, defaults,
  what stays private and what is public
- **"Which product is right for me?":** a short guided interview that routes to Borrow, Lend or ATP
- **Readiness checks:** "Is my vesting in TokenOps custody?", "Do I have a credit commitment?", based on the connected
  wallet's public on-chain state
- **Next steps:** where the user is in their flow (drafting, matched, funded, repaying) and what to do now
- **Docs lookup:** answers grounded in `docs/FAQ.md`, the architecture and privacy docs, with links

How it stays private (proposal, see open decision D1):

- Guidance runs as a separate **Ask** mode, clearly labeled as going to an AI provider. Drafting stays local.
- Ask mode never receives the draft, the transcript of drafting turns, or decrypted values. It may receive public
  on-chain facts the user chooses to share (for example "custody: yes").
- Before sending, a local check warns when the message looks like it contains amounts, rates or addresses, and offers to
  switch to drafting instead. This is a safety net, not a guarantee, and the UI says so.
- The model call goes through a server route in `apps/site` so the API key never reaches the browser. Requests are not
  logged with wallet addresses.

Checklist:

- [ ] Decide D1 (hosted model vs local-only answers) and the provider
- [ ] Curated knowledge base from the docs and FAQ, versioned in the repo and shared with the Phase 3b skill
- [ ] Product-fit interview flow with quick-reply chips
- [ ] Readiness checks from public on-chain reads
- [ ] "What next" guidance driven by the user's current flow state
- [ ] Ask/Draft mode switch with the sensitive-content warning
- [ ] Server route, rate limiting, no wallet-linked logging
- [ ] Answer-quality fixtures: a set of real user questions with expected answers or links
- [ ] Copy that never gives financial advice; it explains and routes

## Phase 7: Book and Vault in the site ⏳

**Goal:** the market and loan pages in `apps/site` replace the harness for real users.

- [ ] Choose an indexing approach (subgraph, small self-hosted indexer or hosted log API) and record it
- [ ] Index book bucket and backing events, match attempts, settlement outcomes and escrow lifecycle events
- [ ] Book page: public buckets with coarse metadata, backed by the index with a lookback fallback
- [ ] Vault page: the user's loans with role-aware actions (match, fund, activate, repay, release), each behind the
      Phase 5 recap where it moves money
- [ ] Indexer health shown alongside wallet and contract status
- [ ] Manual Sepolia run of a full loan from Desk to Vault

## Phase 8: ATP ⏳

**Goal:** a pooled lender fund. Deposits, shares and positions stay encrypted; NAV is published once per epoch.

- [ ] Design session: who directs allocation, how defaulted loans are valued, epoch length, minimum flows per epoch
- [ ] `ATPVault`: cUSDC deposits via the ERC-7984 receiver callback, encrypted share balances
- [ ] Allocation through the existing book, adapter and escrow as a lender
- [ ] Running encrypted NAV updated per position change, within fhEVM HCU limits
- [ ] Epoch close: publicly decrypt only the aggregate NAV and verify the KMS proof
- [ ] Deposit and withdrawal queues settle at epoch close; an epoch decrypts only with a minimum number of flows
- [ ] Desk intents for deposit and withdraw, behind the confirmation gate
- [ ] `/atp` page: NAV per epoch, schedule, the user's own position via user decryption
- [ ] Contract tests and Sepolia smoke scripts for deposit, epoch close and withdrawal

## Phase 9: PWA, offline shell and device tests ⏳

Manifest and icons shipped in Phase 0.

- [ ] Service worker caching static assets only: code, fonts and the relayer WASM. Never chat, drafts, API or RPC
      responses
- [ ] Install and wallet connection on real iOS and Android devices, including MetaMask deep links
- [ ] Higher-resolution or vector house logo for sharper 512px icons

## Phase 10: Hardening and audit ⏳

- [ ] Triage `npm audit` dev-dependency findings: upgrade, override or risk-accept in writing
- [ ] Coverage job in CI
- [ ] Sepolia: refund accounting after a wrong-amount ERC-7984 callback
- [ ] Sepolia: token refund or rejection after a callback failure
- [ ] Guard for confidential USD tokens that do not implement `IERC7984ERC20Wrapper`
- [ ] Decide `ProtocolAccountRegistry`: integrate, keep as reference with a note, or remove
- [ ] External security audit before any mainnet discussion
- [ ] Re-run the full Sepolia smoke suite after every redeploy or dependency upgrade

---

## Open decisions

| #   | Decision                                   | Recommendation                                             | Needed by |
| --- | ------------------------------------------ | ---------------------------------------------------------- | --------- |
| D1  | Desk guidance: hosted model or local-only  | Hosted model in a labeled Ask mode, never sent bundle data | Phase 6   |
| D2  | Wallet connector in `apps/site`            | viem (already a root dependency)                           | Phase 4   |
| D3  | Accent color for the confirmation step     | `--tdh-yellow`, solid fill with black text                 | Phase 5   |
| D4  | Indexing backend                           | Decide after Phase 1 shows real query needs                | Phase 7   |
| D5  | ATP allocation, default valuation, epochs  | Needs a design session                                     | Phase 8   |
| D6  | Sepolia smoke tests in CI                  | Keep manual; they cost testnet ETH and need wallet keys    | Phase 10  |
| D7  | Migrate `public/app.js` to the SDK helpers | After Desk ships                                           | Later     |

## Out of scope for now

- Mainnet deployment. Sepolia is the only public target until Phase 10 is done.
- Anonymous borrowing or lending. TDH offers confidential terms and confidential settlement, not anonymous
  counterparties.
