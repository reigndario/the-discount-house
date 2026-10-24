# Decisions

A running log of the decisions behind The Discount House build: what we chose, why, and what we turned down. It is
appended at the end of each phase of [TDH.md](../TDH.md), one entry per decision. Newer entries go at the bottom.

Status: **Accepted** (agreed and in the roadmap or code) · **Proposed** (made in implementation, waiting for review) ·
**Open** (not decided yet)

## Index

| ID    | Decision                                                   | Phase   | Status   |
| ----- | ---------------------------------------------------------- | ------- | -------- |
| D-001 | Offer drafting as both a web chat and a local skill        | Roadmap | Accepted |
| D-002 | The skill drafts only; a review page signs and submits     | Roadmap | Accepted |
| D-003 | Wallet signing through the hosted site, or a local page    | Roadmap | Accepted |
| D-004 | Reword the privacy rule to cover the local skill           | Roadmap | Accepted |
| D-005 | Build the skill after the intent core, beside the web chat | Roadmap | Accepted |
| D-006 | The "bundle interview skill" is the Phase 3b skill         | Roadmap | Accepted |
| D-007 | Plain bundles state interest as `interestPercent`          | 2: SDK  | Proposed |
| D-008 | Default grace period: 7 days or 30 days                    | 2: SDK  | Open     |
| D-009 | The Sepolia smoke script derives the collateral price      | 2: SDK  | Proposed |
| D-010 | How the confirmation hash is built                         | 2: SDK  | Proposed |

---

## Roadmap decisions (2026-10-22 to 2026-10-23)

### D-001: Offer drafting as both a web chat and a local skill

**Status:** Accepted · **Date:** 2026-10-22

**Context.** Feedback said the chat should be a local skill anyone can run. The roadmap already planned a hosted Desk
chat in the site.

**Decision.** Build both. They share one drafting core (Phase 3), so the second channel costs little.

**Why.** Technical users are comfortable with an agent in a terminal. Non-technical users need a web page. A bundle's
amounts and targets are sensitive, and a local skill means no TDH server ever sees a draft.

**Rejected.**

- _Skill only._ Shrinks Phases 4 and 6 and removes the hosted-model question, but leaves out anyone without an agent
  runtime.
- _Web chat only._ The status quo. Needs a server route, rate limiting and a hosted model decision, and sends drafts
  through infrastructure we run.

### D-002: The skill drafts only; a review page signs and submits

**Status:** Accepted · **Date:** 2026-10-22

**Context.** After the interview, something has to encrypt the bundle, sign a transaction and submit it. That could be
the skill or a separate page.

**Decision.** The skill produces a bundle JSON and its hash and never holds keys, signs or submits. A review page
recomputes the hash, shows a plain-language recap, asks for confirmation, then encrypts and asks the wallet to sign.

**Why.** There is one confirmation gate and one place that touches a wallet, whichever way the bundle was drafted. The
protocol warns that a wrong bundle can be matched into a loan on the wrong terms, so the gate must be one that the model
cannot satisfy on its own.

**Rejected.**

- _The skill submits itself with a key it can read._ Puts a private key inside an agent session, where it can reach
  logs, the model's context and prompt-injection attacks.
- _The skill submits through its own terminal confirmation._ Needs a second gate as strong as the website's. Two gates
  means twice the places for a bug to let a wrong bundle through.

### D-003: Wallet signing through the hosted site, or a local page

**Status:** Accepted · **Date:** 2026-10-23

**Context.** A hot wallet such as MetaMask is a browser extension, so a terminal script cannot talk to it directly.

**Decision.** By default the user imports the bundle JSON into the hosted site. Technical users who want to stay in the
terminal can use a localhost signing page, the same review and signing code packaged to run locally. The skill fetches
it from a **tagged GitHub release** and verifies a **pinned checksum** before launching it.

**Why.** The key stays in the wallet and the agent only ever sees a transaction hash. A pinned release means the agent
cannot be redirected to different code that can see the bundle and prompt the wallet.

**Rejected.**

- _Fetching the page from `main`._ Would run whatever was pushed last.
- _Reading a private key or mnemonic from the environment._ Same key-exposure problem as D-002.
- _WalletConnect only._ A workable bridge, so not ruled out, but the localhost page reuses the hosted page's code.

### D-004: Reword the privacy rule to cover the local skill

**Status:** Accepted · **Date:** 2026-10-23

**Context.** Rule 1 said no plaintext bundle content goes to a hosted LLM. The local skill sends the user's text to
whatever model provider they use.

**Decision.** Rule 1 now covers only providers TDH runs or chooses. The skill and its docs say plainly that text goes to
the user's own provider.

**Why.** "Local" only covers our side. Claiming more would be false, and users should know what leaves their machine.

**Rejected.**

- _Leave the rule unchanged._ The skill would break it by design.
- _Drop the skill to keep the rule._ Gives up the technical-user channel from D-001.

### D-005: Build the skill after the intent core, beside the web chat

**Status:** Accepted · **Date:** 2026-10-23

**Decision.** Phase 3b runs in parallel with Phase 4 once Phase 3 lands, so the skill can be demoed before the web chat
is finished.

**Why.** Both depend only on the intent core, which must stay free of React and browser dependencies.

**Rejected.** _Skill before Phase 4._ Would delay the web chat for non-technical users with no gain in what can be
built.

### D-006: The "bundle interview skill" is the Phase 3b skill

**Status:** Accepted · **Date:** 2026-10-22

**Context.** A reminder said to "demo the bundle interview skill". Nothing by that name existed in the repo.

**Decision.** Treat it as the name for the Phase 3b skill. The demo is a test run of the finished skill from interview
to signed bundle.

**Rejected.** _Treating it as an existing external skill._ Nothing in the repo or roadmap points to one.

---

## Phase 2: SDK consolidation

### D-007: Plain bundles state interest as `interestPercent`

**Status:** Proposed · **Date:** 2026-10-23

**Context.** The contract stores interest in basis points (700 is 7%). The browser harness lets users enter a percent
but still calls the field `interestBps` and multiplies by 100 on encryption.

**Decision.** The plain bundle field is `interestPercent` (7 means 7%). `toContractFields` scales it to basis points.

**Why.** A user, or Desk, stating "7%" must never be read as 7 basis points, which is 0.07%. The name makes the unit
visible.

**Rejected.** _Keep `interestBps` for a plain value._ Matches the harness, but a bare 7 would read as basis points.

### D-008: Default grace period: 7 days or 30 days

**Status:** Open · **Date:** 2026-10-23

**Context.** Grace is the number of days a borrower has after a repayment is due before default can be enforced. The SDK
copied the harness default: a range of 0 to 15 days with a target of 7. A copy example written into Phase 5 of the
roadmap says "Using 30 days". The two disagree.

**Options.**

- _7 days (current code)._ What the harness already uses and tests with.
- _30 days._ Matches the roadmap example and gives borrowers more room, but it is a product decision about how much
  grace people get when they do not state one, and the default is folded into the confirmation hash.

**Leaning.** Keep 7 days and change the roadmap example to match.

### D-009: The Sepolia smoke script derives the collateral price

**Status:** Proposed · **Date:** 2026-10-23

**Context.** The old script hardcoded a price of 0.6 to 0.9. That did not follow from its own principal (80 to 120) and
collateral (100,000 to 175,000), which imply roughly 0.0005 to 0.0012.

**Decision.** The script now builds a plain bundle and lets the SDK derive the price, so it exercises the same path as
Desk. Rates and priorities were adjusted so the borrower and lender inputs still overlap.

**Why.** A smoke test should run the code real users run. The old values bypassed the derivation.

**Rejected.** _Keep hardcoded prices._ Would leave the new SDK path untested on the real network.

**Revisit.** The script has not yet been run on Sepolia. This stays unproven until it is.

### D-010: How the confirmation hash is built

**Status:** Proposed · **Date:** 2026-10-23

**Context.** The confirmation gate stores a hash of what the user approved and recomputes it at submission, refusing on
a mismatch.

**Decision.** `canonicalBundleHash` hashes a fixed-order JSON array, prefixed `cvc:bundle:v1`. It covers side, token
addresses, bucket labels, **`expiryDays`**, backing ID and the six scaled fields with **defaults already resolved**.

**Why.**

- Hashing the scaled integers means `5` and `5.0` hash the same, and a value stated explicitly hashes the same as the
  default it equals.
- Hashing `expiryDays` instead of an absolute timestamp means the hash does not change between confirming and
  submitting.
- The version prefix lets the format change later without silent collisions.

**Rejected.**

- _ABI-encoding the fields._ Compact but opaque. A JSON array is easy to inspect and reproduce in another language, such
  as the skill's CLI.
- _An absolute expiry timestamp in the hash._ Would break the hash check whenever time passes before submission.

**Consequence.** Changing a default later (see D-008) changes the hash of any bundle that relied on it.
