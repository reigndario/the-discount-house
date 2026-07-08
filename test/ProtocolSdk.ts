import { ethers } from "hardhat";
import { expect } from "chai";
import {
  Priority,
  PreferenceDirection,
  PreferenceSide,
  TERM_FIELD_COUNT,
  TermFieldName,
  allTermsComputed,
  asciiBucket,
  bundleInput,
  computedTermMask,
  fieldPreference,
  plainBundleFields,
  quoteBond,
  requiredBatchSize,
  stagedMatchPlan,
  termFieldName,
  termsHash,
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
