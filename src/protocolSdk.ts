import { AbiCoder, getAddress, isHexString, keccak256, toUtf8Bytes } from "ethers";

export const MAX_BUNDLE_RANK = 32;
export const TERM_FIELD_COUNT = 6;
export const ALL_TERMS_COMPUTED_MASK = (1 << TERM_FIELD_COUNT) - 1;
export const BPS_DENOMINATOR = 10_000n;
export const UINT64_MAX = (1n << 64n) - 1n;

export const PreferenceSide = {
  Borrower: 0,
  Lender: 1,
} as const;

export const PreferenceDirection = {
  LowerIsBetter: 0,
  HigherIsBetter: 1,
  TargetIsBest: 2,
  Neutral: 3,
} as const;

export const Priority = {
  VeryLow: 0,
  Low: 1,
  Normal: 2,
  High: 3,
  Critical: 4,
} as const;

export type PreferenceSideValue = (typeof PreferenceSide)[keyof typeof PreferenceSide];
export type PreferenceDirectionValue = (typeof PreferenceDirection)[keyof typeof PreferenceDirection];
export type PriorityValue = (typeof Priority)[keyof typeof Priority];

export type RangeInput = {
  min: bigint | number;
  max: bigint | number;
  target: bigint | number;
};

export type EncryptedRangeHandleInput = {
  min: string;
  max: string;
  target: string;
};

export type EncryptedFieldHandleInput = {
  range: EncryptedRangeHandleInput;
  direction: string;
  priority: string;
};

export type FieldPreferenceInput = {
  range: RangeInput;
  direction?: PreferenceDirectionValue;
  priority?: PriorityValue;
};

export type BundleInputParams = {
  metadata: {
    side: PreferenceSideValue;
    collateralToken: string;
    tokenOpsManager: string;
    principalBucket: string;
    durationBucket: string;
    expiry: bigint | number;
  };
  backingId: string;
  inputProof: string;
  collateralAmount: EncryptedFieldHandleInput;
  principal: EncryptedFieldHandleInput;
  collateralTokenPriceE8: EncryptedFieldHandleInput;
  interestBps: EncryptedFieldHandleInput;
  durationDays: EncryptedFieldHandleInput;
  gracePeriodDays: EncryptedFieldHandleInput;
};

export type PlainBundleInputParams = {
  side: PreferenceSideValue;
  collateralToken: string;
  tokenOpsManager: string;
  principalBucket: string;
  durationBucket: string;
  expiry: bigint | number;
  backingId: string;
  collateralAmount: FieldPreferenceInput;
  principal: FieldPreferenceInput;
  collateralTokenPriceE8: FieldPreferenceInput;
  interestBps: FieldPreferenceInput;
  durationDays: FieldPreferenceInput;
  gracePeriodDays: FieldPreferenceInput;
};

export type BondConfig = {
  baseBondWei: bigint | number;
  configuredMinBatchSize: bigint | number;
  treasuryShareBps: bigint | number;
  thinMarketPenaltyBps: bigint | number;
};

export type StagedMatchStep =
  | { kind: "executeMatch" }
  | { kind: "computeSelectedTerm"; fieldIndex: number; fieldName: TermFieldName }
  | { kind: "commitEncryptedTerms" }
  | { kind: "finalizeMatchFeasibility" }
  | { kind: "settleMatch" };

export const TermFieldName = {
  CollateralAmount: "collateralAmount",
  Principal: "principal",
  CollateralTokenPriceE8: "collateralTokenPriceE8",
  InterestBps: "interestBps",
  DurationDays: "durationDays",
  GracePeriodDays: "gracePeriodDays",
} as const;

export type TermFieldName = (typeof TermFieldName)[keyof typeof TermFieldName];

export const TERM_FIELD_NAMES: readonly TermFieldName[] = [
  TermFieldName.CollateralAmount,
  TermFieldName.Principal,
  TermFieldName.CollateralTokenPriceE8,
  TermFieldName.InterestBps,
  TermFieldName.DurationDays,
  TermFieldName.GracePeriodDays,
] as const;

const abiCoder = AbiCoder.defaultAbiCoder();

export function coarseBucket(params: {
  vestingAsset: string;
  principalBucket: string;
  durationBucket: string;
  jurisdiction?: string;
}) {
  return keccak256(
    abiCoder.encode(
      ["string", "string", "string", "string"],
      [params.vestingAsset, params.principalBucket, params.durationBucket, params.jurisdiction ?? ""],
    ),
  );
}

export function asciiBucket(label: string) {
  const bytes = toUtf8Bytes(label);
  if (bytes.length === 0 || bytes.length > 32) {
    throw new Error("bucket label must be 1..32 ASCII/UTF-8 bytes");
  }
  return "0x" + Buffer.from(bytes).toString("hex").padEnd(64, "0");
}

export function participantCommitment(address: string, salt: string) {
  requireBytes32(salt, "salt");
  return keccak256(abiCoder.encode(["address", "bytes32"], [getAddress(address), salt]));
}

export function termsHash(params: {
  principalAmount: bigint | number;
  collateralTokenPriceE8: bigint | number;
  interestBps: bigint | number;
  durationDays: bigint | number;
  gracePeriodDays: bigint | number;
}) {
  return keccak256(
    abiCoder.encode(
      ["uint256", "uint64", "uint16", "uint32", "uint32"],
      [
        toNonNegativeBigInt(params.principalAmount, "principalAmount"),
        toUint64(params.collateralTokenPriceE8, "collateralTokenPriceE8"),
        Number(toUint64(params.interestBps, "interestBps")),
        Number(toUint64(params.durationDays, "durationDays")),
        Number(toUint64(params.gracePeriodDays, "gracePeriodDays")),
      ],
    ),
  );
}

export function fieldPreference(input: FieldPreferenceInput) {
  const min = toUint64(input.range.min, "range.min");
  const max = toUint64(input.range.max, "range.max");
  const target = toUint64(input.range.target, "range.target");
  if (min > max) {
    throw new Error("range.min must be <= range.max");
  }
  if (target < min || target > max) {
    throw new Error("range.target must be inside [min, max]");
  }
  const direction = input.direction ?? PreferenceDirection.Neutral;
  if (!Object.values(PreferenceDirection).includes(direction)) {
    throw new Error("direction must be a valid PreferenceDirection");
  }
  const priority = input.priority ?? Priority.Normal;
  if (!Object.values(Priority).includes(priority)) {
    throw new Error("priority must be a valid Priority");
  }

  return {
    range: { min, max, target },
    direction,
    priority,
  };
}

export function bundleInput(params: BundleInputParams) {
  if (params.metadata.side !== PreferenceSide.Borrower && params.metadata.side !== PreferenceSide.Lender) {
    throw new Error("side must be Borrower or Lender");
  }
  if (!isHexString(params.inputProof) || params.inputProof === "0x") {
    throw new Error("inputProof must be nonempty hex bytes");
  }
  requireBytes32(params.backingId, "backingId");
  requireBytes32(params.metadata.principalBucket, "metadata.principalBucket");
  requireBytes32(params.metadata.durationBucket, "metadata.durationBucket");
  validateEncryptedField(params.collateralAmount, "collateralAmount");
  validateEncryptedField(params.principal, "principal");
  validateEncryptedField(params.collateralTokenPriceE8, "collateralTokenPriceE8");
  validateEncryptedField(params.interestBps, "interestBps");
  validateEncryptedField(params.durationDays, "durationDays");
  validateEncryptedField(params.gracePeriodDays, "gracePeriodDays");

  return {
    metadata: {
      side: params.metadata.side,
      collateralToken: getAddress(params.metadata.collateralToken),
      tokenOpsManager: getAddress(params.metadata.tokenOpsManager),
      principalBucket: params.metadata.principalBucket,
      durationBucket: params.metadata.durationBucket,
      expiry: toUint64(params.metadata.expiry, "metadata.expiry"),
    },
    backingId: params.backingId,
    collateralAmount: params.collateralAmount,
    principal: params.principal,
    collateralTokenPriceE8: params.collateralTokenPriceE8,
    interestBps: params.interestBps,
    durationDays: params.durationDays,
    gracePeriodDays: params.gracePeriodDays,
    inputProof: params.inputProof,
  };
}

export function plainBundleFields(params: PlainBundleInputParams) {
  return {
    metadata: {
      side: params.side,
      collateralToken: getAddress(params.collateralToken),
      tokenOpsManager: getAddress(params.tokenOpsManager),
      principalBucket: params.principalBucket,
      durationBucket: params.durationBucket,
      expiry: toUint64(params.expiry, "expiry"),
    },
    backingId: params.backingId,
    collateralAmount: fieldPreference(params.collateralAmount),
    principal: fieldPreference(params.principal),
    collateralTokenPriceE8: fieldPreference(params.collateralTokenPriceE8),
    interestBps: fieldPreference(params.interestBps),
    durationDays: fieldPreference(params.durationDays),
    gracePeriodDays: fieldPreference(params.gracePeriodDays),
  };
}

export function requiredBatchSize(availableCounterparties: bigint | number, configuredMinBatchSize: bigint | number) {
  const available = toNonNegativeBigInt(availableCounterparties, "availableCounterparties");
  const configuredMin = toPositiveBigInt(configuredMinBatchSize, "configuredMinBatchSize");
  if (available === 0n) {
    return 0n;
  }
  return available < configuredMin ? available : configuredMin;
}

export function quoteBond(params: {
  candidateCount: bigint | number;
  availableCounterparties: bigint | number;
  config: BondConfig;
}) {
  const candidateCount = toPositiveBigInt(params.candidateCount, "candidateCount");
  const availableCounterparties = toPositiveBigInt(params.availableCounterparties, "availableCounterparties");
  const baseBondWei = toPositiveBigInt(params.config.baseBondWei, "baseBondWei");
  const configuredMinBatchSize = toPositiveBigInt(params.config.configuredMinBatchSize, "configuredMinBatchSize");
  const thinMarketPenaltyBps = toBps(params.config.thinMarketPenaltyBps, "thinMarketPenaltyBps");
  toBps(params.config.treasuryShareBps, "treasuryShareBps");

  if (candidateCount > availableCounterparties) {
    throw new Error("candidateCount must be <= availableCounterparties");
  }

  const required = requiredBatchSize(availableCounterparties, configuredMinBatchSize);
  if (candidateCount < required) {
    throw new Error(`candidateCount must be at least ${required.toString()}`);
  }

  if (candidateCount >= configuredMinBatchSize) {
    return baseBondWei;
  }

  const missingCandidates = configuredMinBatchSize - candidateCount;
  return baseBondWei + (baseBondWei * thinMarketPenaltyBps * missingCandidates) / BPS_DENOMINATOR;
}

export function stagedMatchPlan(): StagedMatchStep[] {
  return [
    { kind: "executeMatch" },
    ...TERM_FIELD_NAMES.map((fieldName, fieldIndex) => ({
      kind: "computeSelectedTerm" as const,
      fieldIndex,
      fieldName,
    })),
    { kind: "commitEncryptedTerms" },
    { kind: "finalizeMatchFeasibility" },
    { kind: "settleMatch" },
  ];
}

export function termFieldName(fieldIndex: bigint | number) {
  const normalized = Number(toNonNegativeBigInt(fieldIndex, "fieldIndex"));
  const fieldName = TERM_FIELD_NAMES[normalized];
  if (!fieldName) {
    throw new Error(`fieldIndex must be 0..${TERM_FIELD_COUNT - 1}`);
  }
  return fieldName;
}

export function computedTermMask(fieldIndexes: readonly (bigint | number)[]) {
  return fieldIndexes.reduce<number>((mask, fieldIndex) => {
    const normalized = Number(toNonNegativeBigInt(fieldIndex, "fieldIndex"));
    if (normalized >= TERM_FIELD_COUNT) {
      throw new Error(`fieldIndex must be 0..${TERM_FIELD_COUNT - 1}`);
    }
    return mask | (1 << normalized);
  }, 0);
}

export function allTermsComputed(computedMask: bigint | number) {
  const normalized = Number(toNonNegativeBigInt(computedMask, "computedMask"));
  return (normalized & ALL_TERMS_COMPUTED_MASK) === ALL_TERMS_COMPUTED_MASK;
}

function validateEncryptedField(field: EncryptedFieldHandleInput, label: string) {
  requireBytes32(field.range.min, `${label}.range.min`);
  requireBytes32(field.range.max, `${label}.range.max`);
  requireBytes32(field.range.target, `${label}.range.target`);
  requireBytes32(field.direction, `${label}.direction`);
  requireBytes32(field.priority, `${label}.priority`);
}

function requireBytes32(value: string, label: string) {
  if (!isHexString(value, 32) || value === "0x" + "00".repeat(32)) {
    throw new Error(`${label} must be a nonzero bytes32`);
  }
}

function toBps(value: bigint | number, label: string) {
  const bps = toNonNegativeBigInt(value, label);
  if (bps > BPS_DENOMINATOR) {
    throw new Error(`${label} must be <= ${BPS_DENOMINATOR.toString()}`);
  }
  return bps;
}

function toPositiveBigInt(value: bigint | number, label: string) {
  const normalized = toNonNegativeBigInt(value, label);
  if (normalized === 0n) {
    throw new Error(`${label} must be > 0`);
  }
  return normalized;
}

function toUint64(value: bigint | number, label: string) {
  const normalized = toNonNegativeBigInt(value, label);
  if (normalized > UINT64_MAX) {
    throw new Error(`${label} must fit uint64`);
  }
  return normalized;
}

function toNonNegativeBigInt(value: bigint | number, label: string) {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${label} must be a non-negative safe integer`);
    }
    return BigInt(value);
  }
  if (value < 0n) {
    throw new Error(`${label} must be non-negative`);
  }
  return value;
}

export function demoEncryptedBundle(label: string) {
  return keccak256(toUtf8Bytes(label));
}
