import hre, { ethers } from "hardhat";
import type { Contract } from "ethers";

const DEFAULT_SEPOLIA_CUSDC = "0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639";
const EXPECTED_AMOUNT = 2n;
const WRONG_AMOUNT = 1n;

async function main() {
  const tokenAddress = ethers.getAddress(process.env.CVC_ERC7984_TOKEN_ADDRESS ?? DEFAULT_SEPOLIA_CUSDC);
  const adapterAddress =
    process.env.CVC_ERC7984_ADAPTER_ADDRESS ?? (await hre.deployments.get("ERC7984CreditAdapter")).address;
  const [deployer] = await ethers.getSigners();
  const adapter = await ethers.getContractAt("ERC7984CreditAdapter", adapterAddress);
  const token = new ethers.Contract(
    tokenAddress,
    [
      "function symbol() view returns (string)",
      "function confidentialBalanceOf(address account) view returns (bytes32)",
      "function confidentialTransferAndCall(address to, bytes32 encryptedAmount, bytes inputProof, bytes data) returns (bytes32)",
    ],
    deployer,
  );

  const adapterToken = await adapter.token();
  if (ethers.getAddress(adapterToken) !== tokenAddress) {
    throw new Error(`Adapter token mismatch: expected ${tokenAddress}, got ${adapterToken}`);
  }

  const authorizationHash = ethers.keccak256(
    ethers.solidityPacked(
      ["string", "address", "uint256"],
      ["sepolia-erc7984-wrong-amount-smoke", deployer.address, Date.now()],
    ),
  );
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

  console.log("deployer:", deployer.address);
  console.log("token:", tokenAddress, await token.symbol());
  console.log("adapter:", adapterAddress);
  console.log("authorizationHash:", authorizationHash);
  console.log("confidentialBalanceHandleBefore:", await token.confidentialBalanceOf(deployer.address));

  const registerTx = await adapter.registerAuthorization(
    authorizationHash,
    deployer.address,
    deployer.address,
    EXPECTED_AMOUNT,
    deadline,
  );
  const registerReceipt = await registerTx.wait(1);
  console.log("registerAuthorizationTx:", registerTx.hash, "gasUsed:", registerReceipt?.gasUsed.toString());

  const data = ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [authorizationHash]);
  const wrongTransferTx = await transferEncryptedAmount(
    token,
    tokenAddress,
    deployer.address,
    adapterAddress,
    data,
    WRONG_AMOUNT,
  );
  const wrongTransferReceipt = await wrongTransferTx.wait(1);
  console.log("wrongAmountTransferTx:", wrongTransferTx.hash, "gasUsed:", wrongTransferReceipt?.gasUsed.toString());

  const rejected = await adapter.getAuthorization(authorizationHash);
  const rejectedProof = await publicDecryptAcceptance(rejected.acceptanceHandle);
  console.log("wrongAmountAccepted:", rejectedProof.accepted);
  if (rejectedProof.accepted) {
    throw new Error("Wrong amount was publicly decrypted as accepted");
  }

  const rejectFinalizeTx = await adapter.finalizeCreditAcceptance(
    authorizationHash,
    rejectedProof.accepted,
    rejectedProof.decryptionProof,
  );
  const rejectFinalizeReceipt = await rejectFinalizeTx.wait(1);
  console.log("rejectFinalizeTx:", rejectFinalizeTx.hash, "gasUsed:", rejectFinalizeReceipt?.gasUsed.toString());

  const afterReject = await adapter.getAuthorization(authorizationHash);
  console.log("afterRejectReceived:", afterReject.received);
  console.log("afterRejectAcceptanceHandle:", afterReject.acceptanceHandle);

  const correctTransferTx = await transferEncryptedAmount(
    token,
    tokenAddress,
    deployer.address,
    adapterAddress,
    data,
    EXPECTED_AMOUNT,
  );
  const correctTransferReceipt = await correctTransferTx.wait(1);
  console.log(
    "correctAmountTransferTx:",
    correctTransferTx.hash,
    "gasUsed:",
    correctTransferReceipt?.gasUsed.toString(),
  );

  const accepted = await adapter.getAuthorization(authorizationHash);
  const acceptedProof = await publicDecryptAcceptance(accepted.acceptanceHandle);
  console.log("correctAmountAccepted:", acceptedProof.accepted);
  if (!acceptedProof.accepted) {
    throw new Error("Correct amount was not publicly decrypted as accepted");
  }

  const acceptFinalizeTx = await adapter.finalizeCreditAcceptance(
    authorizationHash,
    acceptedProof.accepted,
    acceptedProof.decryptionProof,
  );
  const acceptFinalizeReceipt = await acceptFinalizeTx.wait(1);
  console.log("acceptFinalizeTx:", acceptFinalizeTx.hash, "gasUsed:", acceptFinalizeReceipt?.gasUsed.toString());

  const creditedAmount = await adapter.consumeCredit.staticCall(authorizationHash, deployer.address);
  console.log("creditedAmount:", creditedAmount.toString());
  const consumeTx = await adapter.consumeCredit(authorizationHash, deployer.address);
  const consumeReceipt = await consumeTx.wait(1);
  console.log("consumeCreditTx:", consumeTx.hash, "gasUsed:", consumeReceipt?.gasUsed.toString());
  console.log("confidentialBalanceHandleAfter:", await token.confidentialBalanceOf(deployer.address));
}

async function transferEncryptedAmount(
  token: Contract,
  tokenAddress: string,
  userAddress: string,
  adapterAddress: string,
  data: string,
  amount: bigint,
) {
  const encrypted = await encryptedAmount(tokenAddress, userAddress, amount);
  return token.confidentialTransferAndCall(adapterAddress, encrypted.handle, encrypted.inputProof, data);
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
