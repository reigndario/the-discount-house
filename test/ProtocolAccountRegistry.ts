import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers } from "hardhat";
import { expect } from "chai";
import { ProtocolAccountRegistry, ProtocolAccountRegistry__factory } from "../types";

type Signers = {
  deployer: HardhatEthersSigner;
  owner: HardhatEthersSigner;
  operator: HardhatEthersSigner;
  outsider: HardhatEthersSigner;
};

async function deployFixture() {
  const factory = (await ethers.getContractFactory("ProtocolAccountRegistry")) as ProtocolAccountRegistry__factory;
  const registry = (await factory.deploy()) as ProtocolAccountRegistry;
  return { registry };
}

describe("ProtocolAccountRegistry", function () {
  let signers: Signers;
  let registry: ProtocolAccountRegistry;

  before(async function () {
    const ethSigners = await ethers.getSigners();
    signers = {
      deployer: ethSigners[0],
      owner: ethSigners[1],
      operator: ethSigners[2],
      outsider: ethSigners[3],
    };
  });

  beforeEach(async function () {
    ({ registry } = await deployFixture());
  });

  it("creates durable protocol accounts owned by the initial wallet", async function () {
    const ownerRole = await registry.OWNER_ROLE();

    await expect(registry.createAccount(signers.owner.address))
      .to.emit(registry, "AccountCreated")
      .withArgs(1n, signers.owner.address);

    expect(await registry.accountExistsPublic(1)).to.equal(true);
    expect(await registry.ownerCount(1)).to.equal(1n);
    expect(await registry.hasAccountRole(1, signers.owner.address, ownerRole)).to.equal(true);
    expect(await registry.nextAccountId()).to.equal(2n);
  });

  it("lets account owners grant and revoke supported wallet roles", async function () {
    await registry.createAccount(signers.owner.address);
    const ownerRole = await registry.OWNER_ROLE();
    const operatorRole = await registry.OPERATOR_ROLE();

    await expect(registry.connect(signers.owner).addWallet(1, signers.operator.address, operatorRole))
      .to.emit(registry, "WalletRoleGranted")
      .withArgs(1n, signers.operator.address, operatorRole);

    expect(await registry.hasAccountRole(1, signers.operator.address, operatorRole)).to.equal(true);
    expect(await registry.hasAccountRole(1, signers.operator.address, ownerRole)).to.equal(false);

    await expect(registry.connect(signers.owner).removeWallet(1, signers.operator.address, operatorRole))
      .to.emit(registry, "WalletRoleRevoked")
      .withArgs(1n, signers.operator.address, operatorRole);

    expect(await registry.hasAccountRole(1, signers.operator.address, operatorRole)).to.equal(false);
  });

  it("rejects role changes from non-owner wallets", async function () {
    await registry.createAccount(signers.owner.address);
    const operatorRole = await registry.OPERATOR_ROLE();

    await expect(
      registry.connect(signers.outsider).addWallet(1, signers.operator.address, operatorRole),
    ).to.be.revertedWithCustomError(registry, "Unauthorized");
  });

  it("prevents removing the last owner from an account", async function () {
    await registry.createAccount(signers.owner.address);
    const ownerRole = await registry.OWNER_ROLE();

    await expect(
      registry.connect(signers.owner).removeWallet(1, signers.owner.address, ownerRole),
    ).to.be.revertedWithCustomError(registry, "CannotRemoveLastOwner");
  });

  it("allows owner rotation when another owner exists", async function () {
    await registry.createAccount(signers.owner.address);
    const ownerRole = await registry.OWNER_ROLE();

    await registry.connect(signers.owner).addWallet(1, signers.operator.address, ownerRole);
    expect(await registry.ownerCount(1)).to.equal(2n);

    await registry.connect(signers.operator).removeWallet(1, signers.owner.address, ownerRole);

    expect(await registry.ownerCount(1)).to.equal(1n);
    expect(await registry.hasAccountRole(1, signers.owner.address, ownerRole)).to.equal(false);
    expect(await registry.hasAccountRole(1, signers.operator.address, ownerRole)).to.equal(true);
  });

  it("rejects unsupported roles and zero wallets", async function () {
    await registry.createAccount(signers.owner.address);
    const invalidRole = ethers.keccak256(ethers.toUtf8Bytes("INVALID_ROLE"));

    await expect(registry.createAccount(ethers.ZeroAddress)).to.be.revertedWithCustomError(registry, "InvalidWallet");
    await expect(
      registry.connect(signers.owner).addWallet(1, signers.operator.address, invalidRole),
    ).to.be.revertedWithCustomError(registry, "InvalidRole");
    await expect(
      registry.connect(signers.owner).addWallet(1, ethers.ZeroAddress, await registry.VIEWER_ROLE()),
    ).to.be.revertedWithCustomError(registry, "InvalidWallet");
  });
});
