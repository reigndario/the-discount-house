# Bundle interview skill

A local agent skill that interviews you, one question at a time, and writes a preference bundle JSON for the TDH review
page. It is the second way to draft a bundle, next to the Desk chat on the site. Both use the same drafting core
(`src/intent/`).

## What it does and does not do

- **Does:** asks questions, keeps your draft in a local file, checks every value against your own words, and writes
  `bundle.json`.
- **Does not:** hold keys, sign, encrypt, submit, or connect to a wallet or the network. The program that keeps the
  draft has no network code. The wallet approval gate is on the review page, never in the agent.

## Where your text goes

Everything you type goes to the AI model provider you run the skill with. TDH does not run that conversation and cannot
see it. If you do not want to share amounts and rate targets with that provider, use the Desk chat on the site, where
drafting happens in your browser.

## Install

Copy the `skills/bundle-interview/` folder into your agent's skills directory (for Claude Code, `~/.claude/skills/`). It
needs Node 20 or newer and nothing else: `bin/tdh-bundle.cjs` is a single self-contained file.

Verify it before first use:

```
shasum -a 256 skills/bundle-interview/bin/tdh-bundle.cjs
cat skills/bundle-interview/bin/tdh-bundle.cjs.sha256
```

The two hashes should match. Compare against the checksum published with a tagged release, not one from `main`.

## Use

Ask your agent to help you draft a bundle. It runs these commands for you:

```
node bin/tdh-bundle.cjs init   --draft draft.json
node bin/tdh-bundle.cjs say    --draft draft.json --text "borrow about 100k usdc at under 8%"
node bin/tdh-bundle.cjs reply  --draft draft.json --index 0
node bin/tdh-bundle.cjs status --draft draft.json
node bin/tdh-bundle.cjs emit   --draft draft.json --out bundle.json
```

`emit` refuses an incomplete draft (exit code 2) and prints the open question.

## The bundle file

Format `cvc-bundle/1`:

| Field        | Meaning                                                                                                   |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| `terms`      | side, `principal`, `collateralAmount`, `interestPercent`, `durationDays`, `gracePeriodDays`, `expiryDays` |
| `wallet`     | `collateralToken`, `tokenOpsManager`, `backingId`, or `null`                                              |
| `hash`       | `canonicalBundleHash` of terms plus wallet, or `null` when there are no wallet fields                     |
| `recap`      | plain-language lines, with defaults and conversions called out                                            |
| `provenance` | per value: `stated`, `default`, `derived` or `picked`, plus your own words for stated values              |

The skill normally leaves `wallet` empty because it does not know your wallet. The review page fills those fields from
the connected wallet and computes the hash. Whatever the file says, the page recomputes the hash itself before anything
is signed; it never trusts the file.

ATP intents use `cvc-atp-intent/1` with a kind (`atp_deposit` or `atp_withdraw`) and one amount.

## Rebuilding the bundle

`npm run build:skill` rebuilds `bin/tdh-bundle.cjs` and its checksum from `src/skill/` and `src/intent/`. The test suite
fails if the committed files are stale.

## Not done yet

- Importing the file into the review page (Phase 5).
- The optional localhost signing page, downloaded from a tagged release with a pinned checksum.
- Questions about the products, which need the Phase 6 knowledge base.
