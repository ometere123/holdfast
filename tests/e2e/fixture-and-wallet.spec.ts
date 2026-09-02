import { test, expect } from "@playwright/test";

test.describe("Holdfast served production build", () => {
  test("labels bundled fixtures and keeps the wallet surface injected-only", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Fixtures")).toBeVisible();
    await expect(page.getByText("These are bundled fixtures, not chain state.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect wallet" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Bond a page" })).toBeVisible();
  });

  test("create page does not silently enable writes without an injected wallet", async ({ page }) => {
    await page.goto("/create");
    await expect(page.getByText("No injected wallet was found in this browser.")).toBeVisible();
    await expect(page.getByText(/Nothing was bonded and nothing was held/)).toHaveCount(0);
    await expect(page.getByText("Why this matters")).toBeVisible();
    await expect(page.getByText("Technical detail")).toBeVisible();
  });

  test("activity keeps wallet-related state separate from local browser writes", async ({ page }) => {
    await page.goto("/transactions");
    await expect(page.getByRole("heading", { name: "Activity", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Connected wallet activity" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent writes from this browser" })).toBeVisible();
    await expect(page.getByText("Connect a wallet to see bonds where this address is the promisor or payee.")).toBeVisible();
    await expect(page.getByText("No recent writes from this browser.")).toBeVisible();
  });
});
