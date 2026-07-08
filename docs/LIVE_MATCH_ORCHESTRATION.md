# Live Match Orchestration

Date: 2026-07-06

This note describes how the live Sepolia match flow should be driven from scripts and, later, the Loans page. It is not
a replacement for the contract specs; it is the operator/UI transaction order that keeps privacy and custody assumptions
intact.

## Current Sepolia Facts

- `ConfidentialPreferenceBook`: `0x882Da9cB5BD5DA4cCB58d91040d60dCC50183Ecb`
- `NashNegotiationEngine`: `0x7267122A75B7a7890AF9ac4003a737FFF22e9150`
- `TokenOpsVestingAdapter`: `0xc92c61ebdaC716238AF4D70A2696663D16220B94`
- `LoanEscrowFactory`: `0x5c81d01795D36642A4137643F8D11fE956567d85`
- `ERC7984CreditAdapter`: `0xF832f4c797eE146198a79EdfB0E0B2Ac82ccE3F2`
- `BondManager`: `0x390feeFCA76d7ff56fcA0fCC74873A70fAbb24F7`
- `MatchSettlementCoordinator`: `0xA73aF9DbFfACB115090452E17a11F85931359Ce1`
- cUSDCMock: `0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639`
- TokenOps CTTT collateral: `0x258F9D60dc023870e4E3109c894D834D5377361a`
- CVC TokenOps manager: `0xb32208BF362b48672cAf58C52Ee45908e3cc6333`

## Validated Sepolia Building Blocks

- Real TokenOps CTTT vesting custody and release through `TokenOpsVestingAdapter`.
- TokenOps unpledged custody recovery back to the original borrower.
- TokenOps vesting ID `bytes32(0)` compatibility.
- ERC-7984 `cUSDCMock` correct-amount and wrong-amount adapter callbacks.
- Reusable ERC-7984 lender credit commitments backed by adapter-held confidential cUSDC.
- ERC-7984 funding and repayment through a real `LoanEscrow`, including borrower confidential-USD release on activation
  and lender confidential-USD release on repayment.
- Browser-style encrypted Preference Bundle submission using `generateZKProof()` plus relayer
  `requestZKProofVerification(...)`.
- Encrypted match execution, six staged selected-term computations, aggregate feasibility public decryption,
  `MatchSettlementCoordinator.settleSuccessfulMatch`, matched escrow funding, activation, repayment, and collateral
  release.

## Custody Recovery

Borrower backing activation currently requires the vesting schedule recipient to be the `TokenOpsVestingAdapter`. The
deployed adapter includes `recoverUnpledgedVesting` and `completeUnpledgedVestingRecovery`, so unpledged custody can be
returned to the original borrower without making the borrower the caller. The borrower must still accept the TokenOps
pending transfer before the adapter can clear its custody record.

Sepolia validation passed against the published manifest adapter. The recovery path returns custody to the original
borrower; it does not reveal vesting schedule amounts or terms beyond the public TokenOps transfer lifecycle.

## Transaction Order

1. Save encrypted preference bundles.
   - Call `ConfidentialPreferenceBook.createPreferenceBundle`.
   - Exact ranges, directions, and priorities are encrypted.
   - Labels, ordering, and rich builder metadata stay browser-local.

2. Prepare executable backing.
   - Borrower: create or select a TokenOps vesting schedule, initiate transfer to `TokenOpsVestingAdapter`, have the
     adapter accept it, then call `registerBorrowerBacking`.
   - Lender: register a credit commitment through the configured `ERC7984CreditAdapter`, transfer confidential cUSDC to
     the adapter with the same commitment hash as callback data, then call `registerLenderBacking`.
   - Call `activateBacking` for both sides only when the corresponding escrow/custody commitment is intentional.

3. Post taker bond.
   - Quote with `BondManager.quoteBond`.
   - Post with `BondManager.postBond`.

4. Execute match.
   - Call `NashNegotiationEngine.executeMatch(takerPreferenceId, candidatePreferenceIds)`.
   - Candidate IDs come from the opposite-side public bucket index.
   - No free preview path exists.

5. Compute selected encrypted terms.
   - Call `computeSelectedTerm(matchAttemptId, fieldIndex)` for field indexes `0..5`.
   - The staged calls keep fhEVM compute under practical limits.

6. Commit encrypted terms.
   - Call `commitEncryptedTerms(matchAttemptId)`.
   - This stores `termsHash`, `encryptedTermsHash`, and the aggregate encrypted feasibility handle.

7. Finalize aggregate feasibility.
   - Publicly decrypt only the aggregate feasibility handle through the Zama relayer.
   - Call `finalizeMatchFeasibility(matchAttemptId, feasible, decryptionProof)`.
   - Do not expose field-level mismatch reasons.

8. Settle the match.
   - If infeasible, call `MatchSettlementCoordinator.settleFailedMatch`.
   - If feasible, construct `LoanEscrow.LoanConfig` from the matched managers, TokenOps manager, vesting ID, adapter
     addresses, the lender commitment hash as `fundingCommitmentHash`, a fresh per-loan draw hash as
     `fundingAuthorizationHash`, and an opaque repayment authorization hash, then call `settleSuccessfulMatch`.

9. Finish escrow lifecycle.
   - Register vesting collateral.
   - Register/finalize ERC-7984 funding authorization bound to the escrowed lender commitment, then call
     `escrowFunding`.
   - Activate; activation releases the borrowed confidential USD to the borrower.
   - Register/finalize ERC-7984 repayment authorization, then call `makeLoanPayment`; repayment releases confidential
     USD to the lender.
   - Borrower accepts the adapter-initiated TokenOps release and the adapter completes release.

## UI Requirements

- The Loans page should be the role-aware execution surface.
- The global role toggle should determine borrower/lender copy and available actions.
- Show public buckets and local user bundles; do not imply exact counterparty terms are known.
- Display gas estimates and custody warnings before any action that moves TokenOps vesting custody.
- Disable any path that would route Sepolia users through `MockConfidentialCreditAdapter`, `DemoCreditFaucet`, or
  `MockTokenOpsVestingManager`.
- Index public `PreferenceCreated` and `LoanCreated` surfaces for discovery; use direct contract reads for current
  executable and escrow lifecycle state. Add durable pagination/indexing before treating the UI as an archival
  dashboard.

## Remaining Before Public UI Execution

- Manually validate the browser-wallet execution path on Sepolia.
- Add gas estimates, bond quote previews, and richer candidate-selection controls.

## Current Smoke Commands

```bash
npm run smoke:sepolia:tokenops-collateral
npm run smoke:sepolia:erc7984-commitment
npm run smoke:sepolia:erc7984-unwrap
npm run smoke:sepolia:loan-escrow
npm run smoke:sepolia:match-settlement
npm run smoke:sepolia:failed-match
npm run smoke:sepolia:preferences
```
