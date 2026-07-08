# Protocol Specification

## 1. Definitions

### Protocol account

A durable participant identity controlled by one or more wallets.

### Preference set

A bounded ordered list of ranked constraints. MVP fields are principal, interest rate, duration, and grace period.

### Maker

A participant with an active preference set in the book.

### Taker

A participant initiating negotiation against the opposite side.

### Term package

A concrete set of loan terms selected by the negotiation engine.

### Loan escrow

A contract that enforces collateral custody, lender funding, loan activation, repayment, and default reassignment.

## 2. Preference model

Each preference card contains:

```text
principal: exact value or acceptable range
interestRate: maximum for borrower / minimum for lender
duration: exact value or acceptable range
gracePeriod: exact value or acceptable range
rank: implicit list order
```

Each side submits at most `MAX_PREFERENCES` cards.

## 3. Nash bargaining approximation

The engine compares ranked preference lists and searches for compatible term packages.

Rank-derived surplus:

```text
borrowerSurplus = MAX_RANK_SCORE - borrowerRank
lenderSurplus   = MAX_RANK_SCORE - lenderRank
```

Nash-style score:

```text
nashScore = borrowerSurplus * lenderSurplus
```

Feasibility:

```text
feasible = borrowerAccepts(candidate)
        AND lenderAccepts(candidate)
        AND candidate satisfies protocol limits
        AND candidate satisfies collateral/funding constraints where applicable
```

Selection rule:

```text
Select feasible candidate with highest nashScore.
Tie-break deterministically using protocol-defined tie-breaker.
```

Suggested tie-breaker order:

1. Higher combined surplus.
2. Earlier taker preference rank.
3. Earlier maker preference rank.
4. Lower preference ID hash.

## 4. Candidate selection

MVP candidate selection uses public coarse buckets:

- Side.
- Asset/vesting class.
- Principal bucket.
- Duration bucket.
- Expiry.
- Optional coarse dealability tier.

Takers submit a candidate set. The protocol validates target minimum batch size where available.

Thin market rule:

```text
requiredBatchSize = min(configuredMinBatchSize, availableCounterpartiesInBucket)
```

If available counterparties are below the configured minimum, the candidate set must include all available counterparties in that bucket.

## 5. Match-attempt bond

Before negotiation:

```text
taker posts bond
```

If successful:

```text
bond refunded
optional future success reward applies
```

If failed:

```text
bond slashed
slashed amount split between protocol treasury and probed counterparties
no failure reason revealed
```

Bond scaling:

- Lower batch size implies higher bond.
- Repeated failed attempts imply higher bond and/or cooldown.
- Governance or admin config sets base parameters.

## 6. Loan creation

On match:

1. Preference records are marked pending.
2. Selected encrypted term package is bound to a new `loanId`.
3. LoanEscrow is created or initialized.
4. Final terms are decryptable only to borrower and lender.
5. Loan waits for bilateral escrow.

## 7. Bilateral escrow activation

Borrower requirements:

- Vesting position transferred to or controlled by LoanEscrow.
- Vesting position not already pledged.
- Sufficient eligible vesting value.

Lender requirements:

- Confidential cUSDC transferred to LoanEscrow.
- Encrypted cUSDC balance sufficient to fund principal.

Encrypted check:

```text
borrowerReady = eligibleVestingValue >= requiredCollateral
lenderReady   = escrowedCUSDC >= principal
canActivate   = borrowerReady AND lenderReady
```

Only `canActivate` is decrypted or revealed.

If true:

- Principal is released to borrower.
- Loan state becomes ACTIVE.

If false:

- Loan remains pending until deadline.
- After timeout, escrow unwind/refund is allowed.

## 8. Repayment

Repayment is made in confidential cUSDC.

LoanEscrow records encrypted payment accumulators:

```text
paidAmount
amountDueForPeriod
nextDueDate
currentPeriod
```

Exact due dates are intended to be private to borrower and lender. Timing leaks from public calls are accepted.

## 9. Default

Anyone may call:

```solidity
function checkDefault(uint256 loanId) external;
```

Default predicate:

```text
default = now >= encryptedDueDate + encryptedGracePeriod
       AND paidAmount < encryptedAmountDue
```

Only default result is revealed sufficiently to permit state transition.

If default is true:

- Loan state becomes DEFAULTED.
- Vesting beneficiary/control is reassigned to lender.
- Vested tokens remain subject to vesting.

If default is false:

- No sensitive reason is revealed.
- Optional cooldown may apply.

## 10. Completion

If borrower repays fully:

- Loan state becomes REPAID.
- Vesting control/benefit is returned to borrower.
- Any remaining lender escrow is released according to terms.

## 11. State machines

### Preference state

```text
DRAFT -> ACTIVE -> PENDING_MATCH -> MATCHED -> CONSUMED
                     |              |
                     |              -> EXPIRED/CANCELLED
                     -> ACTIVE/FAILED
```

### Loan state

```text
CREATED -> AWAITING_ESCROW -> ACTIVE -> REPAID
                         |       |
                         |       -> DEFAULTED -> BENEFICIARY_REASSIGNED
                         -> EXPIRED -> UNWOUND
```

## 12. Events

Events must avoid sensitive data.

Suggested events:

```solidity
event PreferenceCreated(bytes32 indexed preferenceId, uint256 indexed accountId, uint8 side, bytes32 coarseBucket);
event MatchAttempted(bytes32 indexed attemptId, uint256 indexed takerAccountId, bytes32 coarseBucket);
event MatchSucceeded(bytes32 indexed attemptId, uint256 indexed loanId);
event MatchFailed(bytes32 indexed attemptId);
event LoanCreated(uint256 indexed loanId);
event LoanActivated(uint256 indexed loanId);
event LoanRepaid(uint256 indexed loanId);
event DefaultChecked(uint256 indexed loanId, bool defaulted);
event BeneficiaryReassigned(uint256 indexed loanId);
```

Do not emit principal, rate, due dates, exact collateral amount, or failure reason.
