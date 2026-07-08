import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const usdToken = await deploy("DemoUsdToken", {
    from: deployer,
    log: true,
  });

  const vestingToken = await deploy("DemoVestingToken", {
    from: deployer,
    args: ["Demo Vested Collateral", "dVEST"],
    log: true,
  });

  const vestingFactory = await deploy("DemoTokenOpsVestingFactory", {
    from: deployer,
    args: [vestingToken.address],
    log: true,
  });

  const creditAdapterAddress = await resolveDemoCreditAdapterAddress(hre);
  const creditFaucet = creditAdapterAddress
    ? await deploy("DemoCreditFaucet", {
        from: deployer,
        args: [creditAdapterAddress],
        log: true,
      })
    : null;

  console.log("WARNING: Demo helpers are not production ERC-7984 or TokenOps contracts.");
  console.log("DemoUsdToken:", usdToken.address);
  console.log("DemoVestingToken:", vestingToken.address);
  console.log("DemoTokenOpsVestingFactory:", vestingFactory.address);
  if (creditFaucet) {
    console.log("DemoCreditFaucet:", creditFaucet.address);
  } else {
    console.log("DemoCreditFaucet: skipped; set CVC_DEMO_CREDIT_ADAPTER_ADDRESS or deploy Core first");
  }
};

export default func;
func.id = "deploy_confidential_vesting_credit_demo_v2";
func.tags = ["Demo"];

async function resolveDemoCreditAdapterAddress(hre: HardhatRuntimeEnvironment) {
  const configuredAddress = process.env.CVC_DEMO_CREDIT_ADAPTER_ADDRESS;
  if (configuredAddress) {
    if (!hre.ethers.isAddress(configuredAddress)) {
      throw new Error(`CVC_DEMO_CREDIT_ADAPTER_ADDRESS is not a valid address: ${configuredAddress}`);
    }
    return configuredAddress;
  }

  const localCreditAdapter = await hre.deployments.getOrNull("MockConfidentialCreditAdapter");
  return localCreditAdapter?.address ?? null;
}
