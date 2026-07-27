import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const shotDir = path.join(__dirname, "screenshots", "wave4-ux");

const viewports = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 800 },
] as const;

test.describe("Wave 4 UX visual regression", () => {
  for (const vp of viewports) {
    test(`landing @ ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/");
      await expect(page.getByTestId("search-form").first()).toBeVisible();
      await expect(page.getByTestId("hero-product-preview")).toBeVisible();
      await expect(page.getByTestId("rating-comparison")).toBeVisible();
      await page.screenshot({
        path: path.join(shotDir, `landing-${vp.name}.png`),
        fullPage: true,
      });
    });

    test(`profile @ ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/character/EU/tarren-mill/Aleria");
      await expect(page.getByTestId("score-header")).toBeVisible();
      await expect(page.getByTestId("core-dimensions")).toBeVisible();
      await expect(page.getByTestId("profile-tabs")).toBeVisible();
      await page.getByTestId("tab-keys").click();
      await expect(page.getByTestId("selected-runs")).toBeVisible();
      await page.getByTestId("tab-overview").click();
      await page.screenshot({
        path: path.join(shotDir, `profile-${vp.name}.png`),
        fullPage: true,
      });
    });
  }

  test("unrated grade stays Unrated (not zero)", async ({ page }) => {
    await page.goto("/character/EU/outland/Unrated");
    await expect(page.getByTestId("grade")).toContainText(/Unrated|U/i);
    await expect(page.getByTestId("overall-score")).not.toHaveText("0");
    await page.getByTestId("tab-keys").click();
    await expect(page.getByTestId("selected-runs-empty")).toBeVisible();
  });
});
