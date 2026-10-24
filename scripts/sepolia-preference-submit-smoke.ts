import hre, { ethers } from "hardhat";
import {
  durationBucketLabel,
  encryptBundleFields,
  principalBucketLabel,
  type BundleRelayer,
  type PlainBundle,
  type PlainSide,
} from "../src/protocolSdk";
import type { ConfidentialPreferenceBook } from "../types";

const BORROWER = 0;
const LENDER = 1;
const MIN_SECOND_SIGNER_ETH = ethers.parseEther("0.01");
const SECOND_SIGNER_ETH_TOP_UP = ethers.parseEther("0.015");

type GasLine = {
  action: string;
  hash: string;
  gasUsed: string | undefined;
};

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
  const plain = plainBundleForSide(side, collateralToken, tokenOpsManager, backingId);
  const metadata = {
    side,
    collateralToken,
    tokenOpsManager,
    principalBucket: ethers.encodeBytes32String(principalBucketLabel(plain.principal.range.max)),
    durationBucket: ethers.encodeBytes32String(durationBucketLabel(plain.durationDays.range.max)),
    expiry: BigInt(Math.floor(Date.now() / 1000) + plain.expiryDays * 24 * 60 * 60),
  };
  const encrypted = await encryptBundleFields(await relayerInstance(), bookAddress, managerAddress, plain);
  return {
    metadata,
    backingId,
    ...encrypted,
  };
}

function plainBundleForSide(
  side: number,
  collateralToken: string,
  tokenOpsManager: string,
  backingId: string,
): PlainBundle {
  const plainSide: PlainSide = side === BORROWER ? "borrower" : "lender";
  const common = { side: plainSide, collateralToken, tokenOpsManager, backingId, expiryDays: 30 };
  if (side === BORROWER) {
    return {
      ...common,
      collateralAmount: { range: { min: 100_000, max: 175_000, target: 135_000 } },
      principal: { range: { min: 80, max: 120, target: 100 } },
      interestPercent: { range: { min: 5, max: 8, target: 5 } },
      durationDays: { range: { min: 360, max: 720, target: 720 } },
      gracePeriodDays: { range: { min: 7, max: 30, target: 30 } },
    };
  }

  return {
    ...common,
    collateralAmount: { range: { min: 100_000, max: 200_000, target: 150_000 }, priority: 5 },
    principal: { range: { min: 70, max: 130, target: 100 }, priority: 3 },
    interestPercent: { range: { min: 6, max: 10, target: 10 }, priority: 5 },
    durationDays: { range: { min: 180, max: 720, target: 360 }, priority: 3 },
    gracePeriodDays: { range: { min: 0, max: 15, target: 0 }, priority: 4 },
  };
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

let cachedRelayer: BundleRelayer | undefined;

async function relayerInstance() {
  cachedRelayer ??= await createRelayerInstance();
  return cachedRelayer;
}

async function createRelayerInstance(): Promise<BundleRelayer> {
  const sdk = await import("@zama-fhe/relayer-sdk/node");
  const rpcUrl = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
  return (await sdk.createInstance({
    ...sdk.SepoliaConfig,
    network: rpcUrl,
  })) as unknown as BundleRelayer;
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
