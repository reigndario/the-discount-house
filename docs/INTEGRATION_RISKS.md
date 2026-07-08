# Integration Risks

## Zama fhEVM

- Hardhat local tests use the Zama mock runtime. This is necessary for local development but does not perfectly
  reproduce gateway, relayer, and coprocessor behavior.
- Sepolia testing must validate ACL grants, encrypted comparisons, and decryption flows before any public demo.
- FHE operations can fail or resolve differently from ordinary Solidity predicates, so state machines must be explicit
  about pending, failed, and fulfilled states.

## OpenZeppelin Confidential Contracts

- `@openzeppelin/confidential-contracts` is young and moving quickly. The project pins exact versions and treats
  upgrades as security-sensitive.
- ERC-7984 is ERC-20-like but not ERC-20-compatible. Token custody and transfer UX must be designed around encrypted
  handles, operator authorization, and ACL permissions.
- The credit adapter returns an encrypted acceptance bit from `onConfidentialTransferReceived`; correct-amount and
  wrong-amount adapter paths have been validated on Sepolia against canonical `cUSDCMock` with Zama public decryption.
  The wrong-amount smoke proved `accepted=false`, adapter receipt clearing, and successful retry, but it did not
  directly decrypt balance-level refund accounting. The adapter restricts consumption to the registered loan escrow to
  prevent third-party authorization griefing.

## TokenOps

- `@tokenops/sdk/fhe-vesting` exposes `confidentialVestingManagerAbi`, including the adapter-required
  `getVestingInfo(bytes32)`, `getPendingVestingTransfer(bytes32)`, `initiateVestingTransfer(bytes32,address,uint48)`,
  and `acceptVestingTransfer(bytes32)`. A local SDK-surface test guards those names and argument types.
- `TokenOpsVestingAdapter` now relies on the user-mediated pending-transfer flow rather than admin-only direct
  transfers. Borrowers initiate transfer to the adapter, anyone may call adapter acceptance, and release is finalized
  after the borrower or lender accepts the adapter-initiated pending transfer.
- Sepolia manifest assets now point at TokenOps CTTT (`0x258F9D60dc023870e4E3109c894D834D5377361a`) and a CVC-created
  CTTT vesting manager (`0xb32208BF362b48672cAf58C52Ee45908e3cc6333`) created through the official TokenOps factory.
- The browser local flow still marks mock TokenOps setup as a placeholder and uses `MockTokenOpsVestingManager` only to
  prove local escrow state transitions. Sepolia-facing mock-backed settlement controls are disabled rather than routed
  to mock contracts.
- Sepolia validation has covered real CTTT vesting creation, transfer into `TokenOpsVestingAdapter`, `LoanEscrow` pledge
  registration, release after repayment, and unpledged custody recovery. Remaining risk is operational UX around
  TokenOps wallet prompts and any future TokenOps SDK/API changes.

## Dependency Audit

`npm audit --omit=dev` is clean after dependency overrides and non-breaking audit fixes. A full dev-dependency audit
still reports transitive findings through Hardhat, hardhat-deploy, Solidity coverage, and related test tooling. Npm only
offers breaking upgrades for the remaining findings, so they should be handled as a dedicated tooling-upgrade pass or
explicitly risk-accepted for local development tooling before submission.
