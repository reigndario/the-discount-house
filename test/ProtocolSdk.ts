import { ethers } from "hardhat";
import { expect } from "chai";
import {
  Priority,
  PreferenceDirection,
  PreferenceSide,
  TERM_FIELD_COUNT,
  TERM_FIELD_NAMES,
  TermFieldName,
  allTermsComputed,
  asciiBucket,
  bundleInput,
  canonicalBundleHash,
  computedTermMask,
  defaultsForSide,
  deriveBackingId,
  durationBucketLabel,
  encryptBundleFields,
  fieldPreference,
  impliedCollateralPrice,
  plainBundleFields,
  principalBucketLabel,
  quoteBond,
  requiredBatchSize,
  stagedMatchPlan,
  termFieldName,
  termsHash,
  toContractFields,
  type BundleRelayer,
  type PlainBundle,
  type PlainSide,
} from "../src/protocolSdk";

const HANDLE = "0x" + "11".repeat(32);
const HANDLE2 = "0x" + "22".repeat(32);
const HANDLE3 = "0x" + "33".repeat(32);
const PROOF = "0x1234";

function encryptedField() {
  return {
    range: { min: HANDLE, max: HANDLE2, target: HANDLE3 },
    direction: HANDLE,
    priority: HANDLE2,
  };
}

describe("protocolSdk", function () {
  it("builds validated encrypted Preference Bundle inputs aligned to the contract ABI", function () {
    const input = bundleInput({
      metadata: {
        side: PreferenceSide.Borrower,
        collateralToken: "0x0000000000000000000000000000000000000001",
        tokenOpsManager: "0x0000000000000000000000000000000000000002",
        principalBucket: asciiBucket("P<150000"),
        durationBucket: asciiBucket("D<000180"),
        expiry: 1_800_000_000,
      },
      backingId: ethers.keccak256(ethers.toUtf8Bytes("backing")),
      collateralAmount: encryptedField(),
      principal: encryptedField(),
      collateralTokenPriceE8: encryptedField(),
      interestBps: encryptedField(),
      durationDays: encryptedField(),
      gracePeriodDays: encryptedField(),
      inputProof: PROOF,
    });

    expect(input.metadata.side).to.equal(PreferenceSide.Borrower);
    expect(input.metadata.principalBucket).to.equal(asciiBucket("P<150000"));
    expect(input.backingId).to.equal(ethers.keccak256(ethers.toUtf8Bytes("backing")));
    expect(input.principal.priority).to.equal(HANDLE2);
  });

  it("keeps plaintext validation helpers for UI-side bundle construction", function () {
    const plain = plainBundleFields({
      side: PreferenceSide.Lender,
      collateralToken: "0x0000000000000000000000000000000000000001",
      tokenOpsManager: "0x0000000000000000000000000000000000000002",
      principalBucket: asciiBucket("P<150000"),
      durationBucket: asciiBucket("D<000180"),
      expiry: 1_800_000_000,
      backingId: ethers.keccak256(ethers.toUtf8Bytes("backing")),
      collateralAmount: {
        range: { min: 100_000n, target: 150_000n, max: 200_000n },
        direction: PreferenceDirection.LowerIsBetter,
        priority: Priority.Critical,
      },
      principal: { range: { min: 50_000n, target: 75_000n, max: 100_000n } },
      collateralTokenPriceE8: { range: { min: 60_000_000, target: 75_000_000, max: 90_000_000 } },
      interestBps: { range: { min: 700, target: 900, max: 1_200 } },
      durationDays: { range: { min: 60, target: 90, max: 120 } },
      gracePeriodDays: { range: { min: 3, target: 7, max: 14 } },
    });

    expect(plain.metadata.side).to.equal(PreferenceSide.Lender);
    expect(plain.collateralAmount.priority).to.equal(Priority.Critical);
    expect(plain.principal.direction).to.equal(PreferenceDirection.Neutral);
  });

  it("rejects invalid bundle fields before contract submission", function () {
    expect(() =>
      fieldPreference({
        range: { min: 100, target: 90, max: 120 },
      }),
    ).to.throw("range.target must be inside");

    expect(() =>
      fieldPreference({
        range: { min: 100, target: 100, max: 120 },
        priority: 5 as never,
      }),
    ).to.throw("priority must be a valid Priority");

    expect(() =>
      bundleInput({
        metadata: {
          side: PreferenceSide.Lender,
          collateralToken: ethers.ZeroAddress,
          tokenOpsManager: "0x0000000000000000000000000000000000000002",
          principalBucket: asciiBucket("P<150000"),
          durationBucket: asciiBucket("D<000180"),
          expiry: 1_800_000_000,
        },
        backingId: ethers.ZeroHash,
        collateralAmount: encryptedField(),
        principal: encryptedField(),
        collateralTokenPriceE8: encryptedField(),
        interestBps: encryptedField(),
        durationDays: encryptedField(),
        gracePeriodDays: encryptedField(),
        inputProof: PROOF,
      }),
    ).to.throw("backingId must be a nonzero bytes32");
  });

  it("mirrors BondManager batch-size and quote math", function () {
    const config = {
      baseBondWei: ethers.parseEther("0.1"),
      configuredMinBatchSize: 3,
      treasuryShareBps: 2_000,
      thinMarketPenaltyBps: 1_000,
    };

    expect(requiredBatchSize(2, config.configuredMinBatchSize)).to.equal(2n);
    expect(requiredBatchSize(8, config.configuredMinBatchSize)).to.equal(3n);
    expect(quoteBond({ candidateCount: 3, availableCounterparties: 8, config })).to.equal(ethers.parseEther("0.1"));
    expect(quoteBond({ candidateCount: 2, availableCounterparties: 2, config })).to.equal(ethers.parseEther("0.11"));
  });

  it("derives stable term hashes for escrow config previews", function () {
    expect(
      termsHash({
        principalAmount: 100_000n,
        collateralTokenPriceE8: 75_000_000,
        interestBps: 800,
        durationDays: 90,
        gracePeriodDays: 7,
      }),
    ).to.equal(
      termsHash({
        principalAmount: 100_000n,
        collateralTokenPriceE8: 75_000_000,
        interestBps: 800,
        durationDays: 90,
        gracePeriodDays: 7,
      }),
    );
  });

  it("documents the staged matcher transaction order and term field indexes", function () {
    expect(TERM_FIELD_COUNT).to.equal(6);
    expect(termFieldName(0)).to.equal(TermFieldName.CollateralAmount);
    expect(termFieldName(1)).to.equal(TermFieldName.Principal);
    expect(termFieldName(5)).to.equal(TermFieldName.GracePeriodDays);
    expect(() => termFieldName(6)).to.throw("fieldIndex must be 0..5");

    const plan = stagedMatchPlan();
    expect(plan.map((step) => step.kind)).to.deep.equal([
      "executeMatch",
      "computeSelectedTerm",
      "computeSelectedTerm",
      "computeSelectedTerm",
      "computeSelectedTerm",
      "computeSelectedTerm",
      "computeSelectedTerm",
      "commitEncryptedTerms",
      "finalizeMatchFeasibility",
      "settleMatch",
    ]);
    expect(plan[2]).to.deep.equal({
      kind: "computeSelectedTerm",
      fieldIndex: 1,
      fieldName: TermFieldName.Principal,
    });
  });

  it("tracks selected-term computation masks", function () {
    expect(computedTermMask([0, 1, 2, 3, 4, 5])).to.equal(0x3f);
    expect(computedTermMask([1, 1, 5])).to.equal(0x22);
    expect(allTermsComputed(0x3f)).to.equal(true);
    expect(allTermsComputed(0x7f)).to.equal(true);
    expect(allTermsComputed(0x1f)).to.equal(false);
    expect(() => computedTermMask([6])).to.throw("fieldIndex must be 0..5");
  });
});

const TOKEN = "0x0000000000000000000000000000000000000001";
const MANAGER = "0x0000000000000000000000000000000000000002";
const ACCOUNT = "0x0000000000000000000000000000000000000003";
const BOOK = "0x0000000000000000000000000000000000000004";

function plainBundle(side: PlainSide = "borrower"): PlainBundle {
  return {
    side,
    collateralToken: TOKEN,
    tokenOpsManager: MANAGER,
    backingId: deriveBackingId("B-0001"),
    expiryDays: 30,
    collateralAmount: { range: { min: 100_000, max: 200_000, target: 150_000 } },
    principal: { range: { min: 50, max: 100, target: 100 } },
    interestPercent: { range: { min: 5, max: 10, target: 7 } },
    durationDays: { range: { min: 180, max: 720, target: 360 } },
    gracePeriodDays: { range: { min: 0, max: 15, target: 7 } },
  };
}

describe("protocolSdk plain bundles", function () {
  describe("bucket labels", function () {
    it("rounds up to the fixed principal ceilings and keeps exact ceilings", function () {
      expect(principalBucketLabel(0)).to.equal("P<000050");
      expect(principalBucketLabel(50)).to.equal("P<000050");
      expect(principalBucketLabel(50.01)).to.equal("P<000150");
      expect(principalBucketLabel(120)).to.equal("P<000150");
      expect(principalBucketLabel(500_000)).to.equal("P<500000");
      expect(principalBucketLabel(5_000n)).to.equal("P<005000");
    });

    it("steps by 250,000 principal and 365 duration days beyond the last fixed ceiling", function () {
      expect(principalBucketLabel(500_001)).to.equal("P<750000");
      expect(principalBucketLabel(750_000)).to.equal("P<750000");
      expect(principalBucketLabel(1_000_001)).to.equal("P<1250000");
      expect(durationBucketLabel(3_650)).to.equal("D<003650");
      expect(durationBucketLabel(3_651)).to.equal("D<004015");
    });

    it("rounds up to the fixed duration ceilings", function () {
      expect(durationBucketLabel(0)).to.equal("D<000180");
      expect(durationBucketLabel(180)).to.equal("D<000180");
      expect(durationBucketLabel(181)).to.equal("D<000720");
      expect(durationBucketLabel(720)).to.equal("D<000720");
      expect(durationBucketLabel(1_461)).to.equal("D<002190");
    });

    it("rejects negative and non-finite values", function () {
      expect(() => principalBucketLabel(-1)).to.throw("principal max must be a non-negative finite number");
      expect(() => durationBucketLabel(Number.NaN)).to.throw("duration max must be a non-negative finite number");
      expect(() => durationBucketLabel(Number.POSITIVE_INFINITY)).to.throw("non-negative finite");
    });

    it("produces labels that asciiBucket encodes the same way ethers does, without Buffer", function () {
      const label = principalBucketLabel(120);
      expect(asciiBucket(label)).to.equal(ethers.encodeBytes32String(label));
      expect(() => asciiBucket("")).to.throw("bucket label must be 1..32");
      expect(() => asciiBucket("x".repeat(33))).to.throw("bucket label must be 1..32");
    });
  });

  describe("impliedCollateralPrice", function () {
    it("divides principal by collateral across the ranges and rounds to 4 decimals", function () {
      const price = impliedCollateralPrice(
        { min: 50, max: 100, target: 100 },
        { min: 100_000, max: 200_000, target: 150_000 },
        "borrower",
      );
      expect(price.range).to.deep.equal({ min: 0.0003, max: 0.001, target: 0.0007 });
      expect(price.direction).to.equal("higher_is_better");
    });

    it("prefers a lower price for lenders and clamps the target inside the range", function () {
      const price = impliedCollateralPrice({ min: 10, max: 20, target: 100 }, { min: 2, max: 5, target: 5 }, "lender");
      expect(price.direction).to.equal("lower_is_better");
      expect(price.range.target).to.equal(price.range.max);
    });

    it("clamps zero collateral divisors to 1", function () {
      const price = impliedCollateralPrice({ min: 1, max: 4, target: 2 }, { min: 0, max: 0, target: 0 }, "borrower");
      expect(price.range).to.deep.equal({ min: 1, max: 4, target: 2 });
    });

    it("rejects an unknown side", function () {
      expect(() =>
        impliedCollateralPrice({ min: 1, max: 1, target: 1 }, { min: 1, max: 1, target: 1 }, "x" as never),
      ).to.throw("side must be borrower or lender");
    });
  });

  describe("defaultsForSide", function () {
    it("gives borrowers and lenders opposing directions on the same fields", function () {
      const borrower = defaultsForSide("borrower");
      const lender = defaultsForSide("lender");
      expect(borrower.directions.collateralAmount).to.equal("lower_is_better");
      expect(lender.directions.collateralAmount).to.equal("higher_is_better");
      expect(borrower.directions.principal).to.equal("higher_is_better");
      expect(lender.directions.principal).to.equal("target_is_best");
      expect(borrower.directions.interestPercent).to.equal("lower_is_better");
      expect(borrower.directions.durationDays).to.equal("higher_is_better");
      expect(lender.directions.gracePeriodDays).to.equal("lower_is_better");
    });

    it("carries priorities, grace period and expiry defaults", function () {
      const defaults = defaultsForSide("borrower");
      expect(defaults.priorities).to.deep.equal({
        collateralAmount: 4,
        principal: 5,
        interestPercent: 5,
        durationDays: 3,
        gracePeriodDays: 3,
      });
      expect(defaults.gracePeriodDays).to.deep.equal({ min: 0, max: 15, target: 7 });
      expect(defaults.expiryDays).to.equal(30);
      expect(() => defaultsForSide("x" as never)).to.throw("side must be borrower or lender");
    });
  });

  describe("deriveBackingId", function () {
    it("is deterministic, distinct per bundle and matches the harness derivation", function () {
      expect(deriveBackingId("B-0001")).to.equal(ethers.keccak256(ethers.toUtf8Bytes("cvc:backing:B-0001")));
      expect(deriveBackingId("B-0001")).to.equal(deriveBackingId("B-0001"));
      expect(deriveBackingId("B-0001")).to.not.equal(deriveBackingId("B-0002"));
      expect(() => deriveBackingId("")).to.throw("bundleId must be nonempty");
    });
  });

  describe("toContractFields", function () {
    it("scales units and maps priority and direction to the contract encodings", function () {
      const fields = toContractFields(plainBundle("borrower"));
      expect(fields.collateralAmount.range).to.deep.equal({ min: 100_000n, max: 200_000n, target: 150_000n });
      expect(fields.collateralAmount.direction).to.equal(PreferenceDirection.LowerIsBetter);
      expect(fields.collateralAmount.priority).to.equal(Priority.High);
      expect(fields.principal.priority).to.equal(Priority.Critical);
      expect(fields.interestBps.range).to.deep.equal({ min: 500n, max: 1_000n, target: 700n });
      expect(fields.collateralTokenPriceE8.range).to.deep.equal({
        min: 30_000n,
        max: 100_000n,
        target: 70_000n,
      });
      expect(fields.collateralTokenPriceE8.direction).to.equal(PreferenceDirection.HigherIsBetter);
      expect(fields.collateralTokenPriceE8.priority).to.equal(fields.collateralAmount.priority);
      expect(fields.durationDays.priority).to.equal(Priority.Normal);
      expect(Object.keys(fields)).to.deep.equal([...TERM_FIELD_NAMES]);
    });

    it("lets explicit directions and priorities override the side defaults", function () {
      const plain = plainBundle("lender");
      plain.interestPercent = { ...plain.interestPercent, direction: "neutral", priority: 1 };
      const fields = toContractFields(plain);
      expect(fields.interestBps.direction).to.equal(PreferenceDirection.Neutral);
      expect(fields.interestBps.priority).to.equal(Priority.VeryLow);
    });

    it("scales fractional percent rates to whole basis points", function () {
      const plain = plainBundle();
      plain.interestPercent = { range: { min: 0.1, max: 12.55, target: 5.05 } };
      const fields = toContractFields(plain);
      expect(fields.interestBps.range).to.deep.equal({ min: 10n, max: 1_255n, target: 505n });
    });

    it("rejects priorities outside 1..5, bad ranges and negative values", function () {
      const bad = plainBundle();
      bad.principal = { ...bad.principal, priority: 0 as never };
      expect(() => toContractFields(bad)).to.throw("principal priority must be an integer 1..5");
      bad.principal = { ...bad.principal, priority: 6 as never };
      expect(() => toContractFields(bad)).to.throw("principal priority must be an integer 1..5");

      const inverted = plainBundle();
      inverted.durationDays = { range: { min: 10, max: 5, target: 7 } };
      expect(() => toContractFields(inverted)).to.throw("range.min must be <= range.max");

      const outside = plainBundle();
      outside.gracePeriodDays = { range: { min: 0, max: 10, target: 11 } };
      expect(() => toContractFields(outside)).to.throw("range.target must be inside [min, max]");

      const negative = plainBundle();
      negative.collateralAmount = { range: { min: -1, max: 5, target: 1 } };
      expect(() => toContractFields(negative)).to.throw("must be a non-negative finite number");
    });
  });

  describe("canonicalBundleHash", function () {
    it("is stable and independent of how defaults were stated", function () {
      const implicit = plainBundle();
      const explicit = plainBundle();
      explicit.principal = { ...explicit.principal, direction: "higher_is_better", priority: 5 };
      expect(canonicalBundleHash(implicit)).to.equal(canonicalBundleHash(implicit));
      expect(canonicalBundleHash(implicit)).to.equal(canonicalBundleHash(explicit));
      expect(canonicalBundleHash(implicit)).to.match(/^0x[0-9a-f]{64}$/);
    });

    it("changes when any confirmed value changes", function () {
      const base = canonicalBundleHash(plainBundle());
      const variants: PlainBundle[] = [];
      for (const mutate of [
        (b: PlainBundle) => (b.side = "lender"),
        (b: PlainBundle) => (b.collateralToken = MANAGER),
        (b: PlainBundle) => (b.tokenOpsManager = TOKEN),
        (b: PlainBundle) => (b.backingId = deriveBackingId("B-0002")),
        (b: PlainBundle) => (b.expiryDays = 31),
        (b: PlainBundle) => (b.collateralAmount.range.target = 150_001),
        (b: PlainBundle) => (b.principal.range.max = 101),
        (b: PlainBundle) => (b.interestPercent.range.min = 4),
        (b: PlainBundle) => (b.durationDays.priority = 4),
        (b: PlainBundle) => (b.gracePeriodDays.direction = "neutral"),
      ]) {
        const next = plainBundle();
        mutate(next);
        variants.push(next);
      }
      const hashes = variants.map(canonicalBundleHash);
      for (const hash of hashes) expect(hash).to.not.equal(base);
      expect(new Set(hashes).size).to.equal(hashes.length);
    });

    it("hashes addresses case-insensitively and normalizes equal numeric values", function () {
      const lower = plainBundle();
      const checksummed = plainBundle();
      checksummed.collateralToken = ethers.getAddress(TOKEN);
      checksummed.interestPercent = { range: { min: 5.0, max: 10.0, target: 7.0 } };
      expect(canonicalBundleHash(lower)).to.equal(canonicalBundleHash(checksummed));
    });

    it("rejects an invalid expiry or backing id", function () {
      const badExpiry = plainBundle();
      badExpiry.expiryDays = 0;
      expect(() => canonicalBundleHash(badExpiry)).to.throw("expiryDays must be a positive integer");
      const badBacking = plainBundle();
      badBacking.backingId = "0x1234";
      expect(() => canonicalBundleHash(badBacking)).to.throw("backingId must be a nonzero bytes32");
    });
  });

  describe("encryptBundleFields", function () {
    function fakeRelayer(handleCount = 30) {
      const calls: { contract?: string; user?: string; add64: bigint[]; add8: number[] } = { add64: [], add8: [] };
      const relayer: BundleRelayer = {
        createEncryptedInput(contract, user) {
          calls.contract = contract;
          calls.user = user;
          return {
            add64: (value) => calls.add64.push(value),
            add8: (value) => calls.add8.push(value),
            generateZKProof: () => "proof",
          };
        },
        async requestZKProofVerification() {
          const handles = Array.from({ length: handleCount }, (_, i) => new Uint8Array(32).fill(i + 1));
          return { handles, inputProof: new Uint8Array([0x12, 0x34]) };
        },
      };
      return { relayer, calls };
    }

    it("adds fields in term order and maps handles back to fields", async function () {
      const { relayer, calls } = fakeRelayer();
      const encrypted = await encryptBundleFields(relayer, BOOK, ACCOUNT, plainBundle());

      expect(calls.contract).to.equal(ethers.getAddress(BOOK));
      expect(calls.user).to.equal(ethers.getAddress(ACCOUNT));
      expect(calls.add64).to.have.length(18);
      expect(calls.add8).to.have.length(12);
      expect(calls.add64.slice(0, 3)).to.deep.equal([100_000n, 200_000n, 150_000n]);
      expect(calls.add8.slice(0, 2)).to.deep.equal([PreferenceDirection.LowerIsBetter, Priority.High]);
      expect(calls.add64.slice(6, 9)).to.deep.equal([30_000n, 100_000n, 70_000n]);

      expect(encrypted.collateralAmount.range.min).to.equal("0x" + "01".repeat(32));
      expect(encrypted.collateralAmount.priority).to.equal("0x" + "05".repeat(32));
      expect(encrypted.principal.range.min).to.equal("0x" + "06".repeat(32));
      expect(encrypted.gracePeriodDays.priority).to.equal("0x" + "1e".repeat(32));
      expect(encrypted.inputProof).to.equal("0x1234");
    });

    it("produces output that bundleInput accepts", async function () {
      const { relayer } = fakeRelayer();
      const encrypted = await encryptBundleFields(relayer, BOOK, ACCOUNT, plainBundle());
      const input = bundleInput({
        metadata: {
          side: PreferenceSide.Borrower,
          collateralToken: TOKEN,
          tokenOpsManager: MANAGER,
          principalBucket: asciiBucket(principalBucketLabel(100)),
          durationBucket: asciiBucket(durationBucketLabel(720)),
          expiry: 1_900_000_000,
        },
        backingId: deriveBackingId("B-0001"),
        ...encrypted,
      });
      expect(input.inputProof).to.equal("0x1234");
    });

    it("rejects an unexpected handle count and invalid bundles before calling the relayer", async function () {
      let threw = "";
      try {
        await encryptBundleFields(fakeRelayer(29).relayer, BOOK, ACCOUNT, plainBundle());
      } catch (error) {
        threw = (error as Error).message;
      }
      expect(threw).to.equal("relayer returned 29 handles, expected 30");

      const { relayer, calls } = fakeRelayer();
      const bad = plainBundle();
      bad.principal = { range: { min: 10, max: 5, target: 7 } };
      let invalid = "";
      try {
        await encryptBundleFields(relayer, BOOK, ACCOUNT, bad);
      } catch (error) {
        invalid = (error as Error).message;
      }
      expect(invalid).to.equal("range.min must be <= range.max");
      expect(calls.contract).to.equal(undefined);
    });
  });
});
