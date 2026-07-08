import hre, { ethers } from "hardhat";

const DEFAULT_SEPOLIA_CUSDC = "0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639";
const TRANSFER_AMOUNT = 1_000_000n; // 1 cUSDCMock, 6 decimals

async function main() {
  const tokenAddress = ethers.getAddress(process.env.CVC_ERC7984_TOKEN_ADDRESS ?? DEFAULT_SEPOLIA_CUSDC);
  const adapterAddress =
    process.env.CVC_ERC7984_ADAPTER_ADDRESS ?? (await hre.deployments.get("ERC7984CreditAdapter")).address;
  const [deployer] = await ethers.getSigners();
  const adapter = await ethers.getContractAt("ERC7984CreditAdapter", adapterAddress);
  const token = new ethers.Contract(
    tokenAddress,
    [
      "function name() view returns (string)",
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
      ["sepolia-erc7984-credit-smoke", deployer.address, Date.now()],
    ),
  );
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

  console.log("deployer:", deployer.address);
  console.log("token:", tokenAddress, await token.symbol(), await token.name());
  console.log("adapter:", adapterAddress);
  console.log("authorizationHash:", authorizationHash);
  console.log("confidentialBalanceHandleBefore:", await token.confidentialBalanceOf(deployer.address));

  const registerTx = await adapter.registerAuthorization(
    authorizationHash,
    deployer.address,
    deployer.address,
    TRANSFER_AMOUNT,
    deadline,
  );
  const registerReceipt = await registerTx.wait(1);
  console.log("registerAuthorizationTx:", registerTx.hash, "gasUsed:", registerReceipt?.gasUsed.toString());

  const encrypted = await encryptedAmount(tokenAddress, deployer.address, TRANSFER_AMOUNT);
  const data = ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [authorizationHash]);
  const transferTx = await token.confidentialTransferAndCall(
    adapterAddress,
    encrypted.handle,
    encrypted.inputProof,
    data,
  );
  const transferReceipt = await transferTx.wait(1);
  console.log("confidentialTransferAndCallTx:", transferTx.hash, "gasUsed:", transferReceipt?.gasUsed.toString());

  const received = await adapter.getAuthorization(authorizationHash);
  console.log("amountHandle:", received.amountHandle);
  console.log("acceptanceHandle:", received.acceptanceHandle);

  const { accepted, decryptionProof } = await publicDecryptAcceptance(received.acceptanceHandle);
  console.log("publicDecryptAccepted:", accepted);

  const finalizeTx = await adapter.finalizeCreditAcceptance(authorizationHash, accepted, decryptionProof);
  const finalizeReceipt = await finalizeTx.wait(1);
  console.log("finalizeCreditAcceptanceTx:", finalizeTx.hash, "gasUsed:", finalizeReceipt?.gasUsed.toString());

  const creditedAmount = await adapter.consumeCredit.staticCall(authorizationHash, deployer.address);
  console.log("creditedAmount:", creditedAmount.toString());
  const consumeTx = await adapter.consumeCredit(authorizationHash, deployer.address);
  const consumeReceipt = await consumeTx.wait(1);
  console.log("consumeCreditTx:", consumeTx.hash, "gasUsed:", consumeReceipt?.gasUsed.toString());
  console.log("confidentialBalanceHandleAfter:", await token.confidentialBalanceOf(deployer.address));
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
