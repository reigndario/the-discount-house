import hre, { ethers } from "hardhat";
import type { ConfidentialPreferenceBook } from "../types";

const BORROWER = 0;
const LENDER = 1;
const LOWER_IS_BETTER = 0;
const HIGHER_IS_BETTER = 1;
const TARGET_IS_BEST = 2;
const NORMAL_PRIORITY = 2;
const MIN_SECOND_SIGNER_ETH = ethers.parseEther("0.01");
const SECOND_SIGNER_ETH_TOP_UP = ethers.parseEther("0.015");

type GasLine = {
  action: string;
  hash: string;
  gasUsed: string | undefined;
};

type PlainField = readonly [bigint, bigint, bigint, number, number];

async function main() {
  if (hre.network.name !== "sepolia") {
    throw new Error("Run this script with --network sepolia.");
  }

  const manifest = await readManifest();
  const [borrower, lender] = await ethers.getSigners();
  if (!lender) throw new Error("Sepolia config must expose at least two accounts.");

  const preferenceBookAddress = ethers.getAddress(manifest.contracts.ConfidentialPreferenceBook.address);
  const collateralToken = ethers.getAddress(
    process.env.CVC_COLLATERAL_TOKEN_ADDRESS ?? manifest.assets.collateralToken,
  );
  const tokenOpsManager = ethers.getAddress(
    process.env.CVC_TOKENOPS_MANAGER_ADDRESS ?? manifest.assets.tokenOpsManager,
  );
  const preferenceBook = (await ethers.getContractAt(
    "ConfidentialPreferenceBook",
    preferenceBookAddress,
    borrower,
  )) as unknown as ConfidentialPreferenceBook;

  const gas: GasLine[] = [];
  console.log("Encrypted preference Sepolia smoke");
  console.log(`preferenceBook=${preferenceBookAddress}`);
  console.log(`borrower=${borrower.address}`);
  console.log(`lender=${lender.address}`);
  console.log(`collateralToken=${collateralToken}`);
  console.log(`tokenOpsManager=${tokenOpsManager}`);

  await fundSecondSignerIfNeeded(borrower, lender.address, gas);

  const borrowerResult = await submitPreference({
    preferenceBook,
    manager: borrower,
    side: BORROWER,
    collateralToken,
    tokenOpsManager,
    label: "borrower",
    gas,
  });
  const lenderResult = await submitPreference({
    preferenceBook,
    manager: lender,
    side: LENDER,
    collateralToken,
    tokenOpsManager,
    label: "lender",
    gas,
  });

  console.log(`borrowerPreferenceId=${borrowerResult.preferenceId}`);
  console.log(`borrowerTx=${borrowerResult.hash}`);
  console.log(`lenderPreferenceId=${lenderResult.preferenceId}`);
  console.log(`lenderTx=${lenderResult.hash}`);
  console.log("gasSummary=");
  console.log(JSON.stringify(gas, null, 2));
}

async function submitPreference({
  preferenceBook,
  manager,
  side,
  collateralToken,
  tokenOpsManager,
  label,
  gas,
}: {
  preferenceBook: ConfidentialPreferenceBook;
  manager: Awaited<ReturnType<typeof ethers.getSigners>>[number];
  side: number;
  collateralToken: string;
  tokenOpsManager: string;
  label: string;
  gas: GasLine[];
}) {
  const input = await preferenceInput({
    bookAddress: await preferenceBook.getAddress(),
    managerAddress: manager.address,
    side,
    collateralToken,
    tokenOpsManager,
    backingId: uniqueHash(`${label}-backing`, manager.address),
  });

  const preferenceId = await preferenceBook.connect(manager).createPreferenceBundle.staticCall(input);
  const tx = await preferenceBook.connect(manager).createPreferenceBundle(input);
  const receipt = await tx.wait(1);
  gas.push({ action: `${label}CreatePreferenceBundle`, hash: tx.hash, gasUsed: receipt?.gasUsed.toString() });
  console.log(`${label}CreatePreferenceBundleTx=${tx.hash}`);
  return { preferenceId, hash: tx.hash };
}

async function preferenceInput({
  bookAddress,
  managerAddress,
  side,
  collateralToken,
  tokenOpsManager,
  backingId,
}: {
  bookAddress: string;
  managerAddress: string;
  side: number;
  collateralToken: string;
  tokenOpsManager: string;
  backingId: string;
}) {
  const metadata = {
    side,
    collateralToken,
    tokenOpsManager,
    principalBucket: ethers.encodeBytes32String("P<000150"),
    durationBucket: ethers.encodeBytes32String("D<000720"),
    expiry: BigInt(Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60),
  };
  const encrypted = await browserStyleEncryptedFields(bookAddress, managerAddress, side);
  return {
    metadata,
    backingId,
    ...encrypted,
  };
}

async function browserStyleEncryptedFields(bookAddress: string, managerAddress: string, side: number) {
  const relayer = await relayerInstance();
  const builder = relayer.createEncryptedInput(ethers.getAddress(bookAddress), ethers.getAddress(managerAddress));
  const fields = fieldsForSide(side);
  for (const [min, max, target, direction, priority] of fields) {
    builder.add64(min);
    builder.add64(max);
    builder.add64(target);
    builder.add8(direction);
    builder.add8(priority);
  }

  const proof = builder.generateZKProof();
  const { handles, inputProof } = await relayer.requestZKProofVerification(proof);
  let cursor = 0;
  const nextField = () => ({
    range: {
      min: ethers.hexlify(handles[cursor++]),
      max: ethers.hexlify(handles[cursor++]),
      target: ethers.hexlify(handles[cursor++]),
    },
    direction: ethers.hexlify(handles[cursor++]),
    priority: ethers.hexlify(handles[cursor++]),
  });

  return {
    collateralAmount: nextField(),
    principal: nextField(),
    collateralTokenPriceE8: nextField(),
    interestBps: nextField(),
    durationDays: nextField(),
    gracePeriodDays: nextField(),
    inputProof: ethers.hexlify(inputProof),
  };
}

function fieldsForSide(side: number): PlainField[] {
  if (side === BORROWER) {
    return [
      [100_000n, 175_000n, 135_000n, LOWER_IS_BETTER, 3],
      [80n, 120n, 100n, HIGHER_IS_BETTER, 4],
      [60_000_000n, 90_000_000n, 75_000_000n, HIGHER_IS_BETTER, 3],
      [500n, 800n, 500n, LOWER_IS_BETTER, 4],
      [360n, 720n, 720n, HIGHER_IS_BETTER, NORMAL_PRIORITY],
      [7n, 30n, 30n, HIGHER_IS_BETTER, NORMAL_PRIORITY],
    ];
  }

  return [
    [100_000n, 200_000n, 150_000n, HIGHER_IS_BETTER, 4],
    [70n, 130n, 100n, TARGET_IS_BEST, NORMAL_PRIORITY],
    [60_000_000n, 90_000_000n, 75_000_000n, HIGHER_IS_BETTER, 3],
    [600n, 1_000n, 1_000n, HIGHER_IS_BETTER, 4],
    [180n, 720n, 360n, LOWER_IS_BETTER, NORMAL_PRIORITY],
    [0n, 15n, 0n, LOWER_IS_BETTER, 3],
  ];
}

async function fundSecondSignerIfNeeded(
  funder: Awaited<ReturnType<typeof ethers.getSigners>>[number],
  recipient: string,
  gas: GasLine[],
) {
  const balance = await ethers.provider.getBalance(recipient);
  console.log(`secondSignerEthBalanceBefore=${balance.toString()}`);
  if (balance >= MIN_SECOND_SIGNER_ETH) return;

  const tx = await funder.sendTransaction({ to: recipient, value: SECOND_SIGNER_ETH_TOP_UP });
  const receipt = await tx.wait(1);
  gas.push({ action: "fundSecondSignerEth", hash: tx.hash, gasUsed: receipt?.gasUsed.toString() });
  console.log(`fundSecondSignerEthTx=${tx.hash}`);
}

let cachedRelayer: Awaited<ReturnType<typeof createRelayerInstance>> | undefined;

async function relayerInstance() {
  cachedRelayer ??= await createRelayerInstance();
  return cachedRelayer;
}

async function createRelayerInstance() {
  const sdk = await import("@zama-fhe/relayer-sdk/node");
  const rpcUrl = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
  return sdk.createInstance({
    ...sdk.SepoliaConfig,
    network: rpcUrl,
  });
}

async function readManifest() {
  return JSON.parse(
    await import("node:fs/promises").then((fs) => fs.readFile("public/deployment-manifest.json", "utf8")),
  );
}

function uniqueHash(label: string, actor: string) {
  return ethers.keccak256(
    ethers.solidityPacked(["string", "address", "uint256"], [`sepolia-${label}`, actor, Date.now()]),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
