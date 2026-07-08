import hre, { ethers } from "hardhat";
import type { Contract } from "ethers";
import type { ERC7984CreditAdapter } from "../types";

const COMMITMENT_AMOUNT = 10n;
const DRAW_AMOUNT = 5n;
const MIN_LENDER_ETH = ethers.parseEther("0.01");
const LENDER_ETH_TOP_UP = ethers.parseEther("0.015");

type SepoliaSigner = Awaited<ReturnType<typeof ethers.getSigners>>[number];

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

  const tokenAddress = ethers.getAddress(
    process.env.CVC_ERC7984_TOKEN_ADDRESS ?? manifest.assets.confidentialCreditToken,
  );
  const adapterAddress = ethers.getAddress(
    process.env.CVC_ERC7984_ADAPTER_ADDRESS ?? manifest.contracts.ERC7984CreditAdapter.address,
  );
  const token = new ethers.Contract(
    tokenAddress,
    [
      "function symbol() view returns (string)",
      "function confidentialBalanceOf(address account) view returns (bytes32)",
      "function confidentialTransfer(address to, bytes32 encryptedAmount, bytes inputProof) returns (bytes32)",
      "function confidentialTransferAndCall(address to, bytes32 encryptedAmount, bytes inputProof, bytes data) returns (bytes32)",
    ],
    borrower,
  ) as unknown as Contract;
  const adapter = (await ethers.getContractAt(
    "ERC7984CreditAdapter",
    adapterAddress,
    borrower,
  )) as unknown as ERC7984CreditAdapter;

  const gas: GasLine[] = [];
  const commitmentHash = uniqueHash("lender-credit-commitment", lender.address);
  const drawAuthorizationHash = uniqueHash("lender-credit-draw", borrower.address);
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 3600);

  console.log("ERC7984 reusable lender credit Sepolia smoke");
  console.log(`borrower=${borrower.address}`);
  console.log(`lender=${lender.address}`);
  console.log(`cUSDC=${tokenAddress} ${await token.getFunction("symbol")()}`);
  console.log(`erc7984CreditAdapter=${adapterAddress}`);
  console.log(`commitmentHash=${commitmentHash}`);
  console.log(`drawAuthorizationHash=${drawAuthorizationHash}`);
  console.log(`borrowerBalanceHandleBefore=${await token.getFunction("confidentialBalanceOf")(borrower.address)}`);
  console.log(`lenderBalanceHandleBefore=${await token.getFunction("confidentialBalanceOf")(lender.address)}`);

  await fundLenderEthIfNeeded(borrower, lender.address, gas);

  const seed = await encryptedAmount(tokenAddress, borrower.address, COMMITMENT_AMOUNT);
  const seedTx = await token.connect(borrower).getFunction("confidentialTransfer")(
    lender.address,
    seed.handle,
    seed.inputProof,
  );
  gas.push(await waitGas("seedLenderConfidentialCredit", seedTx));
  console.log(`seedLenderConfidentialCreditTx=${seedTx.hash}`);

  const registerTx = await adapter
    .connect(lender)
    .registerLenderCreditCommitment(commitmentHash, lender.address, expiry);
  gas.push(await waitGas("registerLenderCreditCommitment", registerTx));
  console.log(`registerLenderCreditCommitmentTx=${registerTx.hash}`);
  console.log(`executableBeforeEscrow=${await adapter.isCreditCommitmentExecutable(commitmentHash, lender.address)}`);

  const escrowed = await encryptedAmount(tokenAddress, lender.address, COMMITMENT_AMOUNT);
  const escrowTx = await token.connect(lender).getFunction("confidentialTransferAndCall")(
    adapterAddress,
    escrowed.handle,
    escrowed.inputProof,
    ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [commitmentHash]),
  );
  gas.push(await waitGas("escrowLenderCommitmentCredit", escrowTx));
  console.log(`escrowLenderCommitmentCreditTx=${escrowTx.hash}`);
  console.log(`executableAfterEscrow=${await adapter.isCreditCommitmentExecutable(commitmentHash, lender.address)}`);

  const bindTx = await adapter
    .connect(borrower)
    .registerCreditDrawAuthorization(drawAuthorizationHash, commitmentHash, lender.address, DRAW_AMOUNT, expiry);
  gas.push(await waitGas("bindCommitmentAuthorization", bindTx));
  console.log(`bindCommitmentAuthorizationTx=${bindTx.hash}`);
  console.log(`executableAfterBind=${await adapter.isCreditCommitmentExecutable(commitmentHash, lender.address)}`);

  const authorization = await adapter.getAuthorization(drawAuthorizationHash);
  const proof = await publicDecryptAcceptance(authorization.acceptanceHandle);
  console.log(`boundCommitmentAccepted=${proof.accepted}`);
  if (!proof.accepted) {
    throw new Error("Bound lender commitment was not sufficient for the expected draw.");
  }

  const finalizeTx = await adapter.finalizeCreditAcceptance(
    drawAuthorizationHash,
    proof.accepted,
    proof.decryptionProof,
  );
  gas.push(await waitGas("finalizeBoundCommitmentAcceptance", finalizeTx));
  console.log(`finalizeBoundCommitmentAcceptanceTx=${finalizeTx.hash}`);

  const creditedAmount = await adapter.consumeCredit.staticCall(drawAuthorizationHash, borrower.address);
  console.log(`creditedAmount=${creditedAmount.toString()}`);
  const consumeTx = await adapter.consumeCredit(drawAuthorizationHash, borrower.address);
  gas.push(await waitGas("consumeBoundCommitmentCredit", consumeTx));
  console.log(`consumeBoundCommitmentCreditTx=${consumeTx.hash}`);

  const releaseTx = await adapter.releaseCredit(drawAuthorizationHash, borrower.address, borrower.address);
  gas.push(await waitGas("releaseBoundCommitmentCredit", releaseTx));
  console.log(`releaseBoundCommitmentCreditTx=${releaseTx.hash}`);
  console.log(`executableAfterConsume=${await adapter.isCreditCommitmentExecutable(commitmentHash, lender.address)}`);
  console.log(`borrowerBalanceHandleAfter=${await token.getFunction("confidentialBalanceOf")(borrower.address)}`);
  console.log(`lenderBalanceHandleAfter=${await token.getFunction("confidentialBalanceOf")(lender.address)}`);
  console.log("gasSummary=");
  console.log(JSON.stringify(gas, null, 2));
}

async function fundLenderEthIfNeeded(borrower: SepoliaSigner, lenderAddress: string, gas: GasLine[]) {
  const balance = await ethers.provider.getBalance(lenderAddress);
  console.log(`lenderEthBalanceBefore=${balance.toString()}`);
  if (balance >= MIN_LENDER_ETH) return;

  const tx = await borrower.sendTransaction({ to: lenderAddress, value: LENDER_ETH_TOP_UP });
  gas.push(await waitGas("fundLenderEth", tx));
  console.log(`fundLenderEthTx=${tx.hash}`);
}

async function encryptedAmount(contractAddress: string, userAddress: string, amount: bigint) {
  const relayer = await relayerInstance();
  const builder = relayer.createEncryptedInput(ethers.getAddress(contractAddress), ethers.getAddress(userAddress));
  builder.add64(amount);
  const encrypted = await builder.encrypt();
  return {
    handle: ethers.hexlify(encrypted.handles[0]),
    inputProof: ethers.hexlify(encrypted.inputProof),
  };
}

async function publicDecryptAcceptance(handle: string) {
  const relayer = await relayerInstance();
  const normalizedHandle = ethers.hexlify(handle) as `0x${string}`;
  const decrypted = await relayer.publicDecrypt([normalizedHandle]);
  return {
    accepted: Boolean(decrypted.clearValues[normalizedHandle]),
    decryptionProof: decrypted.decryptionProof,
  };
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

async function waitGas(
  action: string,
  tx: { hash: string; wait(confirmations?: number): Promise<{ gasUsed?: bigint } | null> },
) {
  const receipt = await tx.wait(1);
  return {
    action,
    hash: tx.hash,
    gasUsed: receipt?.gasUsed?.toString(),
  };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
