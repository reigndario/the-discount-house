const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");
const { createPublicClient, createWalletClient, getAddress, http, isAddress, keccak256, toBytes } = require("viem");
const { mnemonicToAccount, privateKeyToAccount } = require("viem/accounts");
const { sepolia } = require("viem/chains");
const { createConfidentialVestingFactoryClient } = require("@tokenops/sdk/fhe-vesting");
const { requireConfidentialTestTokenAddress, requireTestTokenAddress } = require("@tokenops/sdk/testnet-faucet");

const DEFAULT_MANAGER_SALT = keccak256(toBytes("confidential-vesting-credit:sepolia:cttt-manager:v1"));

async function main() {
  if (hre.network.name !== "sepolia") {
    throw new Error("Run this script with --network sepolia.");
  }

  const rpcUrl = resolveRpcUrl();
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl),
  });
  const chainId = await publicClient.getChainId();
  if (chainId !== sepolia.id) {
    throw new Error(`Expected Sepolia chain ${sepolia.id}; RPC returned ${chainId}.`);
  }

  const account = resolveAccount();
  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: http(rpcUrl),
  });

  const outputPath = path.resolve(
    process.cwd(),
    process.env.CVC_TOKENOPS_MANAGER_OUT ?? `deployments/${hre.network.name}/TokenOpsManager.cvc.json`,
  );
  const configuredManager = envAddress("CVC_TOKENOPS_MANAGER_ADDRESS");
  const collateralToken = envAddress("CVC_COLLATERAL_TOKEN_ADDRESS") ?? requireConfidentialTestTokenAddress(chainId);
  const underlyingToken = requireTestTokenAddress(chainId);
  const userSalt = process.env.CVC_TOKENOPS_MANAGER_SALT ?? DEFAULT_MANAGER_SALT;
  const factory = createConfidentialVestingFactoryClient({ publicClient, walletClient, chainId });

  const existing = configuredManager
    ? null
    : readExistingManager(outputPath, collateralToken, userSalt, account.address);
  if (configuredManager || existing) {
    const manager = configuredManager ?? existing.manager;
    const record = {
      network: hre.network.name,
      chainId,
      createdAt: new Date().toISOString(),
      deployer: getAddress(account.address),
      factory: getAddress(factory.address),
      collateralToken,
      underlyingToken,
      manager,
      userSalt,
      transactionHash: null,
      source: configuredManager ? "env" : existing.source,
    };
    writeRecord(outputPath, record);
    printManifestEnv(record);
    return;
  }

  const { hash, manager } = await factory.createManagerAndGetAddress({
    token: collateralToken,
    userSalt,
    account,
  });

  const record = {
    network: hre.network.name,
    chainId,
    createdAt: new Date().toISOString(),
    deployer: getAddress(account.address),
    factory: getAddress(factory.address),
    collateralToken,
    underlyingToken,
    manager: getAddress(manager),
    userSalt,
    transactionHash: hash,
    source: "sdk",
  };
  writeRecord(outputPath, record);
  printManifestEnv(record);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function resolveRpcUrl() {
  const url = process.env.SEPOLIA_RPC_URL ?? hre.network.config.url;
  if (!url) {
    throw new Error("SEPOLIA_RPC_URL or hardhat sepolia network URL is required.");
  }
  return url;
}

function resolveAccount() {
  const privateKey = process.env.PRIVATE_KEY;
  if (privateKey) {
    return privateKeyToAccount(privateKey);
  }

  const accounts = hre.network.config.accounts;
  const configuredMnemonic =
    typeof accounts === "object" && !Array.isArray(accounts) && "mnemonic" in accounts ? accounts.mnemonic : undefined;
  const mnemonic = process.env.MNEMONIC ?? configuredMnemonic;
  if (!mnemonic) {
    throw new Error("PRIVATE_KEY or mnemonic-backed hardhat account config is required.");
  }
  return mnemonicToAccount(mnemonic, { path: "m/44'/60'/0'/0/0" });
}

function envAddress(name) {
  const value = process.env[name];
  if (!value) return null;
  if (!isAddress(value)) {
    throw new Error(`${name} is not a valid address: ${value}`);
  }
  return getAddress(value);
}

function readExistingManager(outputPath, collateralToken, userSalt, deployer) {
  if (!fs.existsSync(outputPath)) return null;
  const parsed = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  if (
    parsed.manager &&
    isAddress(parsed.manager) &&
    parsed.collateralToken?.toLowerCase() === collateralToken.toLowerCase() &&
    parsed.userSalt === userSalt &&
    parsed.deployer?.toLowerCase() === deployer.toLowerCase()
  ) {
    return {
      network: parsed.network ?? hre.network.name,
      chainId: parsed.chainId ?? sepolia.id,
      createdAt: parsed.createdAt ?? new Date().toISOString(),
      deployer: getAddress(parsed.deployer),
      factory: getAddress(parsed.factory ?? "0xA87701CE9A52D43681600583a99c85b50DbE3150"),
      collateralToken,
      underlyingToken: getAddress(parsed.underlyingToken ?? requireTestTokenAddress(sepolia.id)),
      manager: getAddress(parsed.manager),
      userSalt,
      transactionHash: parsed.transactionHash ?? null,
      source: parsed.source ?? "sdk",
    };
  }
  return null;
}

function writeRecord(outputPath, record) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(record, null, 2)}\n`);
}

function printManifestEnv(record) {
  console.log("TokenOps Sepolia manager ready");
  console.log(`factory=${record.factory}`);
  console.log(`deployer=${record.deployer}`);
  console.log(`CVC_COLLATERAL_TOKEN_ADDRESS=${record.collateralToken}`);
  console.log(`CVC_TOKENOPS_MANAGER_ADDRESS=${record.manager}`);
  console.log(`TOKENOPS_UNDERLYING_TEST_TOKEN_ADDRESS=${record.underlyingToken}`);
  console.log(`transactionHash=${record.transactionHash ?? "reused"}`);
}
