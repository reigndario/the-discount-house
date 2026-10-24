import { AbiCoder, getAddress, hexlify, isHexString, keccak256, toUtf8Bytes } from "ethers";

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
  return hexlify(bytes).padEnd(66, "0");
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

// ---------------------------------------------------------------------------
// Plain-unit bundles: what a user states, before it becomes contract input.
//
// `PlainBundleInputParams` above is already in contract units. `PlainBundle` is in the units people use (interest in
// percent, collateral price derived from principal and collateral, priority 1-5) and is what Desk and the bundle
// interview skill produce.
// ---------------------------------------------------------------------------

export const PRINCIPAL_CEILING_BUCKETS: readonly number[] = [
  50, 150, 500, 1_000, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000,
];
export const DURATION_CEILING_BUCKETS: readonly number[] = [180, 720, 1_460, 2_190, 3_650];
const PRINCIPAL_OVERFLOW_STEP = 250_000;
const DURATION_OVERFLOW_STEP = 365;

export const PRICE_SCALE_E8 = 100_000_000;
export const INTEREST_PERCENT_TO_BPS = 100;
export const DEFAULT_EXPIRY_DAYS = 30;

export type PlainSide = "borrower" | "lender";
export type PlainDirection = "lower_is_better" | "higher_is_better" | "target_is_best" | "neutral";
export type PlainPriority = 1 | 2 | 3 | 4 | 5;
export type PlainFieldName = "collateralAmount" | "principal" | "interestPercent" | "durationDays" | "gracePeriodDays";

export type PlainRange = { min: number; max: number; target: number };

export type PlainField = {
  range: PlainRange;
  direction?: PlainDirection;
  priority?: PlainPriority;
};

export type PlainBundle = {
  side: PlainSide;
  collateralToken: string;
  tokenOpsManager: string;
  backingId: string;
  expiryDays: number;
  collateralAmount: PlainField;
  principal: PlainField;
  interestPercent: PlainField;
  durationDays: PlainField;
  gracePeriodDays: PlainField;
};

export type SideDefaults = {
  directions: Record<PlainFieldName, PlainDirection>;
  priorities: Record<PlainFieldName, PlainPriority>;
  gracePeriodDays: PlainRange;
  expiryDays: number;
};

export type ContractField = ReturnType<typeof fieldPreference>;
export type ContractFields = Record<TermFieldName, ContractField>;

const PLAIN_DIRECTION_ENUM: Record<PlainDirection, PreferenceDirectionValue> = {
  lower_is_better: PreferenceDirection.LowerIsBetter,
  higher_is_better: PreferenceDirection.HigherIsBetter,
  target_is_best: PreferenceDirection.TargetIsBest,
  neutral: PreferenceDirection.Neutral,
};

export function principalBucketLabel(max: number | bigint) {
  return bucketLabel("P", max, PRINCIPAL_CEILING_BUCKETS, PRINCIPAL_OVERFLOW_STEP, "principal max");
}

export function durationBucketLabel(max: number | bigint) {
  return bucketLabel("D", max, DURATION_CEILING_BUCKETS, DURATION_OVERFLOW_STEP, "duration max");
}

/**
 * Implied collateral price preference: principal per unit of collateral. The borrower wants a higher price, the lender
 * a lower one. Mirrors the browser harness: the divisor is clamped to at least 1 and the target is held inside the
 * range. Rounded to 4 decimals.
 */
export function impliedCollateralPrice(principal: PlainRange, collateral: PlainRange, side: PlainSide) {
  requirePlainSide(side);
  const min = principal.min / Math.max(1, collateral.max);
  const max = principal.max / Math.max(1, collateral.min);
  const target = principal.target / Math.max(1, collateral.target);
  return {
    range: {
      min: roundPrice(min),
      max: roundPrice(max),
      target: roundPrice(Math.min(max, Math.max(min, target))),
    },
    direction: (side === "borrower" ? "higher_is_better" : "lower_is_better") as PlainDirection,
  };
}

export function defaultsForSide(side: PlainSide): SideDefaults {
  requirePlainSide(side);
  const borrower = side === "borrower";
  return {
    directions: {
      collateralAmount: borrower ? "lower_is_better" : "higher_is_better",
      principal: borrower ? "higher_is_better" : "target_is_best",
      interestPercent: borrower ? "lower_is_better" : "higher_is_better",
      durationDays: borrower ? "higher_is_better" : "lower_is_better",
      gracePeriodDays: borrower ? "higher_is_better" : "lower_is_better",
    },
    priorities: { collateralAmount: 4, principal: 5, interestPercent: 5, durationDays: 3, gracePeriodDays: 3 },
    gracePeriodDays: { min: 0, max: 15, target: 7 },
    expiryDays: DEFAULT_EXPIRY_DAYS,
  };
}

export function deriveBackingId(bundleId: string) {
  if (bundleId.length === 0) {
    throw new Error("bundleId must be nonempty");
  }
  return keccak256(toUtf8Bytes(`cvc:backing:${bundleId}`));
}

/**
 * Scale a plain bundle into the six contract fields, in `TERM_FIELD_NAMES` order: interest percent x100 to bps,
 * collateral price x1e8, priority 1-5 to 0-4, direction names to the enum. Omitted directions and priorities take the
 * side defaults; the collateral price field takes the collateral amount priority.
 */
export function toContractFields(plain: PlainBundle): ContractFields {
  requirePlainSide(plain.side);
  const defaults = defaultsForSide(plain.side);
  const resolve = (name: PlainFieldName, scale: number) => {
    const field = plain[name];
    return scaledField(
      name,
      field.range,
      scale,
      field.direction ?? defaults.directions[name],
      field.priority ?? defaults.priorities[name],
    );
  };

  const collateralAmount = resolve("collateralAmount", 1);
  const principal = resolve("principal", 1);
  const price = impliedCollateralPrice(plain.principal.range, plain.collateralAmount.range, plain.side);
  return {
    collateralAmount,
    principal,
    collateralTokenPriceE8: scaledField(
      "collateralTokenPriceE8",
      price.range,
      PRICE_SCALE_E8,
      price.direction,
      plain.collateralAmount.priority ?? defaults.priorities.collateralAmount,
    ),
    interestBps: resolve("interestPercent", INTEREST_PERCENT_TO_BPS),
    durationDays: resolve("durationDays", 1),
    gracePeriodDays: resolve("gracePeriodDays", 1),
  };
}

/**
 * Hash of everything the user confirms: side, tokens, public buckets, expiry, backing and the six scaled fields with
 * resolved defaults. The confirmation gate stores this and recomputes it at submission.
 */
export function canonicalBundleHash(plain: PlainBundle) {
  const fields = toContractFields(plain);
  const expiryDays = plain.expiryDays;
  if (!Number.isSafeInteger(expiryDays) || expiryDays <= 0) {
    throw new Error("expiryDays must be a positive integer");
  }
  requireBytes32(plain.backingId, "backingId");
  const canonical = [
    "cvc:bundle:v1",
    plain.side,
    getAddress(plain.collateralToken),
    getAddress(plain.tokenOpsManager),
    principalBucketLabel(plain.principal.range.max),
    durationBucketLabel(plain.durationDays.range.max),
    String(expiryDays),
    plain.backingId.toLowerCase(),
    ...TERM_FIELD_NAMES.map((name) => {
      const field = fields[name];
      return [
        name,
        field.range.min.toString(),
        field.range.max.toString(),
        field.range.target.toString(),
        field.direction,
        field.priority,
      ];
    }),
  ];
  return keccak256(toUtf8Bytes(JSON.stringify(canonical)));
}

/** The slice of a Zama relayer instance this SDK needs, so the SDK takes no dependency on the relayer package. */
export interface RelayerEncryptedInputBuilder {
  add64(value: bigint): unknown;
  add8(value: number): unknown;
  generateZKProof(): unknown;
}

export interface BundleRelayer {
  createEncryptedInput(contractAddress: string, userAddress: string): RelayerEncryptedInputBuilder;
  requestZKProofVerification(proof: never): Promise<{
    handles: readonly (Uint8Array | string)[];
    inputProof: Uint8Array | string;
  }>;
}

export async function encryptBundleFields(
  relayer: BundleRelayer,
  bookAddress: string,
  account: string,
  plain: PlainBundle,
) {
  const fields = toContractFields(plain);
  const builder = relayer.createEncryptedInput(getAddress(bookAddress), getAddress(account));
  for (const name of TERM_FIELD_NAMES) {
    const field = fields[name];
    builder.add64(field.range.min);
    builder.add64(field.range.max);
    builder.add64(field.range.target);
    builder.add8(field.direction);
    builder.add8(field.priority);
  }

  const proof = builder.generateZKProof();
  const { handles, inputProof } = await relayer.requestZKProofVerification(proof as never);
  if (handles.length !== TERM_FIELD_COUNT * 5) {
    throw new Error(`relayer returned ${handles.length} handles, expected ${TERM_FIELD_COUNT * 5}`);
  }

  let cursor = 0;
  const next = () => hexlify(handles[cursor++]);
  const nextField = (): EncryptedFieldHandleInput => ({
    range: { min: next(), max: next(), target: next() },
    direction: next(),
    priority: next(),
  });

  return {
    collateralAmount: nextField(),
    principal: nextField(),
    collateralTokenPriceE8: nextField(),
    interestBps: nextField(),
    durationDays: nextField(),
    gracePeriodDays: nextField(),
    inputProof: hexlify(inputProof),
  };
}

function bucketLabel(
  prefix: string,
  max: number | bigint,
  fixed: readonly number[],
  overflowStep: number,
  label: string,
) {
  const value = typeof max === "bigint" ? Number(max) : max;
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number`);
  }
  const ceiling = fixed.find((candidate) => value <= candidate) ?? Math.ceil(value / overflowStep) * overflowStep;
  return `${prefix}<${String(ceiling).padStart(6, "0")}`;
}

function scaledField(
  label: string,
  range: PlainRange,
  scale: number,
  direction: PlainDirection,
  priority: PlainPriority,
) {
  if (!Number.isInteger(priority) || priority < 1 || priority > 5) {
    throw new Error(`${label} priority must be an integer 1..5`);
  }
  const directionEnum = PLAIN_DIRECTION_ENUM[direction];
  if (directionEnum === undefined) {
    throw new Error(`${label} direction must be a valid direction`);
  }
  return fieldPreference({
    range: {
      min: scaleToBigInt(range.min, scale, `${label}.range.min`),
      max: scaleToBigInt(range.max, scale, `${label}.range.max`),
      target: scaleToBigInt(range.target, scale, `${label}.range.target`),
    },
    direction: directionEnum,
    priority: (priority - 1) as PriorityValue,
  });
}

function scaleToBigInt(value: number, scale: number, label: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number`);
  }
  return BigInt(Math.round(value * scale));
}

function roundPrice(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

function requirePlainSide(side: string) {
  if (side !== "borrower" && side !== "lender") {
    throw new Error("side must be borrower or lender");
  }
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
