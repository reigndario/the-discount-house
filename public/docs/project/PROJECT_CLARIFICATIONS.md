# Confidential Vesting Credit Project Clarifications

Please edit this file inline with your answers. Short answers are fine.

## Core Direction

1. What do you want me to produce first?
   - Options: buildable repo skeleton, Solidity contracts and tests, technical feasibility/risk review, tighter
     implementation spec, UI prototype, or something else.
   - Answer: create a plan that you can execute until it reaches a point I can test it, running completely locally to
     begin with (local testnet mode). If you need to create more refined design artefacts first, include that in your
     execution plan
2. Should this be a real fhEVM/Zama implementation from the start, or a staged prototype with mock encrypted values
   first?
   - Answer: It's of high importance to not cut corners including using the real fhEVM/Zama implementation libraries.
     However, we can do development locally to the maximum degree possible then do some user testing on the sepolia
     testnet.
3. Do you already have a target repo, or should I create `/root/confidential-vesting-credit/` from the dossier layout?
   - Answer: create it

## Integration Reality

4. Do you have specific versions or repos for Zama fhEVM tooling, OpenZeppelin confidential contracts / ERC-7984,
   TokenOps SDK/contracts, or a confidential cUSDC test token?
   - Answer: search to find the latest -- this may be useful: https://github.com/zama-ai/skills
5. Is network access allowed for dependency installation and docs lookup, or should I work only from local files?
   - Answer: install whatever is needed. Make whatever changes you need to the host OS (you are root) -- this is a
     sandboxed VPS environment which only exists for this project
6. Should TokenOps integration be real in this first pass, or should I define an adapter interface plus mocks until
   contract-level semantics are confirmed?
   - Answer: yes make it real as possible and not cut corners (similar to above -- keep this principle in mind)

## Product Scope

7. For MVP negotiation, should terms be represented as exact values per preference card, min/max ranges, or both as the
   dossier suggests?
   - Answer: Preference cards may contain ranges/tolerances, but executable terms are always exact discrete candidate
     values. Principal and duration should have preferred targets plus optional tolerances. Interest should usually be a
     one-sided range: borrower max rate, lender min rate. Grace period can be target plus min/max. The negotiation
     engine expands these into bounded exact candidate packages and settles only one exact package. Happy to do some
     back and forth here until we're aligned.
8. Should due dates actually be private in the first prototype? This is likely a hard part because default checks
   against time often leak or require async gateway/decryption patterns.
   - Answer: we can impose a small cost on checking. Since the tokens are vesting (they are not going anywhere!) the
     checks do not have to happen very often. Maybe we rate limit these? Let's discuss this futher once you respond to
     my points.
9. Should match failure slash the bond immediately in the prototype, even when failure can happen because the market is
   empty or input is malformed?
   - Answer: can we have add an is_empty check function? Malformed is a UI or user error.

## Risk And Compliance

10. Is this intended as a demo/prototype, testnet app, or production-bound protocol? - Answer: testnet app HOWEVER it
    should function and have effort put in commensurate to a production application. It will be JUDGED and if worthy we
    may recieve funding to keep workign together, you and I codex, won't that be fun!?

11. Any regulatory constraints I should preserve in the design, even though KYC/credentialing is explicitly out of
    MVP? - Answer: no it's a testnet app. no need to encumber with kyc and regulatory concerns at this stage
12. Are there confidentiality limits on generated artifacts? For example, should I avoid putting the business framing or
    marketing text into repo docs? - Answer: by all means put the business framing in the repo and readme etc. --- this
    is important for getting the funding I mentioned earlier. You do want to keep working together, don't you?

## Execution Constraints

13. Preferred stack? - Contract tooling: Foundry or Hardhat - UI tooling: Next.js or Vite - Package manager: npm, pnpm,
    yarn, or bun - Answer: do some reasearch to what is most conducive for development with our target frameworks (zama,
    the token frameworks, etc). You may look here https://github.com/zama-ai/skills -- do whatever you think is most
    efficient and has the best chance of success. Note: the eventual UI will require "beautiful" styling and have heavy
    animation. I guess that's something we can iterate on later
14. Do you want tests written alongside each milestone, or should I first establish architecture/contracts then backfill
    tests? - Answer: whatever you think ensures the best chance of successful high quality delivery
15. What should I treat as a blocker requiring your input versus something I should mock and document? - Answer: use a
    supervisory and subordinate agent configuration the former judging whether the latter is blocked, or just not
    putting in the required effort. If the project truly cannot move forward, end the turn, and prompt me. Does that
    make sense?
