import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end smoke tests against a served production build.
 *
 * There is deliberately no `webServer` here. A local `next dev` would prove the source
 * builds, which `npm run build` already proves. What is not otherwise proven is that the
 * thing on the internet is in live mode, is pointed at the contract this commit claims,
 * and renders a record that really exists on StudioNet. Only the deployed origin can
 * answer that, so that is what these tests open.
 *
 * `E2E_BASE_URL` overrides the origin, for running the same suite against a preview
 * deployment before promoting it. An empty value is the same as an absent one, because a
 * workflow input that was left blank arrives as "".
 *
 * No test here sends a transaction. The injected wallet the wallet tests install answers
 * `eth_requestAccounts`, `eth_chainId` and `wallet_switchEthereumChain` and throws on
 * everything else, so a signing path cannot be reached even by accident and the suite
 * costs no GEN however often it runs.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  // Reads go over the public StudioNet RPC. A retry costs a page load; a flake that gets
  // read as a regression costs an afternoon.
  retries: 2,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  // A cold serverless route plus a live contract read is slower than a local page.
  timeout: 90_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:3213",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run start -- -p 3213",
    url: "http://127.0.0.1:3213",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
