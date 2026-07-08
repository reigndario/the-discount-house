import "@fhevm/hardhat-plugin";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-verify";
import "@typechain/hardhat";
import "hardhat-deploy";
import "hardhat-gas-reporter";
import fs from "node:fs";
import type { HardhatUserConfig } from "hardhat/config";
import { vars } from "hardhat/config";
import "solidity-coverage";

import "./tasks/accounts";

// Run 'npx hardhat vars setup' to see the list of variables that need to be set

const DEFAULT_HARDHAT_MNEMONIC = "test test test test test test test test test test test junk";
const MNEMONIC: string = process.env.MNEMONIC ?? vars.get("MNEMONIC", DEFAULT_HARDHAT_MNEMONIC);
const SEPOLIA_WALLET_FILE = process.env.CVC_SEPOLIA_WALLET_FILE;
const SEPOLIA_MNEMONIC = readSepoliaMnemonicFromFile() ?? MNEMONIC;
const INFURA_API_KEY: string = vars.get("INFURA_API_KEY", "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz");
const SEPOLIA_RPC_URL: string =
  process.env.SEPOLIA_RPC_URL ?? vars.get("SEPOLIA_RPC_URL", `https://sepolia.infura.io/v3/${INFURA_API_KEY}`);

function readSepoliaMnemonicFromFile(): string | undefined {
  if (!SEPOLIA_WALLET_FILE) return undefined;
  if (!fs.existsSync(SEPOLIA_WALLET_FILE)) return undefined;

  const parsed = JSON.parse(fs.readFileSync(SEPOLIA_WALLET_FILE, "utf8")) as { mnemonic?: unknown };
  if (typeof parsed.mnemonic !== "string" || parsed.mnemonic.trim() === "") {
    throw new Error(`${SEPOLIA_WALLET_FILE} must contain a non-empty mnemonic field for Sepolia deployments.`);
  }

  return parsed.mnemonic.trim();
}

function requestedHardhatNetwork(): string | undefined {
  const networkFlag = process.argv.findIndex((arg) => arg === "--network" || arg.startsWith("--network="));
  if (networkFlag === -1) return process.env.HARDHAT_NETWORK;

  const arg = process.argv[networkFlag];
  if (arg.startsWith("--network=")) return arg.split("=")[1];

  return process.argv[networkFlag + 1] ?? process.env.HARDHAT_NETWORK;
}

const requestedNetwork = requestedHardhatNetwork();
if (requestedNetwork === "sepolia" && SEPOLIA_MNEMONIC.trim() === DEFAULT_HARDHAT_MNEMONIC) {
  throw new Error(
    "Refusing to use the public Hardhat default mnemonic on Sepolia. " +
      "Set CVC_SEPOLIA_WALLET_FILE, MNEMONIC, or HARDHAT_VAR_MNEMONIC to a fresh private project mnemonic before any public-network command.",
  );
}

const config: HardhatUserConfig = {
  defaultNetwork: "hardhat",
  namedAccounts: {
    deployer: 0,
  },
  etherscan: {
    apiKey: {
      sepolia: vars.get("ETHERSCAN_API_KEY", ""),
    },
  },
  gasReporter: {
    currency: "USD",
    enabled: process.env.REPORT_GAS ? true : false,
    excludeContracts: [],
  },
  networks: {
    hardhat: {
      accounts: {
        mnemonic: MNEMONIC,
      },
      chainId: 31337,
    },
    anvil: {
      accounts: {
        mnemonic: MNEMONIC,
        path: "m/44'/60'/0'/0/",
        count: 10,
      },
      chainId: 31337,
      url: "http://localhost:8545",
    },
    sepolia: {
      accounts: {
        mnemonic: SEPOLIA_MNEMONIC,
        path: "m/44'/60'/0'/0/",
        count: 10,
      },
      chainId: 11155111,
      url: SEPOLIA_RPC_URL,
    },
  },
  paths: {
    artifacts: "./artifacts",
    cache: "./cache",
    sources: "./contracts",
    tests: "./test",
  },
  solidity: {
    version: "0.8.27",
    settings: {
      metadata: {
        // Not including the metadata hash
        // https://github.com/paulrberg/hardhat-template/issues/31
        bytecodeHash: "none",
      },
      // Disable the optimizer when debugging
      // https://hardhat.org/hardhat-network/#solidity-optimizer-support
      optimizer: {
        enabled: true,
        runs: 800,
      },
      evmVersion: "cancun",
    },
  },
  typechain: {
    outDir: "types",
    target: "ethers-v6",
  },
};

export default config;
