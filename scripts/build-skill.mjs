// Bundles src/skill/cli-main.ts into one self-contained file the skill can run with plain `node`, and writes its
// SHA-256 beside it. `--check` rebuilds in memory and fails if the committed files are stale (used by the test suite).
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const outFile = fileURLToPath(new URL("skills/bundle-interview/bin/tdh-bundle.cjs", root));

export async function bundle() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("src/skill/cli-main.ts", root))],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    legalComments: "none",
    write: false,
    outfile: outFile,
  });
  const code = result.outputFiles[0].text;
  const sha = createHash("sha256").update(code).digest("hex");
  return { code, checksum: `${sha}  tdh-bundle.cjs\n` };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { code, checksum } = await bundle();
  if (process.argv.includes("--check")) {
    const stale = readFileSync(outFile, "utf8") !== code || readFileSync(`${outFile}.sha256`, "utf8") !== checksum;
    if (stale) {
      console.error("skills/bundle-interview/bin is stale: run npm run build:skill");
      process.exit(1);
    }
    console.log("skill bundle is up to date");
  } else {
    writeFileSync(outFile, code);
    writeFileSync(`${outFile}.sha256`, checksum);
    console.log(`wrote ${outFile} (${code.length} bytes)`);
  }
}
