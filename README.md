# WARNING: UNAUDITED, EXPERIMENTAL CODE; NOT FOR PRODUCTION

# Confidential Vesting Credit

An experimental confidential vesting-backed credit protocol built with Zama fhEVM, OpenZeppelin Confidential Contracts,
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

Next major slices:

- Sepolia validation for ERC-7984 balance-level refund accounting and escrow funding/repayment wiring
- Sepolia TokenOps integration with real collateral positions
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
- `MockConfidentialCreditAdapter`
- `ERC7984CreditAdapter`
- `BondManager`
- `MatchSettlementCoordinator`

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

Set Hardhat vars before deploying:

```bash
npx hardhat vars set MNEMONIC
npx hardhat vars set INFURA_API_KEY
npx hardhat vars set ETHERSCAN_API_KEY
CVC_ERC7984_TOKEN_ADDRESS=0x... npm run deploy:sepolia
```

`CVC_ERC7984_TOKEN_ADDRESS` must be the deployed ERC-7984 confidential cUSDT/cUSDC token address. The current Sepolia
manifest uses canonical `cUSDCMock` at `0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639`, and the deployed
`ERC7984CreditAdapter` at `0x53143CBC61A9d64c19551a247Fa6d31c2Cc2aecB` has passed live correct-amount and wrong-amount
callback, public-decryption finalization, adapter retry, and consumption smokes.

Sepolia integration is still gated on real TokenOps collateral configuration, ERC-7984 escrow funding/repayment wiring,
encrypted match execution, and UI loan settlement wiring.

## Architecture

See:

- `docs/ARCHITECTURE.md`
- `docs/INTEGRATION_RISKS.md`
- `docs/PRE_TESTNET_RUNBOOK.md`

## Security Notes

This repository uses the official Zama Hardhat template. Local Hardhat tests use the Zama mock runtime, while Sepolia
testing exercises real fhEVM network behavior. Any feature that relies on ACLs, encrypted comparison, relayer behavior,
or gateway decryption must be validated on Sepolia before public demonstration.

The dependency tree currently includes npm audit findings inherited from the upstream template and ecosystem packages.
They are tracked as launch blockers until resolved, upgraded, or explicitly risk-accepted.
