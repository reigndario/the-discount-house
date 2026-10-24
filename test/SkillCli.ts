import { expect } from "chai";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { run } from "../src/skill/cli";
import { canonicalBundleHash, type PlainBundle } from "../src/protocolSdk";

const WALLET = {
  "collateral-token": "0x258F9D60dc023870e4E3109c894D834D5377361a",
  manager: "0xb32208BF362b48672cAf58C52Ee45908e3cc6333",
  "backing-id": "0x" + "ab".repeat(32),
};

function flagsOf(obj: Record<string, string>) {
  return Object.entries(obj).flatMap(([k, v]) => [`--${k}`, v]);
}

describe("bundle interview CLI", () => {
  let dir: string;
  let draft: string;
  const turnOf = (r: ReturnType<typeof run>) => r.output.turn as { done: boolean; slot?: string; question?: string };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tdh-skill-"));
    draft = join(dir, "draft.json");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const say = (text: string) => run(["say", "--draft", draft, "--text", text]);

  function completeBorrowerDraft() {
    run(["init", "--draft", draft]);
    say("I want to borrow between 80k and 120k usdc");
    say("between 100k and 175k tokens");
    say("5% to 8%");
    say("about 90 days");
    expect(run(["reply", "--draft", draft, "--index", "0"]).code).to.equal(0);
  }

  it("starts by asking what the user wants to do", () => {
    const r = run(["init", "--draft", draft]);
    expect(r.code).to.equal(0);
    expect(turnOf(r).slot).to.equal("side");
  });

  it("treats a bare number as the answer to the question just asked", () => {
    run(["init", "--draft", draft]);
    say("borrow about 100k usdc");
    run(["reply", "--draft", draft, "--index", "0"]); // exactly 100k
    say("100k tokens");
    say("7");
    const r = say("90");
    expect(r.code).to.equal(0);
  });

  it("refuses to emit an incomplete draft, with the open question and exit code 2", () => {
    run(["init", "--draft", draft]);
    say("borrow about 100k usdc");
    const r = run(["emit", "--draft", draft, "--out", join(dir, "b.json")]);
    expect(r.code).to.equal(2);
    expect(r.output.turn).to.have.property("question");
  });

  it("emits terms without a hash when no wallet fields are given", () => {
    completeBorrowerDraft();
    const out = join(dir, "b.json");
    const r = run(["emit", "--draft", draft, "--out", out]);
    expect(r.code).to.equal(0);
    const file = JSON.parse(readFileSync(out, "utf8"));
    expect(file.format).to.equal("cvc-bundle/1");
    expect(file.wallet).to.equal(null);
    expect(file.hash).to.equal(null);
    expect(file.terms.principal.range).to.deep.equal({ min: 80_000, max: 120_000, target: 100_000 });
    expect(file.provenance["gracePeriodDays.target"].source).to.equal("default");
    expect(file.provenance["principal.min"]).to.deep.equal({ source: "stated", span: "80k" });
  });

  it("emits the SDK's canonicalBundleHash when all wallet fields are given", () => {
    completeBorrowerDraft();
    const out = join(dir, "b.json");
    const r = run(["emit", "--draft", draft, "--out", out, ...flagsOf(WALLET)]);
    expect(r.code).to.equal(0);
    const file = JSON.parse(readFileSync(out, "utf8"));
    const plain = {
      ...file.terms,
      collateralToken: WALLET["collateral-token"],
      tokenOpsManager: WALLET.manager,
      backingId: WALLET["backing-id"],
    } as PlainBundle;
    expect(file.hash).to.equal(canonicalBundleHash(plain));
  });

  it("rejects partial wallet fields", () => {
    completeBorrowerDraft();
    const r = run(["emit", "--draft", draft, "--out", join(dir, "b.json"), "--manager", WALLET.manager]);
    expect(r.code).to.equal(1);
    expect(String(r.output.error)).to.contain("all of");
  });

  it("emits an ATP intent", () => {
    run(["init", "--draft", draft]);
    say("deposit");
    say("2500");
    const out = join(dir, "atp.json");
    expect(run(["emit", "--draft", draft, "--out", out]).code).to.equal(0);
    const file = JSON.parse(readFileSync(out, "utf8"));
    expect(file.format).to.equal("cvc-atp-intent/1");
    expect(file.intent).to.deep.equal({ kind: "atp_deposit", amount: 2500 });
  });

  it("reports usage errors with exit code 1", () => {
    expect(run(["say", "--draft", draft]).code).to.equal(1);
    expect(run(["nope"]).code).to.equal(1);
    expect(run(["status", "--draft", join(dir, "missing.json")]).code).to.equal(1);
    expect(run(["reply", "--draft", draft, "--index", "9"]).code).to.equal(1);
  });

  describe("committed bundle", () => {
    const bin = join(__dirname, "..", "skills", "bundle-interview", "bin", "tdh-bundle.cjs");

    it("is up to date with the source", () => {
      const r = spawnSync("node", [join(__dirname, "..", "scripts", "build-skill.mjs"), "--check"], {
        encoding: "utf8",
      });
      expect(r.status, r.stderr).to.equal(0);
    });

    it("runs on its own and needs nothing but node:fs", () => {
      const code = readFileSync(bin, "utf8");
      const requires = [...code.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1]);
      expect([...new Set(requires)]).to.deep.equal(["node:fs"]);
      const r = spawnSync("node", [bin, "init", "--draft", join(dir, "x.json")], { encoding: "utf8" });
      expect(r.status).to.equal(0);
      expect(JSON.parse(r.stdout).turn.slot).to.equal("side");
    });
  });
});
