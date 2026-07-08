# Demo support surface

This folder contains demo-only helpers for local and Sepolia demonstrations. It is intentionally separate from the core
protocol code.

Contracts live under `contracts/demo/` so Hardhat compiles and types them normally:

- `DemoUsdToken`: ERC20-style USD faucet token for demo principal. It is not ERC-7984.
- `DemoVestingToken`: ERC20-style faucet token for representing demo collateral. It is not ERC-7984.
- `DemoTokenOpsVestingFactory`: TokenOps-shaped vesting manager/factory for one specific demo collateral token. It is
  not a production TokenOps contract.
- `DemoCreditFaucet`: wrapper around `MockConfidentialCreditAdapter` for demo credit commitments and authorizations. It
  is not privacy preserving.

Local deployment:

```sh
npm run deploy:demo:localhost
```

Standalone local script, useful for a disposable in-memory check:

```sh
npx hardhat run demo/deploy-demo-contracts.ts --network hardhat
```

Deployment separation:

- `npm run deploy:core:sepolia` deploys only protocol contracts.
- `npm run deploy:demo:sepolia` deploys only demo utilities.
- `DemoCreditFaucet` is optional in the separated demo deployment. It deploys only when
  `CVC_DEMO_CREDIT_ADAPTER_ADDRESS` is set or a `MockConfidentialCreditAdapter` deployment already exists.
- `npm run deploy:sepolia` still runs all deployment scripts for a full environment.

Limitations:

- Real ERC-7984 encrypted token transfer behavior still requires the Zama-compatible testnet path.
- Real TokenOps vesting semantics still require the actual TokenOps contracts or their official deployment interface.
- Demo credit authorization is cleartext and exists only to make the demo UI self-service before testnet validation.
