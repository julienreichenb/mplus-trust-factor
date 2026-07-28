import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const SCREENSHOT_DIR = join("e2e", "screenshots", "ability-catalog");

async function unlockIfNeeded(page: import("@playwright/test").Page): Promise<void> {
  const gate = page.getByTestId("admin-gate");
  if (await gate.isVisible().catch(() => false)) {
    await page.getByTestId("admin-key").fill("test-admin-key");
    await page.getByRole("button", { name: "Unlock" }).click();
  }
}

test.describe("Ability catalog explorer", () => {
  test.beforeAll(async () => {
    await mkdir(SCREENSHOT_DIR, { recursive: true });
  });

  test("overview, expand class, search, and filter screenshots", async ({ page }) => {
    await page.goto("/admin/ability-catalog");
    await unlockIfNeeded(page);
    await expect(page.getByTestId("ability-catalog-page")).toBeVisible();
    await expect(page.getByTestId("catalog-summary")).toBeVisible({ timeout: 15_000 });

    await page.screenshot({ path: join(SCREENSHOT_DIR, "overview.png"), fullPage: true });

    const warriorSection = page.locator("[data-testid='class-section'][data-class-slug='warrior']");
    if (await warriorSection.count()) {
      await warriorSection.getByRole("button").first().click();
      await page.waitForTimeout(300);
      const specToggle = warriorSection.locator(".spec-toggle").first();
      if (await specToggle.count()) {
        await specToggle.click();
        await page.waitForTimeout(300);
      }
    } else {
      const firstClass = page.getByTestId("class-section").first();
      await firstClass.getByRole("button").first().click();
      await page.waitForTimeout(300);
    }

    await page.screenshot({ path: join(SCREENSHOT_DIR, "class-expanded.png"), fullPage: true });

    await page.getByTestId("catalog-search").fill("6552");
    await page.waitForTimeout(400);
    await expect(page.getByTestId("ability-row").first()).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: join(SCREENSHOT_DIR, "search-spell-id.png"), fullPage: true });

    await page.getByTestId("catalog-search").fill("");
    await page.waitForTimeout(400);

    const validationFilter = page.locator("[data-testid='catalog-filters'] select").last();
    await validationFilter.selectOption("uncertain");
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(SCREENSHOT_DIR, "filter-uncertain.png"), fullPage: true });
  });
});
