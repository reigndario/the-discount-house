/* global window, document, getComputedStyle -- used inside page.evaluate callbacks, which run in the browser */
// Browser test for the Desk chat (Phase 4a). Starts the built site, drives /desk in headless Chromium and checks the
// conversation, the draft diagram, and the privacy and styling rules. Build first: npm run build --workspace tdh-site
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const siteDir = fileURLToPath(new URL("../apps/site/", import.meta.url));
if (!existsSync(`${siteDir}.next/BUILD_ID`)) {
  console.error("No site build found. Run: npm run build --workspace tdh-site");
  process.exit(1);
}

const port = await new Promise((resolve) => {
  const s = createServer().listen(0, () => {
    const { port } = s.address();
    s.close(() => resolve(port));
  });
});
const base = `http://127.0.0.1:${port}`;
const server = spawn("npx", ["next", "start", "-p", String(port), "-H", "127.0.0.1"], {
  cwd: siteDir,
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(base)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`site did not start:\n${serverLog}`);
}

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`ok   ${name}`);
  } catch (err) {
    results.push({ name, ok: false });
    console.log(`FAIL ${name}\n     ${err.message.split("\n")[0]}`);
  }
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const requests = [];
  const errors = [];
  page.on("request", (r) => requests.push(r.url()));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  const say = async (text) => {
    await page.fill("#desk-input", text);
    await page.press("#desk-input", "Enter");
  };
  const transcript = () => page.locator("ol[aria-live]").innerText();

  await check("opens with the entry chips and a privacy note", async () => {
    await page.goto(`${base}/desk`);
    await page.waitForSelector("#desk-input");
    for (const name of ["Borrow", "Lend", "Deposit into ATP", "Withdraw from ATP", "Docs"]) {
      assert.ok(
        await page
          .locator("main")
          .getByRole(name === "Docs" ? "link" : "button", { name })
          .isVisible(),
        `${name} chip`,
      );
    }
    assert.match(await page.locator("main").innerText(), /Drafted in your browser\. Nothing is sent\./);
    assert.ok(await page.locator("section[aria-label='Your draft']").getByText("Encrypted").isVisible(), "legend");
  });

  await check("?side= pre-fills the side", async () => {
    await page.goto(`${base}/desk?side=lender`);
    await page.waitForSelector("#desk-input");
    assert.match(await transcript(), /How much do you want to lend/);
    assert.match(await page.locator("section[aria-label='Your draft']").innerText(), /lender/i);
  });

  await check("drafts a bundle from plain language, one question at a time", async () => {
    await page.goto(`${base}/desk`);
    await page.waitForSelector("#desk-input");
    await say("I want to borrow between 80k and 120k usdc");
    await page.getByText("What collateral amount do you want?").waitFor();
    await say("between 100k and 175k tokens");
    await say("5% to 8%");
    await say("about 90 days");
    await page.getByRole("button", { name: "Exactly 90" }).click();
    await page.getByText("Draft complete. Nothing has been sent.").waitFor();
    const text = await transcript();
    assert.doesNotMatch(text, /target 6\.5/, "the chat no longer repeats the draft");
    const diagram = await page.locator("section[aria-label='Your draft']").innerText();
    assert.match(diagram, /Loan amount/);
    assert.match(diagram, /P<250000/);
    assert.match(diagram, /80k – 120k/);
  });

  await check("asks instead of guessing when a number has no unit", async () => {
    await page.goto(`${base}/desk`);
    await page.waitForSelector("#desk-input");
    await say("borrow 100k");
    await page.getByText('What is "100k"?').waitFor();
    await page.getByRole("button", { name: "loan amount" }).click();
    assert.match(await page.locator("section[aria-label='Your draft']").innerText(), /100k/);
  });

  await check("says so when it finds nothing usable", async () => {
    await page.goto(`${base}/desk`);
    await page.waitForSelector("#desk-input");
    await say("hello there");
    await page.getByText("I did not catch a value in that.").waitFor();
  });

  await check("nothing leaves the origin and nothing is stored but the theme", async () => {
    const foreign = requests.filter((u) => !u.startsWith(base) && !u.startsWith("data:"));
    assert.deepEqual(foreign, []);
    await page.goto(`${base}/atp`);
    await page.waitForLoadState("networkidle");
    assert.deepEqual(
      requests.filter((u) => !u.startsWith(base) && !u.startsWith("data:")),
      [],
    );
    const keys = await page.evaluate(() => Object.keys(localStorage));
    assert.ok(
      keys.every((k) => k === "theme"),
      `localStorage keys: ${keys}`,
    );
    assert.deepEqual(await page.evaluate(() => Object.keys(sessionStorage)), []);
  });

  await check("input and buttons are sharp-cornered with no shadows", async () => {
    await page.goto(`${base}/desk`);
    await page.waitForSelector("#desk-input");
    for (const sel of ["#desk-input", "button[type=submit]", "main button"]) {
      const s = await page
        .locator(sel)
        .first()
        .evaluate((el) => {
          const c = getComputedStyle(el);
          return { radius: c.borderRadius, shadow: c.boxShadow };
        });
      assert.equal(s.radius, "0px", `${sel} radius`);
      assert.equal(s.shadow, "none", `${sel} shadow`);
    }
  });

  await check("color carries state: blue stated, yellow default, red problem", async () => {
    const fills = async () =>
      page
        .locator("section[aria-label='Your draft'] li div.absolute.inset-y-0")
        .evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor));
    await page.goto(`${base}/desk`);
    await page.waitForSelector("#desk-input");
    await say("borrow between 80k and 120k usdc");
    const colors = await fills();
    assert.ok(colors.includes("rgb(28, 63, 148)"), `stated fill should be blue: ${colors}`);
    assert.ok(colors.includes("rgb(244, 195, 0)"), `default fill should be yellow: ${colors}`);
    await page.goto(`${base}/desk`);
    await page.waitForSelector("#desk-input");
    await say("borrow at least 200k usdc and at most 100k usdc");
    assert.ok((await fills()).includes("rgb(224, 48, 30)"), "a contradictory range should be red");
  });

  await check("Desk keeps the site's blue sidebar", async () => {
    const bg = await page
      .locator("aside")
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    assert.equal(bg, "rgb(28, 63, 148)");
  });

  await check("fits a phone screen with no sideways scroll", async () => {
    const phone = await browser.newPage({ viewport: { width: 375, height: 800 } });
    await phone.goto(`${base}/desk`);
    await phone.waitForSelector("#desk-input");
    await phone.fill("#desk-input", "I want to borrow between 80k and 120k usdc");
    await phone.press("#desk-input", "Enter");
    const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `overflows by ${overflow}px`);
    await phone.close();
  });

  // Home page layout. Desktop puts the four marks and the brand in one row; below 1024px it stays stacked.
  const homeBoxes = async (p) => {
    await p.goto(`${base}/`);
    await p.waitForSelector("nav[aria-label=Primary]");
    const box = async (name) => await p.getByRole("link", { name }).boundingBox();
    return {
      borrow: await box("Borrow"),
      lend: await box("Lend"),
      atp: await box("ATP"),
      docs: await box("Docs"),
      logo: await p.locator("main img").first().boundingBox(),
    };
  };
  const midY = (b) => b.y + b.height / 2;

  await check("desktop home: Borrow, Lend, brand, ATP, Docs in one row", async () => {
    const wide = await browser.newPage({ viewport: { width: 1440, height: 860 } });
    const h = await homeBoxes(wide);
    assert.ok(
      h.borrow.x < h.lend.x && h.lend.x < h.logo.x && h.logo.x < h.atp.x && h.atp.x < h.docs.x,
      "left to right order",
    );
    const mids = [h.borrow, h.lend, h.atp, h.docs].map(midY);
    assert.ok(Math.max(...mids) - Math.min(...mids) < 4, `marks share a line: ${mids}`);
    assert.ok(Math.abs(midY(h.logo) - mids[0]) < 90, "brand sits on the same row");
    assert.ok(h.logo.width >= 160, `logo is large: ${h.logo.width}px`);
    const centerX = h.logo.x + h.logo.width / 2;
    assert.ok(Math.abs(centerX - 720) < 4, `brand is centered: ${centerX}`);
    await wide.close();
  });

  await check("mobile home stays stacked: brand above a two-by-two grid", async () => {
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const h = await homeBoxes(phone);
    assert.ok(h.logo.y + h.logo.height < h.borrow.y, "brand above the marks");
    assert.ok(h.borrow.x < h.lend.x && Math.abs(h.borrow.y - h.lend.y) < 4, "Borrow and Lend share a row");
    assert.ok(h.atp.y > h.borrow.y + 40 && h.atp.x < h.docs.x, "ATP and Docs on the next row");
    assert.ok(h.logo.width >= 80, `logo is larger than before: ${h.logo.width}px`);
    assert.ok(
      (await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0,
      "no sideways scroll",
    );
    await phone.close();
  });

  await check("the logo is a transparent cutout", async () => {
    const { default: sharp } = await import("sharp");
    const buf = Buffer.from(await (await fetch(`${base}/tdh-logo.png`)).arrayBuffer());
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.ok(info.width >= 512, `source is at least 512px: ${info.width}`);
    const alphaAt = (x, y) => data[(y * info.width + x) * 4 + 3];
    for (const [x, y] of [
      [2, 2],
      [info.width - 3, 2],
      [2, info.height - 3],
      [info.width - 3, info.height - 3],
    ]) {
      assert.equal(alphaAt(x, y), 0, `corner (${x},${y}) is transparent`);
    }
    assert.equal(alphaAt(info.width >> 1, info.height >> 1), 255, "center is solid");
  });

  await check("no page errors", async () => assert.deepEqual(errors, []));
} finally {
  await browser?.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
