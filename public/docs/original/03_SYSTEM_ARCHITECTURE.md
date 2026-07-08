# System Architecture Specification

## 1. Component overview

```text
Frontend / SDK Layer
  - React / Next.js app
  - Wallet integration
  - TokenOps SDK integration
  - Zama encryption/decryption helpers
  - Preference-card UX

Protocol Contracts
  - ProtocolAccountRegistry
  - ConfidentialPreferenceBook
  - NashNegotiationEngine
  - LoanEscrowFactory
  - LoanEscrow
  - BondManager
  - TokenOpsVestingAdapter

External / Library Contracts
  - TokenOps confidential vesting managers
  - ERC-7984 confidential cUSDC
  - OpenZeppelin Confidential Contracts
  - Zama fhEVM / gateway / ACL infrastructure

Indexer / Off-chain Services
  - Public coarse book index
  - Event processor
  - UI cache
  - Optional future routing / reputation service
```

## 2. Protocol account model

### ProtocolAccountRegistry

Responsibilities:

- Create protocol accounts.
- Link wallets to accounts.
- Support role-based permissions: owner, operator, viewer, recovery, future compliance role.
- Store non-sensitive account metadata.
- Provide account IDs for preferences and loans.

Suggested methods:

```solidity
function createAccount(address initialOwner) external returns (uint256 accountId);
function addWallet(uint256 accountId, address wallet, bytes32 role) external;
function removeWallet(uint256 accountId, address wallet) external;
function hasAccountRole(uint256 accountId, address wallet, bytes32 role) external view returns (bool);
```

## 3. Confidential preference book

Stores encrypted ranked constraints and public coarse metadata.

### Public metadata

- Account ID or account commitment.
- Side: borrower or lender.
- Asset/vesting class bucket.
- Principal bucket.
- Duration bucket.
- Expiry.
- Status.
- Optional dealability tier.

### Private/encrypted metadata

- Ranked constraints.
- Exact principal limits.
- Exact interest limits.
- Exact duration limits.
- Exact grace period limits.
- Internal match state.

## 4. NashNegotiationEngine

The engine evaluates a bounded candidate set. Candidate sets are selected from public coarse buckets in MVP.

Inputs:

- Taker preference set.
- Candidate maker preference sets.
- Protocol algorithm version.
- Bond proof.

Outputs:

- Public: match found true/false.
- Private to matched parties: selected term package.
- Internal: matched preference IDs, encrypted term handles, activation record.

## 5. LoanEscrow

Each successful match creates or initializes a loan escrow instance.

Responsibilities:

- Receive/control TokenOps vesting position.
- Receive confidential cUSDC funding.
- Verify bilateral sufficiency.
- Release principal to borrower.
- Track encrypted repayment obligations.
- Evaluate default.
- Reassign vesting beneficiary/control on default.
- Return vesting/control to borrower on repayment.

## 6. TokenOpsVestingAdapter

Responsibilities:

- Abstract TokenOps manager/vesting calls.
- Normalize transfer/reassignment logic.
- Verify escrow custody/control.
- Provide encrypted amount handles when available.
- Provide ACL grants to borrower/lender/escrow as needed.

Integration assumption:

TokenOps docs list transfer hooks, including direct transfer, and describe confidential vesting where amounts are encrypted while schedules are plaintext. The adapter must confirm actual smart-contract-level call semantics during implementation.

## 7. BondManager

Responsibilities:

- Collect match-attempt bonds.
- Determine bond requirement using batch size and risk parameters.
- Refund successful attempts.
- Slash failed attempts.
- Split slashed bonds between probed counterparties and protocol treasury.

Thin market rule:

```text
requiredBatchSize = min(configuredMinBatchSize, availableCounterpartiesInBucket)
```

If available counterparties are fewer than the target minimum, the attempt must include all available counterparties in the bucket and may require a higher bond.

## 8. Data privacy boundaries

### Hidden by fhEVM / ACL design

- Amounts.
- Ranked constraints.
- Negotiated terms.
- Repayment amounts.
- Default thresholds.

### Not hidden in MVP

- Transactions exist.
- Caller addresses unless abstracted.
- Interaction timing.
- Some TokenOps schedule metadata may be plaintext depending on integration.
- Successful default/reassignment occurrence.

## 9. External facts / integration notes

OpenZeppelin documents ERC-7984 as confidential fungible tokens with ciphertext handles for balances and transfer amounts. TokenOps docs describe confidential vesting with encrypted handles and ACL-controlled views, while stating schedules live on-chain in plaintext. TokenOps docs also list transfer-related vesting hooks.
