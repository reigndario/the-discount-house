import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

function resolveErc7984Token(hre: HardhatRuntimeEnvironment, deployer: string) {
  const configuredToken = process.env.CVC_ERC7984_TOKEN_ADDRESS;
  if (configuredToken !== undefined && configuredToken !== "") {
    if (!hre.ethers.isAddress(configuredToken)) {
      throw new Error(`CVC_ERC7984_TOKEN_ADDRESS is not a valid address: ${configuredToken}`);
    }
    return configuredToken;
  }

  if (hre.network.name === "hardhat" || hre.network.name === "localhost" || hre.network.name === "anvil") {
    return deployer;
  }

  throw new Error(`Set CVC_ERC7984_TOKEN_ADDRESS before deploying ERC7984CreditAdapter to ${hre.network.name}`);
}

function shouldDeployMocks(hre: HardhatRuntimeEnvironment) {
  return (
    process.env.CVC_DEPLOY_MOCKS === "true" ||
    hre.network.name === "hardhat" ||
    hre.network.name === "localhost" ||
    hre.network.name === "anvil"
  );
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;
  const erc7984Token = resolveErc7984Token(hre, deployer);
  const deployMocks = shouldDeployMocks(hre);

  const preferenceBook = await deploy("ConfidentialPreferenceBook", {
    from: deployer,
    log: true,
  });

  const negotiationEngine = await deploy("NashNegotiationEngine", {
    from: deployer,
    args: [preferenceBook.address],
    log: true,
  });

  const vestingAdapter = await deploy("TokenOpsVestingAdapter", {
    from: deployer,
    log: true,
  });

  const vestingManager = deployMocks
    ? await deploy("MockTokenOpsVestingManager", {
        from: deployer,
        log: true,
      })
    : null;

  const loanEscrowFactory = await deploy("LoanEscrowFactory", {
    from: deployer,
    log: true,
  });

  const creditAdapter = deployMocks
    ? await deploy("MockConfidentialCreditAdapter", {
        from: deployer,
        log: true,
      })
    : null;

  const erc7984CreditAdapter = await deploy("ERC7984CreditAdapter", {
    from: deployer,
    args: [erc7984Token],
    log: true,
  });

  const bondManager = await deploy("BondManager", {
    from: deployer,
    args: [
      deployer,
      {
        baseBondWei: hre.ethers.parseEther("0.0001"),
        configuredMinBatchSize: 3,
        treasuryShareBps: 2_000,
        thinMarketPenaltyBps: 1_000,
        failedAttemptCooldownSeconds: 300,
      },
    ],
    log: true,
  });

  const settlementCoordinator = await deploy("MatchSettlementCoordinator", {
    from: deployer,
    args: [bondManager.address, negotiationEngine.address, loanEscrowFactory.address],
    log: true,
  });

  const settlerAuthorized = await hre.deployments.read(
    "BondManager",
    "authorizedSettlers",
    settlementCoordinator.address,
  );
  if (!settlerAuthorized) {
    await hre.deployments.execute(
      "BondManager",
      { from: deployer, log: true },
      "setAuthorizedSettler",
      settlementCoordinator.address,
      true,
    );
  }

  const authorizedMatcher = await hre.deployments.read("ConfidentialPreferenceBook", "authorizedMatcher");
  if (authorizedMatcher.toLowerCase() !== negotiationEngine.address.toLowerCase()) {
    await hre.deployments.execute(
      "ConfidentialPreferenceBook",
      { from: deployer, log: true },
      "setAuthorizedMatcher",
      negotiationEngine.address,
    );
  }

  console.log("ConfidentialPreferenceBook:", preferenceBook.address);
  console.log("NashNegotiationEngine:", negotiationEngine.address);
  console.log("TokenOpsVestingAdapter:", vestingAdapter.address);
  console.log("MockTokenOpsVestingManager:", vestingManager?.address ?? "skipped");
  console.log("LoanEscrowFactory:", loanEscrowFactory.address);
  console.log("MockConfidentialCreditAdapter:", creditAdapter?.address ?? "skipped");
  console.log("ERC7984 token:", erc7984Token);
  console.log("ERC7984CreditAdapter:", erc7984CreditAdapter.address);
  console.log("BondManager:", bondManager.address);
  console.log("MatchSettlementCoordinator:", settlementCoordinator.address);
};
export default func;
func.id = "deploy_confidential_vesting_credit_core_v4";
func.tags = ["Core"];
