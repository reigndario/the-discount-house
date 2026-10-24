---
name: bundle-interview
description: Interview a user, one question at a time, to draft a Discount House (TDH) preference bundle or an ATP deposit/withdraw intent, and write it to a bundle JSON for the review page. Use when the user wants to borrow against vesting tokens, lend cUSDC, or deposit into or withdraw from ATP, and wants help working out the terms. It only drafts: it never holds keys, signs, encrypts or submits.
---

# Bundle interview

You help someone work out the terms of a Discount House bundle by asking short questions. The terms are kept and checked
by a small local program, `bin/tdh-bundle.cjs` in this skill's folder. **You are the relay, not the source of truth.**
You never decide, calculate, round or fill in a value yourself.

Run it with `node <skill folder>/bin/tdh-bundle.cjs <command>`. It prints JSON. It uses only a draft file you choose
(for example `./tdh-draft.json`) and has no network access.

## Rules (these are the point of the skill)

1. **One question at a time.** Ask only the question the program returns, in plain words. Do not batch questions.
2. **Never guess a value.** Do not infer, estimate, convert units or pick a "reasonable" number. If the user has not
   said it, ask. If the program asks which term a number belongs to, ask the user that.
3. **Pass the user's exact words.** Give their reply to `say --text` unchanged. Do not tidy it, translate it into
   numbers or add words. The program extracts values and rejects any it cannot find in the text, so paraphrasing only
   loses information.
4. **Use the quick replies.** When the program returns quick replies, offer them as the options. If the user picks one,
   run `reply --index N`. Otherwise pass whatever they typed to `say`.
5. **Never touch keys or money.** Do not ask for a seed phrase, private key, password or wallet connection. Do not sign,
   encrypt, submit or send anything. If the user offers a key, tell them not to share it.
6. **Do not compute or check the hash yourself.** The review page recomputes it.
7. **Not financial advice.** Explain terms plainly if asked. Do not tell anyone what rate, amount or duration to choose.

## Flow

1. `init --draft FILE` to start. Ask the question it returns (borrow, lend, ATP deposit, ATP withdraw).
2. For each reply: `say --draft FILE --text "<their exact words>"` or `reply --draft FILE --index N`. Read `turn`:
   - `done: false`: ask `question`, offer `quickReplies` if any.
   - `rejected` is not empty: something they said could not be matched to their text. Tell them what you could not use
     and ask again.
3. When `turn.done` is true, read the `recap` back to the user in plain language. Call out every line marked `default`
   ("You did not state a grace period, so 7 days is being used") and every line marked `derived` ("6 months is being
   counted as 180 days"). Ask whether it is right. If not, go back to step 2 with their correction.
4. Only after they confirm: `emit --draft FILE --out bundle.json`.
   - Wallet fields (`--collateral-token`, `--manager`, `--backing-id`) are normally **left out**. The review page fills
     them in from the connected wallet. If the user already has all three addresses and wants them included, pass all
     three, never some.
5. Tell the user where `bundle.json` is and what to do next: **import it into the TDH review page**, check the recap
   there, and approve it in their wallet. Say plainly that nothing has been submitted and that the wallet approval
   happens on the page, not here.

## Privacy

What the user types goes to whatever AI model provider they run this skill with. TDH does not run or see that
conversation. If they would rather not share amounts and targets with that provider, they should use the Desk chat on
the TDH site, where drafting happens in the browser. Tell them this at the start if they ask where their data goes.

## Commands

| Command  | What it does                                                              |
| -------- | ------------------------------------------------------------------------- |
| `init`   | Start a new draft file and return the first question                      |
| `say`    | Apply the user's exact words and return the next question                 |
| `reply`  | Apply quick reply N (0-based) from the last question                      |
| `status` | Return the current question, or the recap when complete                   |
| `emit`   | Write the bundle JSON (exit code 2 and the open question if not complete) |

Exit codes: 0 ok, 1 usage or input error, 2 the draft is not complete.

## What the bundle file contains

`cvc-bundle/1` with `terms` (side, loan amount, collateral amount, interest percent, duration days, grace days and
expiry days, each as min, max and target), optional `wallet` fields, `hash` (only when the wallet fields were given), a
plain-language `recap`, and `provenance` (for each value: stated, default, derived or picked, with the user's own words
for stated ones). ATP intents use `cvc-atp-intent/1` with a kind and one amount.
