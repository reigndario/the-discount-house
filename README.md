> **Unaudited, experimental code. Not for production use.**

# The Discount House

A confidential vesting-backed credit protocol built with Zama fhEVM, OpenZeppelin Confidential Contracts,
ERC-7984 confidential tokens, and TokenOps confidential vesting integration.

The first deployment target is local development and Sepolia testnet.

## What This Builds

A confidential preference book for private credit against vesting positions. Borrowers and lenders publish
coarse public discovery metadata plus encrypted ranked preferences. A taker posts a bond, attempts a bounded
negotiation against the opposite side of the book, and successful matches proceed into bilateral escrow before
activation.

Core properties:

- Native EVM integration boundaries with capability-friendly lifecycle calls
- Encrypted ranked preferences with coarse public discovery buckets
- Failed-attempt bonds to deter private preference probing
- TokenOps vesting custody adapter for vesting-backed collateral
- ERC-7984-compatible confidential cUSDC integration path
- Explicit local/Sepolia separation for fhEVM mock versus real encrypted execution

## Current State

Implemented and tested:

- `ConfidentialPreferenceBook`
- `NashNegotiationEngine`
- `MatchSettlementCoordinator`
- `BondManager`
- `TokenOpsVestingAdapter`
- `LoanEscrowFactory`
- `LoanEscrow`
- TokenOps manager mock for local custody invariant tests
- Confidential credit adapter mock for local funding/repayment invariant tests
- ERC-7984 callback credit adapter using OpenZeppelin receiver, fhEVM encrypted types, and encrypted amount equality
- ERC-7984 cUSDC project interface
- TypeScript protocol SDK helpers for bundle construction, coarse buckets, term hashes, and bond quotes

Validated on Sepolia:

- Fresh non-default-wallet core deployment and read-only wiring checks
- TokenOps CTTT manager creation through the official TokenOps factory
- TokenOps CTTT vesting custody, pledge registration, release, zero vesting ID compatibility, and unpledged custody recovery
- ERC-7984 `cUSDCMock` correct-amount and wrong-amount callback handling, public-decryption finalization, retry, consumption, reusable lender credit custody, funding, repayment, and public unwrap/finalize into underlying `USDCMock`
- Browser-style encrypted Preference Bundle submission through the relayer proof path
- Encrypted match execution, selected-term computation, aggregate feasibility finalization, settlement coordinator escrow creation, matched escrow repayment, and failed-match bond slashing
- Post-rotation end-to-end smoke test: lender escrowed confidential cUSDC, loan activated, borrower unwrapped exactly `1000` `USDCMock`

Reference / deferred:

- `ProtocolAccountRegistry`

Next:

- Manual browser-wallet validation for the current match, TokenOps, and ERC-7984 escrow paths
- Durable indexing beyond the current UI lookback cache
- Final security, dependency, and deployment hardening pass

## Setup

```
npm ci
npm run compile
npm test
npm run demo:local
```

`npm run demo:local` executes the protocol path without testnet: create borrower/lender preference bundles, run
bounded matching, post/refund a bond, create a loan escrow, register mock TokenOps collateral, fund, activate,
and repay.

## Local Deployment Smoke Test

The reliable local deployment path is the in-process Hardhat network:

```
npm run deploy:hardhat
```

Expected core deployments:

- `ConfidentialPreferenceBook`
- `NashNegotiationEngine`
- `TokenOpsVestingAdapter`
- `LoanEscrowFactory`
- `MockConfidentialCreditAdapter`
- `ERC7984CreditAdapter`
- `BondManager`
- `MatchSettlementCoordinator`

## Long-Running Local Node

Terminal 1:

```
npm run chain
```

Terminal 2:

```
npm run deploy:localhost
npm run manifest:localhost
```

The manifest command writes `public/deployment-manifest.json` for local UI/SDK wiring. That generated file is
ignored by git; `public/deployment-manifest.example.json` defines the checked-in schema.

## Browser Preview

The browser-testable UI lives in `public/`. It supports borrower/lender perspective switching, ranked preference
construction, bucket discovery, bond quote calculation, and contract-aware builder submission. It loads
`public/deployment-manifest.json` and can submit the active builder bundle to `ConfidentialPreferenceBook` when
a wallet is connected on the manifest chain. Sepolia loan settlement controls that still require mock collateral
or mock credit are disabled rather than routed to those mocks.

Serve it with:

```
python3 -m http.server 8080 --bind 0.0.0.0 --directory public
```

## Sepolia

Set Hardhat vars before deploying:

```
npx hardhat vars set MNEMONIC
npx hardhat vars set INFURA_API_KEY
npx hardhat vars set ETHERSCAN_API_KEY
CVC_ERC7984_TOKEN_ADDRESS=0x... npm run deploy:sepolia
```

## Architecture

See:

- `docs/ARCHITECTURE.md`
- `docs/INTEGRATION_RISKS.md`
- `docs/PRE_TESTNET_RUNBOOK.md`

## Security Notes

This code is unaudited and is not for production use.

This repository uses the official Zama Hardhat template. Local Hardhat tests use the Zama mock runtime, while
Sepolia testing exercises real fhEVM network behavior. Any feature that relies on ACLs, encrypted comparison,
relayer behavior, or gateway decryption must be validated on Sepolia before public demonstration.

The dependency tree currently includes npm audit findings inherited from the upstream template and ecosystem
packages. They are tracked as launch blockers until resolved, upgraded, or explicitly risk-accepted.
