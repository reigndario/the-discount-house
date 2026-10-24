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
    assert.match(await transcript(), /Nothing you type here is sent anywhere/);
  });

  await check("?side= pre-fills the side", async () => {
    await page.goto(`${base}/desk?side=lender`);
    await page.waitForSelector("#desk-input");
    assert.match(await transcript(), /You are lending/);
    assert.match(await page.locator("section[aria-label='Your draft']").innerText(), /lender/);
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
    await page.getByText("That is everything I need").waitFor();
    const text = await transcript();
    assert.match(text, /grace period: 0 to 15 days, target 7 \(default\)/);
    assert.match(text, /nothing has been sent/);
    const diagram = await page.locator("section[aria-label='Your draft']").innerText();
    assert.match(diagram, /Loan amount/);
    assert.match(diagram, /Public bucket: P<250000/);
    assert.match(diagram, /default/i);
  });

  await check("asks instead of guessing when a number has no unit", async () => {
    await page.goto(`${base}/desk`);
    await page.waitForSelector("#desk-input");
    await say("borrow 100k");
    await page.getByText(/could not tell which term it belongs to/).waitFor();
    await page.getByRole("button", { name: "loan amount" }).click();
    assert.match(await page.locator("section[aria-label='Your draft']").innerText(), /target 100,000/);
  });

  await check("says so when it finds nothing usable", async () => {
    await page.goto(`${base}/desk`);
    await page.waitForSelector("#desk-input");
    await say("hello there");
    await page.getByText("I could not find a value I can use in that.").waitFor();
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

  await check("Desk drops the colored sidebar", async () => {
    const bg = (p) =>
      p
        .locator("aside")
        .first()
        .evaluate((el) => getComputedStyle(el).backgroundColor);
    assert.equal(await bg(page), "rgb(13, 13, 13)");
    await page.goto(`${base}/book`);
    assert.notEqual(await bg(page), "rgb(13, 13, 13)");
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

  await check("no page errors", async () => assert.deepEqual(errors, []));
} finally {
  await browser?.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
