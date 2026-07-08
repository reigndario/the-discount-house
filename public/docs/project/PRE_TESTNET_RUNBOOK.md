# Pre-Testnet Runbook

This runbook keeps local validation and Sepolia preparation separate. Testnet deployment is intentionally last because
the protocol should be locally coherent before it touches public infrastructure.

## Critical Wallet Policy

Never use the Hardhat default mnemonic (`test test test test test test test test test test test junk`) on Sepolia or
any public network. It is a public, documented test mnemonic and all derived addresses must be treated as compromised
outside isolated local chains. This includes deployers, operators, borrower/lender smoke actors, demo wallets, faucets,
and admin wallets.

The default mnemonic is acceptable only for local disposable networks such as `hardhat`, `localhost`, or `anvil`.
Sepolia work requires a fresh private project mnemonic or private key. If a deployed public-network contract is owned
by a default-derived address, migrate ownership/roles/funds to a non-default wallet before continuing public-network
operations. `hardhat.config.ts` intentionally refuses `--network sepolia` when the configured mnemonic is the Hardhat
default.

## Local Contract Validation

Run the deterministic local checks:

```bash
npm run compile
npm run build:ts
npm run lint
npm test
```

The fhEVM encrypted local demo needs a running Hardhat node because the Zama CLI encryption API supports `localhost` and
Sepolia, not the ephemeral in-process Hardhat network:

```bash
npm run chain
npx hardhat run scripts/local-protocol-demo.ts --network localhost
```

The local demo executes the core path on the persistent local chain: encrypted preference bundles, backing activation,
bond posting, execute-only matching, bond refund, loan escrow creation, mock TokenOps collateral using the same
pending-transfer custody shape as TokenOps, mock confidential funding, activation, repayment, and collateral release.

## Local Deployment Manifest

For browser or SDK work against a local Hardhat node:

```bash
npm run chain
npm run deploy:localhost
npm run manifest:localhost
```

`npm run manifest:localhost` writes `public/deployment-manifest.json`. That generated file is ignored by git. The
checked-in `public/deployment-manifest.example.json` defines the schema expected by UI/wallet wiring.

The browser can submit real encrypted Preference Bundles when the relayer SDK can create an FHEVM instance for the
manifest chain. Sepolia uses the SDK's built-in Zama config. Localhost/custom networks must include a manifest `fhevm`
object, generated from:

```bash
CVC_FHEVM_RELAYER_URL=...
CVC_FHEVM_ACL_ADDRESS=...
CVC_FHEVM_KMS_ADDRESS=...
CVC_FHEVM_INPUT_VERIFIER_ADDRESS=...
CVC_FHEVM_VERIFY_DECRYPTION_ADDRESS=...
CVC_FHEVM_VERIFY_INPUT_ADDRESS=...
CVC_FHEVM_GATEWAY_CHAIN_ID=...
```

`CVC_COLLATERAL_TOKEN_ADDRESS` and `CVC_TOKENOPS_MANAGER_ADDRESS` can override the local mock asset/manager addresses in
the manifest. Without a relayer config on localhost, the UI keeps saving bundles locally instead of faking encrypted
contract input.

Deprecated: the temporary public local-RPC gateway and local faucet have been removed from the public web service now
that Sepolia validation is active. If local testing is needed again, keep the Hardhat node on `127.0.0.1:8545` and do
not expose RPC or faucet routes through the public UI service.

For an in-process smoke deployment without a persistent node:

```bash
npm run deploy:hardhat
npm run manifest:hardhat
```

## UI State

The hosted UI implements the current Sepolia-facing surface:

- a global Borrower/Lender role toggle in the top bar
- `Book` as the public coarse bucket discovery page
- `Builder` as the browser-local bundle authoring and encrypted preference-submission page
- `Loans` as the role-aware execution surface and escrow lifecycle page
- `System` as manifest, wallet, contract, and docs/status wiring

The preference builder includes local bundle labels, drag-ordered local bundle cards, collateral and principal ranges,
implied collateral exchange-rate display, directional preference controls, and the five-axis priority polygon. Labels
and ordering are intentionally browser-local. The UI loads `public/deployment-manifest.json`, initializes the Zama
browser relayer SDK, encrypts the active bundle fields, and submits the resulting handles/proof to
`ConfidentialPreferenceBook.createPreferenceBundle` when the manifest chain has usable relayer config.

The `Loans` page is the live execution surface. It scans recent public bucket and loan events, lets the connected user
attempt a role-aware match against an opposite-side bucket, and can drive live-match-created escrows through the real
TokenOps and ERC-7984 actions. This browser path still needs manual wallet validation, but the equivalent Sepolia smoke
scripts have proven relayer finality, KMS public-decryption proof handling, TokenOps custody semantics, ERC-7984
confidential credit callbacks, successful settlement, failed-match bond slashing, and matched escrow repayment.

The local contracts still contain an execute-only matching and settlement path for protocol validation: post a bond
through `BondManager`, call `NashNegotiationEngine.executeMatch`, compute selected encrypted term handles with
`computeSelectedTerm`, call `commitEncryptedTerms`, publicly decrypt and verify only the aggregate encrypted feasibility
bit through `finalizeMatchFeasibility`, then settle through `MatchSettlementCoordinator`. If aggregate feasibility
finalizes false, `MatchSettlementCoordinator.settleFailedMatch` slashes the posted bond and no field-level mismatch
reason is exposed. This path remains a testnet validation target, not a public UI feature.

Successful settlement binds the escrow to both `termsHash` and `encryptedTermsHash`, and rejects borrower/lender
addresses that do not match the matched Preference Bundle managers. Exact principal and repayment amounts are not stored
as public escrow fields; the escrow stores opaque funding and repayment authorization commitments and lifecycle
booleans. The browser keeps exact economics only in local state for the connected user/demo session.

Two browser paths are explicit local placeholders and emit console warnings on local networks:

- TokenOps collateral setup uses `MockTokenOpsVestingManager` for browser-local loan controls. Contract tests and the
  local protocol demo use pending transfer initiation, adapter acceptance, release initiation, recipient acceptance, and
  adapter `completeRelease`; real TokenOps position creation and custody remain a Sepolia validation item.
- Funding and repayment use `MockConfidentialCreditAdapter` cleartext authorizations against the escrow's opaque
  authorization commitments. Real ERC-7984 confidential transfer callbacks, encrypted amounts, and refund/rejection
  behavior remain testnet validation items.

On Sepolia, the UI uses configured real TokenOps collateral plus `ERC7984CreditAdapter` for live-match-created escrows
and disables any mock-backed loan settlement action instead of routing it to deployed mock contracts.

The local Preference Book does not accept a lender-side backing hash by itself anymore. The configured credit adapter
must also report the commitment executable for the lender manager. In the ERC-7984 adapter, the commitment is executable
only after the lender has transferred confidential credit into adapter custody for the same commitment hash. Sepolia
validation passed against the public testnet manifest.

## Sepolia Gate

Current Sepolia gate status:

- current Sepolia deployer/operator wallet: `0xA27935e8958bd65aFD6F28eee115e3883eafF03D`
- fresh non-default-wallet redeploy completed on 2026-07-07; read-only wiring checks passed for owner, matcher,
  settlement authorization, coordinator dependencies, and the ERC-7984 token binding
- post-rotation 1000 cUSDC end-to-end match smoke passed on 2026-07-07: lender escrowed confidential cUSDC, the loan
  activated, and borrower `0x28a3AB78965D4B5CA925c8bce8e6d1338D976862` unwrapped exactly `1000` `USDCMock`
- deeper live smokes listed below were validated on this code path before wallet rotation and should be rerun against
  the fresh deployment before final demo signoff
- `ConfidentialPreferenceBook` is deployed at `0x882Da9cB5BD5DA4cCB58d91040d60dCC50183Ecb`
- `NashNegotiationEngine` is deployed at `0x7267122A75B7a7890AF9ac4003a737FFF22e9150`
- `CVC_ERC7984_TOKEN_ADDRESS` is currently canonical Sepolia `cUSDCMock`: `0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639`
- `ERC7984CreditAdapter` is deployed at `0xF832f4c797eE146198a79EdfB0E0B2Ac82ccE3F2`
- `CVC_COLLATERAL_TOKEN_ADDRESS` is TokenOps Sepolia CTTT: `0x258F9D60dc023870e4E3109c894D834D5377361a`
- `CVC_TOKENOPS_MANAGER_ADDRESS` is the CVC CTTT vesting manager: `0xb32208BF362b48672cAf58C52Ee45908e3cc6333`
- `TokenOpsVestingAdapter` is deployed at `0xc92c61ebdaC716238AF4D70A2696663D16220B94`
- `LoanEscrowFactory` is deployed at `0x5c81d01795D36642A4137643F8D11fE956567d85`
- `BondManager` is deployed at `0x390feeFCA76d7ff56fcA0fCC74873A70fAbb24F7`
- `MatchSettlementCoordinator` is deployed at `0xA73aF9DbFfACB115090452E17a11F85931359Ce1`
- correct-amount confidential callback, wrong-amount callback rejection, public decryption finalization, adapter retry,
  and adapter consumption are validated on Sepolia
- reusable ERC-7984 lender credit custody and binding are validated on Sepolia
- ERC-7984 funding and repayment through `LoanEscrow`, including borrower and lender confidential cUSDC release, are
  validated on Sepolia
- browser-style encrypted Preference Bundle submission is validated on Sepolia through the relayer proof path
- TokenOps manager creation through the official TokenOps factory is validated on Sepolia
- TokenOps CTTT vesting custody, pledge registration, release, and `bytes32(0)` vesting ID compatibility are validated
  on Sepolia
- TokenOps unpledged custody recovery is validated on Sepolia
- encrypted match execution, selected-term computation, aggregate feasibility finalization,
  `MatchSettlementCoordinator.settleSuccessfulMatch`, and matched escrow repayment are validated on Sepolia
- failed encrypted-match finalization and `MatchSettlementCoordinator.settleFailedMatch` bond slashing are validated on
  Sepolia
- public unwrap/finalize of the current `cUSDCMock` wrapper into underlying `USDCMock` is validated on Sepolia
- regenerate manifest after deploy with `npm run manifest:sepolia`

Create or reuse the canonical TokenOps manager with:

```bash
set -a; source .secrets/sepolia-deployer.env; set +a
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com npm run tokenops:manager:sepolia
```

Then regenerate the manifest with real asset addresses:

```bash
CVC_PUBLIC_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com \
CVC_ERC7984_TOKEN_ADDRESS=0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639 \
CVC_COLLATERAL_TOKEN_ADDRESS=0x258F9D60dc023870e4E3109c894D834D5377361a \
CVC_TOKENOPS_MANAGER_ADDRESS=0xb32208BF362b48672cAf58C52Ee45908e3cc6333 \
npm run manifest:sepolia
```

Sepolia must still validate behavior that local mocks cannot prove:

- balance-level refund accounting after wrong-amount ERC-7984 callback failure
- deployed-token refund or rejection behavior after callback false
- manual wallet behavior for the validated match, TokenOps, and ERC-7984 escrow paths
- live UI discovery/indexing for public buckets, backing readiness, match attempts, and loans
- production behavior if a future selected confidential USD token does not implement `IERC7984ERC20Wrapper`

## Sepolia ETH Budget

The current localhost deployment receipts total about `8,982,938` gas for:

- `ConfidentialPreferenceBook`
- `NashNegotiationEngine`
- `TokenOpsVestingAdapter`
- `LoanEscrowFactory`
- `ERC7984CreditAdapter`
- `BondManager`
- `MatchSettlementCoordinator`

Future production-like core deploys skip `MockTokenOpsVestingManager` and `MockConfidentialCreditAdapter` unless
`CVC_DEPLOY_MOCKS=true`. If those mocks exist, the manifest writer places them under `mockContracts` for local/demo
compatibility rather than requiring them as core `contracts`.

Approximate deploy-only ETH by gas price:

- `1 gwei`: `0.009 ETH`
- `2 gwei`: `0.018 ETH`
- `5 gwei`: `0.045 ETH`
- `10 gwei`: `0.090 ETH`
- `20 gwei`: `0.180 ETH`

Practical recommendation: have at least `0.15 ETH` Sepolia for one deploy plus manifest/setup transactions and several
bundle-submission tests. `0.25 ETH` is a safer working buffer if we expect redeploys, verification attempts, and
multiple encrypted preference submissions.
