# WARNING: UNAUDITED, EXPERIMENTAL CODE; NOT FOR PRODUCTION

# Acknowledgements:
Ashton Anchors for the Dragon Lore https://github.com/ashton-anchors/zahak-dragons

Together we borked the git history so, there's basically a copy of it in this repo 🤷

# ZAHAK - Confidential Vesting Credit

An experimental confidential vesting-backed credit protocol built with Zama fhEVM, OpenZeppelin Confidential Contracts,
ERC-7984 confidential tokens, and TokenOps confidential vesting integration.

The first deployment target is local development and Sepolia testnet. 

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

Recently validated on Sepolia:

- fresh non-default-wallet core deployment and read-only wiring checks
- TokenOps CTTT manager creation through the official TokenOps factory
- TokenOps CTTT vesting custody, pledge registration, release, zero vesting ID compatibility, and unpledged custody
  recovery
- ERC-7984 `cUSDCMock` correct-amount and wrong-amount callback handling, public-decryption finalization, retry,
  consumption, reusable lender credit custody, funding, repayment, and public unwrap/finalize into underlying `USDCMock`
- browser-style encrypted Preference Bundle submission through the relayer proof path
- encrypted match execution, selected-term computation, aggregate feasibility finalization, settlement coordinator
  escrow creation, matched escrow repayment, and failed-match bond slashing
- post-rotation end-to-end smoke where a lender escrowed confidential cUSDC, a loan activated, and the borrower
  unwrapped exactly `1000` `USDCMock`


Reference / deferred:

- `ProtocolAccountRegistry`

Next major slices:

manual browser-wallet validation for the current match, TokenOps, and ERC-7984 escrow paths
- durable indexing beyond the current UI lookback cache
- final security, dependency, and deployment hardening pass

## Setup

```bash
npm ci
npm run compile
npm test
npm run demo:local
```

`npm run demo:local` executes the protocol path without testnet: create borrower/lender preference bundles, run bounded
matching, post/refund a bond, create a loan escrow, register mock TokenOps collateral, fund, activate, and repay.

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

Current Sepolia deployment:

| Component                          | Address                                      |
| ---------------------------------- | -------------------------------------------- |
| Deployer/operator wallet           | `0xA27935e8958bd65aFD6F28eee115e3883eafF03D` |
| `ConfidentialPreferenceBook`       | `0x882Da9cB5BD5DA4cCB58d91040d60dCC50183Ecb` |
| `NashNegotiationEngine`            | `0x7267122A75B7a7890AF9ac4003a737FFF22e9150` |
| `TokenOpsVestingAdapter`           | `0xc92c61ebdaC716238AF4D70A2696663D16220B94` |
| `LoanEscrowFactory`                | `0x5c81d01795D36642A4137643F8D11fE956567d85` |
| `ERC7984CreditAdapter`             | `0xF832f4c797eE146198a79EdfB0E0B2Ac82ccE3F2` |
| `BondManager`                      | `0x390feeFCA76d7ff56fcA0fCC74873A70fAbb24F7` |
| `MatchSettlementCoordinator`       | `0xA73aF9DbFfACB115090452E17a11F85931359Ce1` |
| ERC-7984 confidential credit token | `0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639` |
| TokenOps CTTT collateral token     | `0x258F9D60dc023870e4E3109c894D834D5377361a` |
| CVC TokenOps CTTT vesting manager  | `0xb32208BF362b48672cAf58C52Ee45908e3cc6333` |

Sepolia integration is no longer blocked on TokenOps collateral configuration. Real TokenOps custody/release and
ERC-7984 credit paths have script-level Sepolia validation, including a post-rotation end-to-end match smoke. The
remaining gate is manual browser-wallet validation plus any durable indexing requirements beyond the current UI lookback
cache.

## Architecture

See:

- `docs/ARCHITECTURE.md`
- `docs/INTEGRATION_RISKS.md`
- `docs/PRE_TESTNET_RUNBOOK.md`

## Security Notes

This code is unaudited and not for educational purposes only, not production use.

This repository uses the official Zama Hardhat template. Local Hardhat tests use the Zama mock runtime, while Sepolia
testing exercises real fhEVM network behavior. Any feature that relies on ACLs, encrypted comparison, relayer behavior,
or gateway decryption must be validated on Sepolia before public demonstration.

The dependency tree currently includes npm audit findings inherited from the upstream template and ecosystem packages.
They are tracked as launch blockers until resolved, upgraded, or explicitly risk-accepted.

## Validation

Does this work? As far as testnet goes, yes! Borrower trace on BlockScout: https://eth-sepolia.blockscout.com/address/0x5A57034b97253a4d205698B685DB78a9Ca9C5ef1?tab=txs 
