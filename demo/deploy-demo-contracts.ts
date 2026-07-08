import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();

  console.warn("WARNING: deploying demo-only helpers. These are not production ERC-7984 or TokenOps contracts.");
  console.log(`Deployer: ${deployer.address}`);

  const creditAdapter = await ethers.deployContract("MockConfidentialCreditAdapter");
  await creditAdapter.waitForDeployment();

  const usdToken = await ethers.deployContract("DemoUsdToken");
  await usdToken.waitForDeployment();

  const vestingToken = await ethers.deployContract("DemoVestingToken");
  await vestingToken.waitForDeployment();

  const vestingFactory = await ethers.deployContract("DemoTokenOpsVestingFactory", [await vestingToken.getAddress()]);
  await vestingFactory.waitForDeployment();

  const vestingAdapter = await ethers.deployContract("TokenOpsVestingAdapter");
  await vestingAdapter.waitForDeployment();

  const creditFaucet = await ethers.deployContract("DemoCreditFaucet", [await creditAdapter.getAddress()]);
  await creditFaucet.waitForDeployment();

  console.log(
    JSON.stringify(
      {
        warning: "demo-only cleartext helpers; do not use as production ERC-7984 or TokenOps contracts",
        contracts: {
          mockConfidentialCreditAdapter: await creditAdapter.getAddress(),
          demoUsdToken: await usdToken.getAddress(),
          demoVestingToken: await vestingToken.getAddress(),
          demoTokenOpsVestingFactory: await vestingFactory.getAddress(),
          tokenOpsVestingAdapter: await vestingAdapter.getAddress(),
          demoCreditFaucet: await creditFaucet.getAddress(),
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
