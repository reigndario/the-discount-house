# Confidential Vesting Credit

Production-grade confidential vesting-backed credit protocol built with Zama fhEVM, OpenZeppelin Confidential Contracts,
ERC-7984 confidential tokens, and TokenOps confidential vesting integration.

The first deployment target is local development and Sepolia testnet. Testnet deployment is a safety and regulatory
constraint; the software quality bar is launch-ready.

## What This Builds

This is a confidential preference book for private credit against vesting positions. Borrowers and lenders publish
coarse public discovery metadata plus encrypted ranked preferences. A taker posts a bond, attempts a bounded negotiation
against the opposite side of the book, and successful matches proceed into bilateral escrow before activation.

Core properties:

- native EVM integration boundaries with capability-friendly lifecycle calls
- encrypted ranked preferences with coarse public discovery buckets
- failed-attempt bonds to deter private preference probing
- TokenOps vesting custody adapter for vesting-backed collateral
- ERC-7984-compatible confidential cUSDC integration path
- explicit local/Sepolia separation for fhEVM mock versus real encrypted execution

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
- confidential credit adapter mock for local funding/repayment invariant tests
- ERC-7984 callback credit adapter using OpenZeppelin receiver, fhEVM encrypted types, and encrypted amount equality
- ERC-7984 cUSDC project interface
- TypeScript protocol SDK helpers for bundle construction, coarse buckets, term hashes, and bond quotes

Reference / deferred:

- `ProtocolAccountRegistry`

Recently validated on Sepolia:

- ERC-7984 funding and repayment through `LoanEscrow`
- TokenOps CTTT vesting custody, pledge registration, release, and zero vesting ID compatibility
- TokenOps unpledged custody recovery
- reusable ERC-7984 lender credit commitments backed by adapter-held confidential cUSDC
- borrower confidential-USD release on activation and lender confidential-USD release on repayment
- browser-style encrypted Preference Bundle submission through Zama relayer proof verification
- encrypted match execution, selected-term computation, aggregate feasibility finalization, coordinator settlement, and
  matched escrow lifecycle on Sepolia

Next major slices:

- UI match and loan settlement wiring against the live contracts

## Setup

```bash
npm ci
npm run compile
npm test
npm run demo:local
```

`npm run demo:local` executes the protocol path without testnet: create borrower/lender preference bundles, preview a
match, post/refund a bond, create a loan escrow, register mock TokenOps collateral, fund, activate, and repay.

## Local Deployment Smoke Test

The reliable local deployment path is the in-process Hardhat network:

```bash
npm run deploy:hardhat
```

Expected core deployments:

- `ConfidentialPreferenceBook`
- `NashNegotiationEngine`
- `TokenOpsVestingAdapter`
- `LoanEscrowFactory`
- `ERC7984CreditAdapter`
- `BondManager`
- `MatchSettlementCoordinator`

Local `hardhat`, `localhost`, and `anvil` deployments also include `MockTokenOpsVestingManager` and
`MockConfidentialCreditAdapter` for local placeholder flows. Production-like networks skip those mocks unless
`CVC_DEPLOY_MOCKS=true`.

## Long-Running Local Node

Terminal 1:

```bash
npm run chain
```

Terminal 2:

```bash
npm run deploy:localhost
npm run manifest:localhost
```

The manifest command writes `public/deployment-manifest.json` for local UI/SDK wiring. That generated file is ignored by
git; `public/deployment-manifest.example.json` defines the checked-in schema.

## Browser Preview

The browser-testable UI lives in `public/`. It supports borrower/lender perspective switching, ranked preference
construction, bucket discovery, bond quote calculation, and contract-aware builder submission. It also loads
`public/deployment-manifest.json` and can submit the active builder bundle to `ConfidentialPreferenceBook` when a wallet
is connected on the manifest chain. Sepolia loan settlement controls that still require mock collateral or mock credit
are disabled rather than routed to those mocks.

Serve it with:

```bash
python3 -m http.server 8080 --bind 0.0.0.0 --directory public
```

## Sepolia

Do not use the Hardhat default mnemonic on Sepolia. It is public and only acceptable on isolated local chains. Use a
fresh private project mnemonic or private key for deployers, operators, and smoke-test actors.

Set Hardhat vars before deploying:

```bash
npx hardhat vars set MNEMONIC
npx hardhat vars set INFURA_API_KEY
npx hardhat vars set ETHERSCAN_API_KEY
CVC_ERC7984_TOKEN_ADDRESS=0x... npm run deploy:sepolia
```

`CVC_ERC7984_TOKEN_ADDRESS` must be the deployed ERC-7984 confidential cUSDT/cUSDC token address. The current Sepolia
manifest uses canonical `cUSDCMock` at `0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639`, and the deployed
`ERC7984CreditAdapter` at `0xF832f4c797eE146198a79EdfB0E0B2Ac82ccE3F2` is part of the fresh non-default-wallet
deployment. Read-only wiring checks have passed on the fresh deployment; correct-amount and wrong-amount callback,
public-decryption finalization, adapter retry, and consumption smokes passed on the same code path before wallet
rotation and should be rerun before final demo signoff.

Sepolia integration has validated real TokenOps collateral custody and recovery, ERC-7984 escrow funding/repayment,
reusable escrowed confidential lender credit, borrower confidential-USD drawdown on activation, lender repayment
release, encrypted preference submission, encrypted match execution, aggregate feasibility public decryption, settlement
coordinator escrow creation, matched escrow repayment, failed-match bond slashing, and public unwrap/finalize of the
current `cUSDCMock` wrapper into underlying `USDCMock`. It is still gated on manual browser-wallet testing and any
durable indexing needs beyond the current UI lookback.

## Architecture

See:

- `docs/ARCHITECTURE.md`
- `docs/INTEGRATION_RISKS.md`
- `docs/LIVE_MATCH_ORCHESTRATION.md`
- `docs/PRE_TESTNET_RUNBOOK.md`

## Security Notes

This repository uses the official Zama Hardhat template. Local Hardhat tests use the Zama mock runtime, while Sepolia
testing exercises real fhEVM network behavior. Any feature that relies on ACLs, encrypted comparison, relayer behavior,
or gateway decryption must be validated on Sepolia before public demonstration.

The dependency tree currently includes npm audit findings inherited from the upstream template and ecosystem packages.
They are tracked as launch blockers until resolved, upgraded, or explicitly risk-accepted.
