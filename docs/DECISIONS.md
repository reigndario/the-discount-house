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
| D-008 | Default grace period: 7 days or 30 days                    | 2: SDK  | Accepted |
| D-009 | The Sepolia smoke script derives the collateral price      | 2: SDK  | Proposed |
| D-010 | How the confirmation hash is built                         | 2: SDK  | Proposed |
| D-011 | A bare number is a target, and only an answer when asked   | 3: Core | Accepted |
| D-012 | Months and years convert to 30 and 365 days                | 3: Core | Accepted |
| D-013 | Grace is defaulted and never asked                         | 3: Core | Accepted |
| D-014 | The skill leaves wallet fields and the hash to the page    | 3b      | Proposed |
| D-015 | The agent relays; a local CLI is the source of truth       | 3b      | Proposed |

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

**Status:** Accepted (7 days, confirmed 2026-10-24) · **Date:** 2026-10-23

**Context.** Grace is the number of days a borrower has after a repayment is due before default can be enforced. The SDK
copied the harness default: a range of 0 to 15 days with a target of 7. A copy example written into Phase 5 of the
roadmap says "Using 30 days". The two disagree.

**Options.**

- _7 days (current code)._ What the harness already uses and tests with.
- _30 days._ Matches the roadmap example and gives borrowers more room, but it is a product decision about how much
  grace people get when they do not state one, and the default is folded into the confirmation hash.

**Decision.** Keep 7 days and change the roadmap example to match. A longer default would change the confirmation hash
of any bundle that relied on it, and borrowers who want more can state it.

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

## Phase 3: Intent core (2026-10-24)

### D-011: A bare number is a target, and only an answer when asked

**Status:** Accepted · **Date:** 2026-10-24

**Context.** "Borrow 100k USDC" states one number. It could mean exactly 100k, or about 100k with room either side. A
bare "90" with no unit could be anything.

**Decision.** A number with a unit and no bound word ("about", "at most", "at least") fills the `target` slot only. The
dialogue policy then asks whether it is exact or a range, offering an "Exactly X" quick reply. A number with no unit is
read only as the answer to the question just asked (`context.expecting`). Otherwise the parser returns it unresolved
(`unknown_field`) and the policy asks which term it belongs to.

**Why.** Desk asks a question instead of guessing. Treating "100k" as an exact amount would silently set the minimum and
maximum, and those are folded into the confirmation hash.

**Rejected.**

- _Read a bare amount as min = max = target._ Fewer questions, but it guesses.
- _Guess the field from the number's size._ Fragile and invisible to the user.

### D-012: Months and years convert to 30 and 365 days

**Status:** Accepted · **Date:** 2026-10-24

**Context.** Durations are stored in days, but people say "6 months" or "2 years".

**Decision.** Weeks, months and years convert to 7, 30 and 365 days. The slot is marked `derived` and keeps its span ("6
months"), and the span verifier recomputes the conversion from the cited text.

**Why.** The review recap shows days, so the user sees the conversion before confirming. A calendar-accurate month would
make the value depend on a start date that does not exist yet.

**Rejected.** _Ask for days only._ Safer but unfriendly. _Calendar months._ Needs a start date.

### D-013: Grace is defaulted and never asked

**Status:** Accepted · **Date:** 2026-10-24

**Context.** Four terms are essential to a bundle. Grace has a sensible default and most people will not state it.

**Decision.** Once the side is known, grace is filled from `defaultsForSide` with source `default`, and a stated grace
overrides it. The policy never asks about it; the review recap lists it as a default.

**Why.** Fewer questions, and defaults stay visible rather than hidden. This depends on D-008 (7 or 30 days): the value
changes with that decision, and so does the confirmation hash.

**Rejected.** _Ask for grace every time._ Adds a question most users answer with "whatever is normal."

## Phase 3b: Bundle interview skill (2026-10-24)

### D-014: The skill leaves wallet fields and the hash to the review page

**Status:** Proposed · **Date:** 2026-10-24

**Context.** The roadmap says the CLI emits the canonical bundle JSON and its `canonicalBundleHash`. But the hash
(D-010) covers the collateral token, the TokenOps manager and the backing ID, and a skill running in a terminal has no
way to know them without the user's wallet.

**Decision.** `emit` writes the conversation's terms and, by default, `wallet: null` and `hash: null`. If the user
supplies all three wallet fields, it writes them and the SDK's `canonicalBundleHash`. The review page fills the wallet
fields from the connected wallet and recomputes the hash itself, whatever the file says.

**Why.** Inventing placeholder addresses to get a hash would produce a hash that means nothing. The gate has to live in
the page anyway (D-002), so the file never needs to carry a trusted hash.

**Rejected.**

- _Placeholder addresses so a hash always exists._ A meaningless hash that looks meaningful.
- _Ask the user to paste addresses during the interview._ Adds three hard questions to a plain-language flow, and
  invites typos in values the wallet already knows.

### D-015: The agent relays; a local CLI is the source of truth

**Status:** Proposed · **Date:** 2026-10-24

**Context.** If the model fills in values itself, it can misread, round or invent them, which is exactly what the span
verifier exists to prevent.

**Decision.** The skill tells the agent to pass the user's exact words to `tdh-bundle say`. The CLI parses them, rejects
any value not in the text, keeps the draft in a local file and chooses the next question. The CLI is bundled with
esbuild into one committed file, `skills/bundle-interview/bin/tdh-bundle.cjs`, with a SHA-256 beside it. A test fails if
the committed file is stale, and another checks that it requires nothing but `node:fs`.

**Why.** The same checks apply as in the web chat, and installing the skill needs no `npm install`. The cost is a
generated file in the repo, kept honest by the test.

**Rejected.**

- _Instructions only, no CLI._ The model would do the parsing, with nothing enforcing the span rule.
- _Publish the CLI to npm._ Adds a supply-chain step and a second place to verify. The local signing page already needs
  a pinned-checksum release, so one mechanism is enough for now.
