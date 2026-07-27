import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, type Page } from "@playwright/test";

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../../..");

async function searchCharacter(page: Page, name: string): Promise<void> {
  await page.goto("/");
  await page.getByTestId("realm-input").fill("tarren-mill");
  await page.getByTestId("name-input").fill(name);
  await page.getByTestId("search-submit").click();
  await expect(page).toHaveURL(new RegExp(name, "i"));
  const queued = page.getByTestId("queued-banner");
  if (await queued.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await expect(queued).toBeHidden({ timeout: 90_000 });
  }
  await expect(page.getByTestId("score-header")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("freshness")).toHaveText("FRESH", { timeout: 90_000 });
}

test.describe("fixture pipeline E2E (live API + inline worker)", () => {
  test("search → refresh → profile → compare → addon export", async ({ page }) => {
    const suffix = Date.now().toString(36);
    const nameA = `E2eplayerA-${suffix}`;
    const nameB = `E2eplayerB-${suffix}`;

    await page.goto("/");
    await expect(page.getByTestId("api-mode")).toContainText("live");

    await searchCharacter(page, nameA);
    await expect(page.getByTestId("raiderio-attribution")).toBeVisible();
    await expect(page.getByTestId("overall-score")).not.toHaveText("—");
    await expect(page.getByTestId("wcl-visibility")).toHaveText(/^(PUBLIC|NO_MATCHED_RUN)$/);

    await searchCharacter(page, nameB);

    await page.goto("/compare");
    const removeButtons = page.getByRole("button", { name: "Remove" });
    for (let i = await removeButtons.count(); i > 0; i -= 1) {
      await removeButtons.first().click();
    }

    for (const name of [nameA, nameB]) {
      await page.getByTestId("compare-realm").fill("tarren-mill");
      await page.getByTestId("compare-name").fill(name);
      await page.getByTestId("compare-add").click();
      await expect(page.getByTestId("compare-candidates")).toContainText(name);
    }

    await expect(page.locator('[data-testid="compare-candidates"] li')).toHaveCount(2);

    await page.getByTestId("compare-submit").click();
    const compareError = page.getByTestId("compare-error");
    const compareTable = page.getByTestId("compare-table");
    await expect(compareTable.or(compareError)).toBeVisible({ timeout: 60_000 });
    if (await compareError.isVisible()) {
      throw new Error(`Comparison failed: ${await compareError.textContent()}`);
    }
    await expect(page.getByTestId("compare-table").getByRole("rowheader", { name: nameA })).toBeVisible();
    await expect(page.getByTestId("compare-table").getByRole("rowheader", { name: nameB })).toBeVisible();

    execFileSync("pnpm", ["addon:export"], {
      cwd: REPO_ROOT,
      shell: true,
      env: {
        ...process.env,
        DATABASE_URL:
          process.env.DATABASE_URL ??
          "postgresql://mplus:mplus@localhost:5433/mplus_trust?schema=public",
        PROVIDER_MODE: "fixture",
      },
      stdio: "pipe",
    });

    const dataDir = join(REPO_ROOT, "addon/MPlusTrust/Data");
    expect(existsSync(dataDir)).toBe(true);
    const meta = readFileSync(join(dataDir, "meta.lua"), "utf8");
    expect(meta.length).toBeGreaterThan(0);
  });
});
