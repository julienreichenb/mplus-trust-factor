import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const outDir = join(process.cwd(), "e2e", "screenshots");

async function selectRealm(
  page: import("@playwright/test").Page,
  formTestId: string,
  realmQuery: string,
  realmSlug: string,
) {
  const form = page.getByTestId(formTestId);
  await form.getByTestId("realm-combobox-input").fill(realmQuery);
  await expect(page.getByTestId("realm-suggestions")).toBeVisible({ timeout: 5000 });
  await page.getByTestId(`realm-option-${realmSlug}`).click();
}

test("capture validation screenshots", async ({ page }) => {
  mkdirSync(outDir, { recursive: true });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.screenshot({ path: join(outDir, "landing-desktop.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.screenshot({ path: join(outDir, "landing-mobile.png"), fullPage: true });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await selectRealm(page, "hero-search-form", "Arch", "archimonde");
  await page.screenshot({ path: join(outDir, "realm-dropdown.png") });

  await page.getByTestId("hero-search-form").getByTestId("character-name-input").fill("Aleria");
  await selectRealm(page, "hero-search-form", "tarren", "tarren-mill");
  await page.getByTestId("hero-search-form").getByTestId("search-submit").click();
  await expect(page).toHaveURL(/\/character\/EU\/tarren-mill\/Aleria/i);
  await page.waitForSelector('[data-testid="score-header"]');
  await page.screenshot({ path: join(outDir, "known-character-result.png"), fullPage: true });

  await page.goto("/");
  await page.getByTestId("hero-search-form").getByTestId("character-name-input").fill("Freshalt");
  await selectRealm(page, "hero-search-form", "archi", "archimonde");
  await page.getByTestId("hero-search-form").getByTestId("search-submit").click();
  await expect(page).toHaveURL(/\/character\/EU\/archimonde\/Freshalt/i);
  await page.screenshot({ path: join(outDir, "new-character-loading.png") });

  await page.goto("/");
  await page.getByTestId("hero-search-form").getByTestId("character-name-input").fill("nobodyhere");
  await selectRealm(page, "hero-search-form", "kazzak", "kazzak");
  await page.getByTestId("hero-search-form").getByTestId("search-submit").click();
  await expect(page.getByTestId("search-status")).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: join(outDir, "not-found-state.png") });

  await page.goto("/");
  await page.getByTestId("navbar-search-form").getByTestId("character-name-input").fill("Aleria");
  await selectRealm(page, "navbar-search-form", "tarren", "tarren-mill");
  await page.screenshot({ path: join(outDir, "navbar-search.png") });

  await page.goto("/character/EU/tarren-mill/Aleria");
  await page.waitForSelector('[data-testid="selected-runs-panel"]');
  await page.screenshot({ path: join(outDir, "profile-eight-runs.png"), fullPage: true });
});
