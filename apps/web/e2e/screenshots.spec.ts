import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const outDir = join(process.cwd(), "e2e", "screenshots");

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
  const heroInput = page.getByTestId("hero-search-form").getByTestId("character-autocomplete-input");
  await heroInput.fill("Ale");
  await page.waitForSelector('[data-testid="character-suggestions"]');
  await page.screenshot({ path: join(outDir, "autocomplete-landing.png") });

  await page.goto("/");
  const navbarInput = page.locator("#navbar-character-search");
  await navbarInput.fill("Ale");
  await page.waitForSelector('[data-testid="character-suggestions"]');
  await page.screenshot({ path: join(outDir, "autocomplete-navbar.png") });

  await page.goto("/character/EU/tarren-mill/Aleria");
  await page.waitForSelector('[data-testid="selected-runs-panel"]');
  await page.screenshot({ path: join(outDir, "profile-eight-runs.png"), fullPage: true });
});
