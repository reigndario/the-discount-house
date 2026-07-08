import hre from "hardhat";

async function main() {
  const tokenAddress = process.env.CVC_ERC7984_TOKEN_ADDRESS;
  if (!tokenAddress || !hre.ethers.isAddress(tokenAddress)) {
    throw new Error("Set CVC_ERC7984_TOKEN_ADDRESS to the ERC-7984 token address");
  }

  const { deployer } = await hre.getNamedAccounts();
  const deployment = await hre.deployments.deploy("ERC7984CreditAdapter", {
    from: deployer,
    args: [tokenAddress],
    log: true,
  });

  console.log("ERC7984 token:", tokenAddress);
  console.log("ERC7984CreditAdapter:", deployment.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
