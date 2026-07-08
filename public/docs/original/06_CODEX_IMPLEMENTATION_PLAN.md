# Codex Implementation Plan

## 1. Goal

Build a working prototype that is structured like a production system, with contracts, SDK wrappers, tests, and a minimal UI. Prioritize correctness and explicit trust boundaries over gas optimization.

## 2. Repository layout

```text
confidential-vesting-credit/
  contracts/
    src/
      ProtocolAccountRegistry.sol
      ConfidentialPreferenceBook.sol
      NashNegotiationEngine.sol
      LoanEscrowFactory.sol
      LoanEscrow.sol
      BondManager.sol
      TokenOpsVestingAdapter.sol
      interfaces/
        IERC7984Like.sol
        ITokenOpsVestingManager.sol
        IConfidentialCUSDC.sol
    test/
      unit/
      integration/
      invariants/
    script/
  sdk/
    src/
      accounts.ts
      preferences.ts
      negotiation.ts
      loans.ts
      tokenopsAdapter.ts
      encryption.ts
  app/
    src/
      pages-or-routes/
      components/
      hooks/
      lib/
  docs/
    architecture/
    protocol/
    security/
```

## 3. Milestones

### Milestone 1 — Project skeleton

- Initialize Solidity project.
- Add Zama/fhEVM dependencies.
- Add OpenZeppelin Confidential Contracts dependency.
- Add TokenOps SDK in frontend/SDK layer.
- Add testing framework.

Acceptance:

- Contracts compile.
- Basic local test harness runs.

### Milestone 2 — Protocol accounts

Implement `ProtocolAccountRegistry`.

Acceptance:

- Create account.
- Add/remove wallet.
- Check roles.
- Tests for unauthorized access.

### Milestone 3 — Preference book

Implement `ConfidentialPreferenceBook`.

Acceptance:

- Create borrower/lender preference set.
- Store encrypted handles/placeholders.
- Store public coarse metadata.
- Cancel/expire/supersede preferences.

### Milestone 4 — Bond manager

Implement match-attempt bond logic.

Acceptance:

- Taker posts bond.
- Successful attempt refunds bond.
- Failed attempt slashes bond.
- Slashed bond split between probed counterparties and treasury.
- Thin market multiplier supported.

### Milestone 5 — Nash negotiation engine

Implement bounded ranked-constraint evaluation.

MVP may first use mock encrypted values locally, then replace with fhEVM encrypted types.

Acceptance:

- Evaluates bounded candidate set.
- Selects highest Nash-style rank product.
- Handles ties deterministically.
- Reveals only success/failure and selected private term handles.

### Milestone 6 — TokenOps vesting adapter

Implement adapter interface and integration tests.

Acceptance:

- Confirm vesting can be transferred to smart contract escrow.
- Confirm escrow can transfer/reassign according to default outcome.
- Confirm encrypted vesting amount access pattern.
- Document any gap requiring adapter workaround.

### Milestone 7 — Loan escrow

Implement `LoanEscrowFactory` and `LoanEscrow`.

Acceptance:

- Initialize loan from successful match.
- Borrower escrows vesting.
- Lender escrows confidential cUSDC.
- Encrypted sufficiency check gates activation.
- Principal released only after activation.

### Milestone 8 — Repayment/default

Implement confidential repayment tracking and default reassignment.

Acceptance:

- Borrower pays confidential cUSDC.
- Loan records encrypted payment state.
- Anyone can call default check.
- Default false reveals no reason.
- Default true reassigns vesting to lender.
- Repaid loan returns vesting/control to borrower.

### Milestone 9 — Minimal UI

Build ranked constraints UI.

Acceptance:

- Protocol account creation.
- Borrower/lender preference cards.
- Drag-and-drop ranking.
- Public bucket discovery.
- Match attempt flow with bond.
- Loan status page.

### Milestone 10 — Security/invariant tests

Acceptance:

- No activation without bilateral escrow.
- No double pledge.
- No principal release before activation.
- No default after repayment.
- Slashing/refund logic correct.
- Events do not leak sensitive values.

## 4. Initial Solidity interface sketch

```solidity
interface IProtocolAccountRegistry {
    function createAccount(address initialOwner) external returns (uint256 accountId);
    function hasRole(uint256 accountId, address wallet, bytes32 role) external view returns (bool);
}

interface IConfidentialPreferenceBook {
    function createPreferenceSet(bytes calldata encryptedPreferences, bytes32 coarseBucket, uint8 side, uint64 expiry) external returns (bytes32 preferenceId);
    function cancelPreferenceSet(bytes32 preferenceId) external;
}

interface INashNegotiationEngine {
    function attemptMatch(bytes32 takerPreferenceId, bytes32[] calldata makerPreferenceIds) external payable returns (bytes32 attemptId);
}

interface ILoanEscrow {
    function escrowVesting(bytes calldata tokenOpsTransferData) external;
    function escrowFunding(bytes calldata encryptedAmountTransferData) external;
    function activate() external;
    function repay(bytes calldata encryptedPaymentData) external;
    function checkDefault() external;
}
```

## 5. Implementation guidance

- Do not optimize gas prematurely.
- Keep candidate set small and bounded.
- Use explicit algorithm versioning.
- Use typed wrappers for encrypted handles.
- Avoid emitting sensitive data.
- Treat TokenOps integration as an adapter boundary.
- Write tests before complex integration.

## 6. Open implementation questions

- Exact TokenOps contract-level transfer call semantics for smart-contract recipients.
- Exact ERC-7984 confidential cUSDC implementation to use in tests.
- Best Zama test harness for encrypted comparisons/decryption callbacks.
- Whether default check needs asynchronous gateway request/fulfillment split.
- Whether due dates can be encrypted in the desired form, or require epoch encoding.

## 7. Definition of done for prototype

A prototype is complete when a borrower and lender can:

1. Create protocol accounts.
2. Submit private ranked preferences.
3. Attempt match with bond.
4. Negotiate a successful match using bounded Nash approximation.
5. Escrow vesting and cUSDC.
6. Activate loan.
7. Repay or default.
8. On default, transfer vesting benefit/control to lender.
