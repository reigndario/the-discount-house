import { chromium } from "@playwright/test";

const baseUrl = process.env.CVC_UI_URL ?? "http://127.0.0.1/";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
const smokeAccount = "0x1111111111111111111111111111111111111111";

await page.addInitScript((account) => {
  window.ethereum = {
    isMetaMask: true,
    request: async ({ method }) => {
      if (method === "eth_accounts" || method === "eth_requestAccounts") return [account];
      if (method === "eth_chainId") return "0xaa36a7";
      if (method === "net_version") return "11155111";
      if (method === "wallet_switchEthereumChain") return null;
      if (method === "eth_blockNumber") return "0x1";
      if (method === "eth_getLogs") return [];
      if (method === "eth_call") return "0x";
      throw new Error(`UI smoke mock provider unsupported method ${method}`);
    },
    on: () => {},
    removeListener: () => {},
  };
}, smokeAccount);

page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console error: ${message.text()}`);
});
page.on("pageerror", (error) => {
  errors.push(`page error: ${error.message}`);
});

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => globalThis.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  const startupHelpDismiss = page.getByRole("button", { name: "Dismiss", exact: true });
  if (await startupHelpDismiss.isVisible({ timeout: 2000 }).catch(() => false)) {
    await startupHelpDismiss.click();
  }

  await page.getByRole("button", { name: "Book", exact: true }).click();
  await page.getByText("Coarse Discovery Buckets").waitFor({ timeout: 5000 });
  await page.evaluate(() => window.CVCDragonApp?.setRoleFromDragonSide("blue"));
  await page.getByRole("button", { name: "Builder", exact: true }).click();
  await page.getByRole("heading", { name: /Preference Bundles/i, level: 3 }).waitFor({ timeout: 5000 });
  await page.getByRole("button", { name: "Loans", exact: true }).click();
  await page.getByText("Lender execution surface").waitFor({ timeout: 5000 });
  await page.evaluate(() => window.CVCDragonApp?.setRoleFromDragonSide("red"));
  await page.getByText("Borrower execution surface").waitFor({ timeout: 5000 });
  await page.getByText("Execute Borrower Bundle").waitFor({ timeout: 5000 });

  await page.screenshot({ path: "tmp/ui-smoke-loans.png", fullPage: true });
} catch (error) {
  await page.screenshot({ path: "tmp/ui-smoke-failure.png", fullPage: true });
  throw error;
} finally {
  await browser.close();
}

if (errors.length > 0) {
  throw new Error(errors.join("\n"));
}

console.log(`UI smoke passed at ${baseUrl}`);
