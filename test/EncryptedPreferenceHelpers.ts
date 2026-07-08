import hre from "hardhat";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ConfidentialPreferenceBook } from "../types";

export const BORROWER = 0;
export const LENDER = 1;
export const LOWER_IS_BETTER = 0;
export const HIGHER_IS_BETTER = 1;
export const TARGET_IS_BEST = 2;
export const NORMAL = 2;

export function id(label: string) {
  return ethers.keccak256(ethers.toUtf8Bytes(label));
}

export function ascii32(label: string) {
  return ethers.encodeBytes32String(label);
}

export type PlainField = {
  min: bigint | number;
  max: bigint | number;
  target: bigint | number;
  direction?: number;
  priority?: number;
};

function plainField(min: bigint | number, max: bigint | number, target: bigint | number, direction = TARGET_IS_BEST) {
  return { min, max, target, direction, priority: NORMAL };
}

export async function encryptedBundleInput(
  book: ConfidentialPreferenceBook,
  manager: HardhatEthersSigner,
  overrides: Partial<{
    side: number;
    collateralToken: string;
    tokenOpsManager: string;
    principalBucket: string;
    durationBucket: string;
    backingId: string;
    expiry: number;
    collateralAmount: PlainField;
    principal: PlainField;
    collateralTokenPriceE8: PlainField;
    interestBps: PlainField;
    durationDays: PlainField;
    gracePeriodDays: PlainField;
  }> = {},
) {
  const now = Number(await time.latest());
  const plain = {
    side: overrides.side ?? BORROWER,
    collateralToken: overrides.collateralToken ?? manager.address,
    tokenOpsManager: overrides.tokenOpsManager ?? manager.address,
    principalBucket: overrides.principalBucket ?? ascii32("P<150000"),
    durationBucket: overrides.durationBucket ?? ascii32("D<000720"),
    expiry: overrides.expiry ?? now + 3600,
    backingId: overrides.backingId ?? id(`backing:${manager.address}:default`),
    collateralAmount: overrides.collateralAmount ?? plainField(100_000, 200_000, 150_000, HIGHER_IS_BETTER),
    principal: overrides.principal ?? plainField(75_000, 125_000, 100_000, HIGHER_IS_BETTER),
    collateralTokenPriceE8:
      overrides.collateralTokenPriceE8 ?? plainField(60_000_000, 90_000_000, 75_000_000, HIGHER_IS_BETTER),
    interestBps: overrides.interestBps ?? plainField(500, 800, 500, LOWER_IS_BETTER),
    durationDays: overrides.durationDays ?? plainField(360, 720, 720, HIGHER_IS_BETTER),
    gracePeriodDays: overrides.gracePeriodDays ?? plainField(7, 30, 30, HIGHER_IS_BETTER),
  };

  const input = hre.fhevm.createEncryptedInput(await book.getAddress(), manager.address);
  const fields = [
    plain.collateralAmount,
    plain.principal,
    plain.collateralTokenPriceE8,
    plain.interestBps,
    plain.durationDays,
    plain.gracePeriodDays,
  ];
  for (const field of fields) {
    input.add64(BigInt(field.min));
    input.add64(BigInt(field.max));
    input.add64(BigInt(field.target));
    input.add8(field.direction ?? TARGET_IS_BEST);
    input.add8(field.priority ?? NORMAL);
  }
  const encrypted = await input.encrypt();
  let cursor = 0;
  const nextField = () => {
    const result = {
      range: {
        min: ethers.hexlify(encrypted.handles[cursor++]),
        max: ethers.hexlify(encrypted.handles[cursor++]),
        target: ethers.hexlify(encrypted.handles[cursor++]),
      },
      direction: ethers.hexlify(encrypted.handles[cursor++]),
      priority: ethers.hexlify(encrypted.handles[cursor++]),
    };
    return result;
  };

  return {
    metadata: {
      side: plain.side,
      collateralToken: plain.collateralToken,
      tokenOpsManager: plain.tokenOpsManager,
      principalBucket: plain.principalBucket,
      durationBucket: plain.durationBucket,
      expiry: plain.expiry,
    },
    backingId: plain.backingId,
    collateralAmount: nextField(),
    principal: nextField(),
    collateralTokenPriceE8: nextField(),
    interestBps: nextField(),
    durationDays: nextField(),
    gracePeriodDays: nextField(),
    inputProof: ethers.hexlify(encrypted.inputProof),
  };
}

export async function createEncryptedBundle(
  book: ConfidentialPreferenceBook,
  manager: HardhatEthersSigner,
  overrides: Parameters<typeof encryptedBundleInput>[2] = {},
) {
  const input = await encryptedBundleInput(book, manager, overrides);
  const preferenceId = await book.connect(manager).createPreferenceBundle.staticCall(input);
  await book.connect(manager).createPreferenceBundle(input);
  return { input, preferenceId };
}
