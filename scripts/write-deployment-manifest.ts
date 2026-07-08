import fs from "node:fs";
import path from "node:path";
import hre from "hardhat";

const CORE_CONTRACTS = [
  "ConfidentialPreferenceBook",
  "NashNegotiationEngine",
  "TokenOpsVestingAdapter",
  "LoanEscrowFactory",
  "ERC7984CreditAdapter",
  "BondManager",
  "MatchSettlementCoordinator",
] as const;

const MOCK_CONTRACTS = ["MockTokenOpsVestingManager", "MockConfidentialCreditAdapter"] as const;
const DEMO_CONTRACTS = ["DemoUsdToken", "DemoVestingToken", "DemoTokenOpsVestingFactory", "DemoCreditFaucet"] as const;

type ManifestContract = {
  address: string;
  abi: unknown[];
};

type DemoArtifact = {
  abi: unknown[];
  bytecode: string;
};

async function main() {
  let deployments = await hre.deployments.all();
  if (
    hre.network.name === "hardhat" &&
    (!CORE_CONTRACTS.every((name) => deployments[name]) || !DEMO_CONTRACTS.every((name) => deployments[name]))
  ) {
    await hre.deployments.fixture(["Core", "Demo"]);
    deployments = await hre.deployments.all();
  }

  const network = await hre.ethers.provider.getNetwork();
  const contracts: Record<string, ManifestContract> = {};

  for (const name of CORE_CONTRACTS) {
    const deployment = deployments[name];
    if (!deployment) {
      throw new Error(`Missing deployment for ${name} on ${hre.network.name}`);
    }
    contracts[name] = {
      address: deployment.address,
      abi: deployment.abi,
    };
  }

  const mockContracts: Record<string, ManifestContract> = {};
  for (const name of MOCK_CONTRACTS) {
    const deployment = deployments[name];
    if (!deployment) continue;
    mockContracts[name] = {
      address: deployment.address,
      abi: deployment.abi,
    };
  }

  const demoContracts: Record<string, ManifestContract> = {};
  for (const name of DEMO_CONTRACTS) {
    const deployment = deployments[name];
    if (!deployment) continue;
    demoContracts[name] = {
      address: deployment.address,
      abi: deployment.abi,
    };
  }

  const demoArtifacts: Record<string, DemoArtifact> = {};
  for (const name of ["DemoVestingToken", "DemoTokenOpsVestingFactory"] as const) {
    const artifact = await hre.artifacts.readArtifact(name);
    demoArtifacts[name] = {
      abi: artifact.abi,
      bytecode: artifact.bytecode,
    };
  }

  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    network: hre.network.name,
    chainId: network.chainId.toString(),
    rpcUrl: process.env.CVC_PUBLIC_RPC_URL ?? null,
    assets: {
      confidentialCreditToken: envOrNull("CVC_ERC7984_TOKEN_ADDRESS"),
      demoUsdToken: envOrNull("CVC_DEMO_USD_TOKEN_ADDRESS") ?? deployments.DemoUsdToken?.address ?? null,
      collateralToken: envOrNull("CVC_COLLATERAL_TOKEN_ADDRESS"),
      tokenOpsManager: envOrNull("CVC_TOKENOPS_MANAGER_ADDRESS"),
    },
    fhevm: fhevmManifestConfig(),
    contracts,
    mockContracts,
    demoContracts,
    demoArtifacts,
    abis: {
      LoanEscrow: (await hre.artifacts.readArtifact("LoanEscrow")).abi,
    },
  };

  const outputPath = path.resolve(process.cwd(), process.env.CVC_MANIFEST_OUT ?? "public/deployment-manifest.json");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote deployment manifest: ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function fhevmManifestConfig() {
  if (!process.env.CVC_FHEVM_RELAYER_URL) {
    return null;
  }
  return {
    relayerUrl: process.env.CVC_FHEVM_RELAYER_URL,
    aclContractAddress: requireEnv("CVC_FHEVM_ACL_ADDRESS"),
    kmsContractAddress: requireEnv("CVC_FHEVM_KMS_ADDRESS"),
    inputVerifierContractAddress: requireEnv("CVC_FHEVM_INPUT_VERIFIER_ADDRESS"),
    verifyingContractAddressDecryption: requireEnv("CVC_FHEVM_VERIFY_DECRYPTION_ADDRESS"),
    verifyingContractAddressInputVerification: requireEnv("CVC_FHEVM_VERIFY_INPUT_ADDRESS"),
    gatewayChainId: Number(requireEnv("CVC_FHEVM_GATEWAY_CHAIN_ID")),
    relayerRouteVersion: Number(process.env.CVC_FHEVM_RELAYER_ROUTE_VERSION ?? 2),
    batchRpcCalls: process.env.CVC_FHEVM_BATCH_RPC_CALLS !== "false",
  };
}

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required when CVC_FHEVM_RELAYER_URL is set`);
  }
  return value;
}

function envOrNull(name: string) {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : null;
}
