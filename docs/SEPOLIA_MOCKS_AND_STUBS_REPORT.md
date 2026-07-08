# Sepolia Mocks and Stubs Report

Date: 2026-07-07

This report describes what is still mocked, stubbed, demo-only, or unvalidated in the Sepolia deployment currently wired
into `public/deployment-manifest.json`. The current policy is not to replace one mock with another. If a production path
is missing, the UI should leave it disabled or fail with a clear warning.

Rotation note: the current manifest was redeployed on July 7, 2026 from non-default project wallet
`0xA27935e8958bd65aFD6F28eee115e3883eafF03D`. The deployment snapshot below is current. Deeper validation narratives
below include smokes from the same code path before wallet rotation and should be rerun against this fresh deployment
before final demo signoff.

## Deployment Snapshot

Network: Sepolia

Chain ID: `11155111`

### Core Contracts

| Contract                     | Address                                      | Status                                                                                     |
| ---------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `ConfidentialPreferenceBook` | `0x882Da9cB5BD5DA4cCB58d91040d60dCC50183Ecb` | Core contract deployed; browser-style encrypted submission smoke passed                    |
| `NashNegotiationEngine`      | `0x7267122A75B7a7890AF9ac4003a737FFF22e9150` | Core contract deployed                                                                     |
| `TokenOpsVestingAdapter`     | `0xc92c61ebdaC716238AF4D70A2696663D16220B94` | Core adapter; real TokenOps custody/release and unpledged recovery smokes passed           |
| `LoanEscrowFactory`          | `0x5c81d01795D36642A4137643F8D11fE956567d85` | Core contract deployed; real TokenOps plus ERC-7984 escrow smoke passed                    |
| `ERC7984CreditAdapter`       | `0xF832f4c797eE146198a79EdfB0E0B2Ac82ccE3F2` | Deployed against canonical Sepolia `cUSDCMock`; callback and reusable-credit smokes passed |
| `BondManager`                | `0x390feeFCA76d7ff56fcA0fCC74873A70fAbb24F7` | Core contract deployed                                                                     |
| `MatchSettlementCoordinator` | `0xA73aF9DbFfACB115090452E17a11F85931359Ce1` | Core contract deployed                                                                     |

### Historical Mock Contracts

| Contract                        | Address                                      | Status                                                                            |
| ------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------- |
| `MockConfidentialCreditAdapter` | `0xB841C093538f14A8577d80a0d38CFDC19209163E` | Historical mock; future production core deploys skip it unless `CVC_DEPLOY_MOCKS` |
| `MockTokenOpsVestingManager`    | `0x3c6A513116C2D9cE9645f0096a04182aCcC23919` | Historical mock; future manifests expose it only under `mockContracts` when found |

### Demo Utility Contracts

| Contract                     | Address                                      | Status                               |
| ---------------------------- | -------------------------------------------- | ------------------------------------ |
| `DemoUsdToken`               | `0x83859862d63AaDC97e0C402A7775a765243e06Cd` | Demo-only ERC20-style token/faucet   |
| `DemoVestingToken`           | `0x9602c3f254223De12966c288c1258d8CA96518e2` | Demo-only collateral token           |
| `DemoTokenOpsVestingFactory` | `0x0cC870E49Ca4f861b14285Db099c06f70B82395a` | Demo-only TokenOps-shaped manager    |
| `DemoCreditFaucet`           | skipped on current Sepolia manifest           | Demo wrapper around mock credit path |

### Manifest Assets

| Asset                     | Address                                      | Status                                        |
| ------------------------- | -------------------------------------------- | --------------------------------------------- |
| `confidentialCreditToken` | `0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639` | Canonical Sepolia `cUSDCMock`                 |
| `demoUsdToken`            | `0x83859862d63AaDC97e0C402A7775a765243e06Cd` | Demo-only USD token                           |
| `collateralToken`         | `0x258F9D60dc023870e4E3109c894D834D5377361a` | TokenOps Sepolia CTTT confidential test token |
| `tokenOpsManager`         | `0xb32208BF362b48672cAf58C52Ee45908e3cc6333` | Canonical CVC TokenOps CTTT vesting manager   |

## Current Sepolia Behavior

### Post-Rotation 1000 cUSDC End-to-End Validation

A fresh Sepolia validation was run on July 7, 2026 after redeploying from non-default project wallet
`0xA27935e8958bd65aFD6F28eee115e3883eafF03D`.

Validation roles:

| Role     | Address                                      |
| -------- | -------------------------------------------- |
| Operator | `0xA27935e8958bd65aFD6F28eee115e3883eafF03D` |
| Lender   | `0x088e39b08A4555b02c83a0C7f4993DCc6D95b58C` |
| Borrower | `0x28a3AB78965D4B5CA925c8bce8e6d1338D976862` |

Key result:

- TokenOps vesting ID `0x0000000000000000000000000000000000000000000000000000000000000000` was created for
  the borrower and moved into `TokenOpsVestingAdapter` custody.
- Lender wrapped and escrowed exactly `1000` `cUSDCMock` against commitment hash
  `0x8b12984fd51dfaebeeac84004ec340a8e298b9391feec05fc8a03ae7becfb696`.
- Encrypted match feasibility publicly decrypted to `true`.
- `MatchSettlementCoordinator` created escrow `0x8b18E8C6D2B4D37d1C79Fa17C105E43F70A7a425`.
- Loan activation tx `0x5a9e01be438715042faeba9ac5444f5016f8d1ae48b13e4cfe77a85554b754eb` released borrowed
  confidential cUSDC to the borrower.
- Borrower unwrapped exactly `1000` borrowed cUSDC:
  - unwrap tx `0xff2bb3bf1ee962e249b258d332af2937268ab1cb7836d4540545c5110ed1c015`
  - public decrypt amount: `1000`
  - finalize unwrap tx `0xba887d742d1631638828521729754896fc238dc1ebcdbba1fc42127180046816`
  - verified underlying balance delta: `1000 USDCMock`
- Read-only confirmation after the run: escrow state `2` and borrower underlying `USDCMock` balance `1000`.
- Total gas across the scripted setup, match, activation, and borrower unwrap path: `24651302`.

### 1. Stablecoin / ERC-7984 Settlement

Current state:

- `ERC7984CreditAdapter` is now deployed against canonical Sepolia `cUSDCMock`.
- A live Sepolia smoke validated:
  - adapter authorization registration
  - encrypted `cUSDCMock.confidentialTransferAndCall`
  - public decryption of the encrypted callback acceptance handle
  - proof-gated `finalizeCreditAcceptance`
  - `consumeCredit` returning the expected clear protocol amount
- A second live Sepolia smoke validated a wrong encrypted amount:
  - the callback acceptance handle publicly decrypted to `false`
  - false finalization cleared the pending adapter receipt
  - the same authorization hash could then be retried with the correct amount
  - the correct retry decrypted to `true`, finalized, and consumed
- The smoke used the deployed adapter address `0xF832f4c797eE146198a79EdfB0E0B2Ac82ccE3F2`.

Measured gas from the correct-amount smoke:

| Action                        | Gas Used |
| ----------------------------- | -------- |
| `registerAuthorization`       | `132645` |
| `confidentialTransferAndCall` | `962475` |
| `finalizeCreditAcceptance`    | `360128` |
| `consumeCredit`               | `36401`  |

Measured gas from the wrong-amount-then-retry smoke:

| Action                                | Gas Used |
| ------------------------------------- | -------- |
| wrong `confidentialTransferAndCall`   | `937386` |
| false `finalizeCreditAcceptance`      | `358779` |
| correct `confidentialTransferAndCall` | `937386` |
| true `finalizeCreditAcceptance`       | `360104` |
| `consumeCredit`                       | `36401`  |

Remaining limitations:

- Wrong-amount callback result and adapter retry behavior are validated on Sepolia, but balance-level refund accounting
  was not directly decrypted from user balances. OpenZeppelin ERC-7984 documents callback-false refunds as best-effort.
- Funding and repayment through actual `LoanEscrow` are validated by the current Sepolia smoke. The hardened path also
  releases borrowed confidential cUSDC to the borrower on activation and repayment confidential cUSDC to the lender on
  `makeLoanPayment`.
- Public unwrap/unshield was proven against the current Sepolia `cUSDCMock` wrapper: `unwrap` burned one confidential
  unit, public decryption returned `1`, and `finalizeUnwrap` transferred one underlying `USDCMock` unit.
- The UI now initiates ERC-7984 funding consumption from a matched lender commitment, borrower-side encrypted repayment,
  acceptance public decryption/finalization, and TokenOps collateral release completion for live-match-created escrows.
  This still needs manual wallet validation on Sepolia.

Measured gas from the `LoanEscrow` funding/repayment smoke:

| Action                                  | Gas Used  |
| --------------------------------------- | --------- |
| `seedLenderConfidentialCredit`          | `448148`  |
| `initiateVestingTransferToAdapter`      | `57013`   |
| `adapterAcceptPendingVestingTransfer`   | `150621`  |
| `createLoanEscrow`                      | `1190641` |
| `registerVestingCollateral`             | `204657`  |
| `registerFundingAuthorization`          | `138890`  |
| funding `confidentialTransferAndCall`   | `937362`  |
| funding `finalizeCreditAcceptance`      | `360104`  |
| `escrowFunding`                         | `87917`   |
| `activateLoan`                          | `444539`  |
| `registerPaymentAuthorization`          | `138826`  |
| repayment `confidentialTransferAndCall` | `937386`  |
| repayment `finalizeCreditAcceptance`    | `360128`  |
| `makeLoanPayment`                       | `541985`  |
| `acceptCollateralRelease`               | `172858`  |
| `completeCollateralRelease`             | `50063`   |

### 2. Credit Readiness and Authorization

Current state:

- `ERC7984CreditAdapter` now supports reusable lender credit commitments backed by adapter-held confidential token
  custody on Sepolia. A lender commitment is not executable until the lender transfers confidential credit to the
  adapter with the commitment hash as callback data.
- `LoanEscrow` releases funded confidential USD to the borrower on activation and repayment confidential USD to the
  lender on repayment.
- `MockConfidentialCreditAdapter` and `DemoCreditFaucet` remain deployed from earlier demo work.
- They are mock/demo utilities and store cleartext authorized credits.
- Sepolia-facing loan settlement actions that depended on those mock contracts are disabled in the current UI.
- Future production-like core deploys skip mock contracts unless `CVC_DEPLOY_MOCKS=true`; generated manifests put any
  detected mocks under `mockContracts`, not required `contracts`.

Why this matters:

- The mock adapter should not be presented as real credit custody.
- Demo faucet credit readiness is not equivalent to reusable deployed confidential credit.

Replacement required:

- Keep `MockConfidentialCreditAdapter` and `DemoCreditFaucet` only in explicitly named demo/local surfaces.

Measured gas from the reusable ERC-7984 lender commitment smoke:

| Action                              | Gas Used |
| ----------------------------------- | -------- |
| `seedLenderConfidentialCredit`      | `448176` |
| `registerLenderCreditCommitment`    | `74808`  |
| `escrowLenderCommitmentCredit`      | `835840` |
| `bindCommitmentAuthorization`       | `346314` |
| `finalizeBoundCommitmentAcceptance` | `360116` |
| `consumeBoundCommitmentCredit`      | `43605`  |
| `releaseBoundCommitmentCredit`      | `430881` |

Measured gas from the `cUSDCMock` public unwrap smoke:

| Action           | Gas Used |
| ---------------- | -------- |
| `unwrap`         | `490244` |
| `finalizeUnwrap` | `399699` |

### 3. TokenOps Vesting Collateral

Current state:

- Manifest assets now configure TokenOps Sepolia CTTT (`0x258F9D60dc023870e4E3109c894D834D5377361a`) as the collateral
  token.
- A canonical CVC TokenOps CTTT vesting manager was created through the TokenOps Sepolia factory
  (`0xA87701CE9A52D43681600583a99c85b50DbE3150`) at `0xb32208BF362b48672cAf58C52Ee45908e3cc6333`.
- `TokenOpsVestingAdapter` now uses the TokenOps pending-transfer path: borrower initiates transfer to the adapter, the
  adapter accepts and records borrower custody, escrow registration pledges the custodied vesting ID, and release
  initiates a pending transfer to borrower or lender for final acceptance.
- `DemoVestingToken` and `DemoTokenOpsVestingFactory` remain demo-only utilities.
- `MockTokenOpsVestingManager` remains deployed but is not selected as the active manifest collateral manager.

Why this matters:

- Real TokenOps CTTT vesting creation, adapter custody, pledge registration, release initiation, recipient acceptance,
  and adapter release completion are validated on Sepolia.
- TokenOps produced a valid first vesting schedule with `vestingId == bytes32(0)`. The protocol was updated and
  redeployed to treat zero as a valid TokenOps ID rather than a sentinel.
- Preference bundle contract submission can now use real TokenOps collateral metadata instead of failing on missing
  manifest assets.
- `TokenOpsVestingAdapter` now has unpledged custody recovery back to the original borrower. A Sepolia smoke created a
  fresh vesting ID, accepted adapter custody, initiated recovery to the borrower, had the borrower accept transfer, and
  completed adapter custody cleanup.

Replacement required:

- Wire TokenOps SDK/browser flows into guided UI controls.

Measured gas from the TokenOps unpledged recovery smoke:

| Action                             | Gas Used |
| ---------------------------------- | -------- |
| `mintConfidential`                 | `337570` |
| `createVesting`                    | `870142` |
| `initiateTransferToAdapter`        | `57013`  |
| `adapterAcceptPendingTransfer`     | `189192` |
| `recoverUnpledgedVesting`          | `75264`  |
| `acceptRecoveryTransfer`           | `108389` |
| `completeUnpledgedVestingRecovery` | `42485`  |

### 4. Preference Book Data in the UI

Current state:

- The Builder can maintain rich bundle labels, ordering, and exact preferences in browser storage.
- Contract submission encrypts preference fields and writes only the agreed public metadata.
- The Book page still primarily reflects browser-local state and does not yet index Sepolia events.
- A live Sepolia smoke submitted borrower and lender encrypted bundles using the browser-style `generateZKProof()` plus
  relayer `requestZKProofVerification(...)` flow.

Why this matters:

- Another browser cannot reconstruct the full local bundle UI from chain data, by design.
- Public bucket discovery exists in contract events/state, but the UI still needs an event reader/indexer.

Replacement required:

- Add a lightweight reader for `PreferenceCreated`, `BackingExecutable`, `PreferenceConsumed`, and related lifecycle
  events.
- Show only public bucket metadata and user-local cached details.

### 5. Loan Discovery and Match Execution

Current state:

- `NashNegotiationEngine`, `BondManager`, and `MatchSettlementCoordinator` are deployed.
- A live Sepolia smoke validated browser-style encrypted bundle submission, real executable backing on both sides, taker
  bond posting, `executeMatch`, six staged `computeSelectedTerm` calls, `commitEncryptedTerms`, public decryption of the
  aggregate feasibility bit, `finalizeMatchFeasibility`, `MatchSettlementCoordinator.settleSuccessfulMatch`, matched
  escrow creation, funding, activation, repayment, and TokenOps collateral release back to the borrower.
- The UI now scans recent `PreferenceCreated` events, reconstructs public executable buckets, and lets a connected
  borrower or lender execute a live opposite-side bucket through bond posting, encrypted matching, feasibility
  finalization, successful settlement, and escrow creation.
- The UI now scans recent `LoanCreated` events, reads each escrow's public lifecycle state, and merges indexed Sepolia
  escrows with any richer browser-local term cache.
- Sepolia mock-backed collateral/funding/repayment buttons are disabled rather than routed to demo contracts.

Why this matters:

- The deployed matching and settlement contracts now have end-to-end Sepolia script validation and browser wiring, but
  the browser workflow still needs manual wallet validation against live executable bundles.
- Users can inspect escrows in the configured discovery window, but should not treat the current reader as a permanent
  archival indexer.

Replacement required:

- Manually validate role-aware matching execution from the Loans page with browser wallets.
- Add gas estimation, bond quote display, and richer candidate selection.
- Add a durable indexer or pagination strategy if the app needs historical discovery beyond the configured lookback.

Measured gas from the encrypted match, settlement, and matched escrow smoke:

| Action                                 | Gas Used  |
| -------------------------------------- | --------- |
| `fundLenderEth`                        | `21000`   |
| `borrowerCreatePreferenceBundle`       | `4016768` |
| `lenderCreatePreferenceBundle`         | `4016627` |
| `initiateVestingTransferToAdapter`     | `57013`   |
| `adapterAcceptPendingVestingTransfer`  | `159905`  |
| `registerBorrowerBacking`              | `136538`  |
| `seedLenderConfidentialCredit`         | `448176`  |
| `registerLenderCreditCommitment`       | `74808`   |
| `escrowLenderCommitmentCredit`         | `835852`  |
| `registerLenderBacking`                | `115107`  |
| `activateBorrowerBacking`              | `186714`  |
| `activateLenderBacking`                | `162233`  |
| `postBond`                             | `188535`  |
| `executeMatch`                         | `404839`  |
| `computeSelectedTerm0`                 | `1426068` |
| `computeSelectedTerm1`                 | `1409055` |
| `computeSelectedTerm2`                 | `1409113` |
| `computeSelectedTerm3`                 | `1409171` |
| `computeSelectedTerm4`                 | `1409225` |
| `computeSelectedTerm5`                 | `1409220` |
| `commitEncryptedTerms`                 | `768154`  |
| `finalizeMatchFeasibility`             | `429148`  |
| `settleSuccessfulMatch`                | `1504509` |
| `registerVestingCollateral`            | `204657`  |
| `registerFundingAuthorization`         | `352591`  |
| `fundingFinalizeCreditAcceptance`      | `360116`  |
| `escrowFunding`                        | `95121`   |
| `activateLoan`                         | `444543`  |
| `registerPaymentAuthorization`         | `138814`  |
| `repaymentConfidentialTransferAndCall` | `937374`  |
| `repaymentFinalizeCreditAcceptance`    | `360092`  |
| `makeLoanPayment`                      | `541973`  |
| `acceptCollateralRelease`              | `108389`  |
| `completeCollateralRelease`            | `50063`   |

### 6. FHE / Relayer Path

Current state:

- The UI uses Zama SDK Sepolia defaults when connected to Sepolia.
- Local tests use the Zama mock runtime.
- Live ERC-7984 adapter finalization used Zama public decryption successfully.
- Browser-style encrypted preference bundle submission is validated by smoke script.
- Encrypted match execution and aggregate feasibility public-decryption proof verification are validated by Sepolia
  smoke script.

Why this matters:

- Local Hardhat tests do not fully prove gateway, relayer, ACL, KMS, or coprocessor behavior.
- Browser-side encrypted input generation and proof verification have script-level Sepolia validation; manual wallet
  validation remains useful for provider-specific behavior.

Replacement required:

- Manual wallet/browser testing of `createPreferenceBundle` remains useful, but the equivalent relayer proof flow has
  passed from the Sepolia smoke script.
- Capture any relayer/gateway requirements in the manifest or UI diagnostics.

Operational note:

- The first post-redeploy loan smoke hit one relayer public-decryption failure on a funding acceptance handle. Minimal
  follow-up registrar checks and a full rerun passed, so this is tracked as residual relayer/transient risk rather than
  a reproduced contract defect.

### 7. Demo Utils Page

Current state:

- Demo Utils intentionally exposes demo-only controls:
  - mint demo USD
  - deploy demo vesting token
  - deploy demo vesting manager
  - create demo vesting IDs

Why this matters:

- These controls are useful for demonstrations but are not production protocol features.
- They create cleartext, faucet-backed, unlimited demo assets.

Replacement required:

- Keep Demo Utils visible, isolated, and clearly labeled for testnet/demo use.

## Not Mocked, But Intentionally Local

These are aligned with the privacy model:

- Bundle labels are browser-local.
- Bundle ordering is browser-local.
- Rich builder metadata not needed for matching remains browser-local.
- Exact preference details are not reconstructed from chain data.

## Sepolia Smoke Test Coverage

Validated on Sepolia:

- Real `ERC7984CreditAdapter` configured to canonical `cUSDCMock`.
- TokenOps Sepolia CTTT manager clone created through the official TokenOps factory.
- Updated `TokenOpsVestingAdapter` deployed with pending-transfer custody and release functions in the manifest ABI.
- Correct-amount confidential transfer callback.
- Wrong-amount confidential transfer callback returning a publicly decrypted `false` acceptance bit.
- Public decryption proof for callback acceptance.
- Proof-gated adapter finalization.
- Adapter retry after false finalization.
- Adapter credit consumption.
- Real TokenOps CTTT vesting custody through adapter acceptance.
- TokenOps `bytes32(0)` vesting ID compatibility.
- TokenOps collateral pledge registration, release initiation, recipient acceptance, and adapter release completion.
- ERC-7984 funding and repayment through actual `LoanEscrow`.
- Borrower confidential cUSDC release on activation and lender confidential cUSDC release on repayment.
- Reusable ERC-7984 lender credit commitment custody, binding, consumption, and release.
- Public unwrap/finalize of one released confidential cUSDC unit into underlying `USDCMock`.
- TokenOps unpledged custody recovery back to the original borrower.
- Browser-style encrypted Preference Bundle submission through Sepolia relayer proof verification.
- Encrypted match execution, six staged selected-term computations, aggregate feasibility finalization, successful
  coordinator settlement, and matched escrow repayment/release.
- Failed encrypted match finalization and `MatchSettlementCoordinator.settleFailedMatch` bond slashing.
- Earlier demo-only loan escrow lifecycle using demo collateral and mock credit.

Not yet validated on Sepolia:

- Balance-level refund accounting after wrong-amount `cUSDCMock` callback failure.
- Manual wallet validation of UI-initiated match execution.
- Manual wallet validation of onchain public bucket and escrow discovery in the UI.
- Manual wallet/browser confirmation of the Builder save path.
- Production behavior if a future selected confidential USD token does not implement `IERC7984ERC20Wrapper`.

## Production Readiness Checklist

Before presenting this as production-grade rather than demo-grade, complete:

1. Manually validate UI match execution and live escrow actions against deployed TokenOps/ERC-7984 contracts.
2. Add durable indexing/pagination for public buckets and loans if the demo needs history beyond the current lookback.
3. Manually test the Builder save path with a browser wallet on Sepolia.
4. Keep Demo Utils visible, isolated, and labeled as testnet/demo utilities.
5. Re-run the smoke suite after any redeploy or dependency upgrade.
