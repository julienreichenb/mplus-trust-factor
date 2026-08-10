import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const shotDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "screenshots");

async function fillHeroSearch(page: Page, name: string, realm: string) {
  const form = page.getByTestId("hero-search-form");
  await form.getByTestId("character-name-input").fill(name);
  const realmInput = form.getByTestId("realm-combobox-input");
  await realmInput.fill(realm);
  await expect(page.getByTestId("realm-suggestions")).toBeVisible({ timeout: 5000 });
  await page.getByTestId(`realm-option-${realm.toLowerCase().replace(/\s+/g, "-")}`).click();
}

test.describe("M+ Trust Factor web (mock mode)", () => {
  test("desktop landing search navigates to known character", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/");
    await page.screenshot({ path: path.join(shotDir, "landing-desktop.png"), fullPage: true });

    await fillHeroSearch(page, "Aleria", "tarren-mill");
    await page.screenshot({ path: path.join(shotDir, "realm-dropdown.png") });
    await page.getByTestId("hero-search-form").getByTestId("search-submit").click();
    await expect(page).toHaveURL(/\/character\/EU\/tarren-mill\/Aleria/i);
    await expect(page.getByTestId("score-header")).toBeVisible();
    await page.screenshot({ path: path.join(shotDir, "known-character-result.png"), fullPage: true });
    expect(errors).toEqual([]);
  });

  test("mobile landing search", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await fillHeroSearch(page, "Aleria", "tarren-mill");
    await page.getByTestId("hero-search-form").getByTestId("search-submit").click();
    await expect(page).toHaveURL(/\/character\/EU\/tarren-mill\/Aleria/i);
    await page.screenshot({ path: path.join(shotDir, "landing-mobile.png"), fullPage: true });
  });

  test("navbar search navigates to profile", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    const form = page.getByTestId("navbar-search-form");
    await form.getByTestId("character-name-input").fill("Aleria");
    await form.getByTestId("realm-combobox-input").fill("tarren-mill");
    await expect(page.getByTestId("realm-suggestions")).toBeVisible({ timeout: 5000 });
    await page.getByTestId("realm-option-tarren-mill").click();
    await form.getByTestId("search-submit").click();
    await expect(page).toHaveURL(/\/character\/EU\/tarren-mill\/Aleria/i);
    await page.screenshot({ path: path.join(shotDir, "navbar-search.png") });
  });

  test("valid unknown character shows loading then profile", async ({ page }) => {
    await page.goto("/");
    await fillHeroSearch(page, "Freshalt", "archimonde");
    await page.getByTestId("hero-search-form").getByTestId("search-submit").click();
    await expect(page).toHaveURL(/\/character\/EU\/archimonde\/Freshalt/i);
    await page.screenshot({ path: path.join(shotDir, "new-character-loading.png") });
    await expect(page.getByTestId("queued-banner")).toBeVisible({ timeout: 15_000 });
  });

  test("invalid character shows not-found without infinite pending", async ({ page }) => {
    await page.goto("/");
    await fillHeroSearch(page, "nobodyhere", "kazzak");
    await page.getByTestId("hero-search-form").getByTestId("search-submit").click();
    await expect(page.getByTestId("search-status")).toContainText(/not found/i, { timeout: 10_000 });
    await expect(page.getByTestId("search-retry")).toBeVisible();
    await page.screenshot({ path: path.join(shotDir, "not-found-state.png") });
    await expect(page).not.toHaveURL(/\/character\//);
  });

  test("queued refresh completes on Carryme", async ({ page }) => {
    await page.goto("/character/EU/kazzak/Carryme");
    await expect(page.getByTestId("queued-banner")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("score-header")).toBeVisible();
    await expect(page.getByTestId("queued-banner")).toBeHidden({ timeout: 20_000 });
    await expect(page.getByTestId("freshness")).toHaveText("FRESH");
  });

  test("comparison happy path", async ({ page }) => {
    await page.goto("/compare");
    await page.getByTestId("compare-submit").click();
    await expect(page.getByTestId("compare-table")).toBeVisible();
    await expect(page.getByTestId("compatibility-banner").or(page.getByText("Compatible snapshot"))).toBeVisible();
  });

  test("accessibility smoke: landmarks and headings", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Know who you run with." })).toBeVisible();
    await expect(page.getByTestId("hero-search-form")).toBeVisible();
    await page.goto("/character/EU/tarren-mill/Aleria");
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("score explainability smoke on Aleria dimension cards", async ({ page }) => {
    await page.goto("/character/EU/tarren-mill/Aleria");
    await expect(page.getByTestId("dimension-cards")).toBeVisible();
    await expect(page.getByText("What affects your score").first()).toBeVisible();
    await expect(page.getByText("Previous-season activity: none confirmed")).toBeVisible();
    await expect(page.getByText("Full confidence")).toBeVisible();
    await expect(page.getByText("Incomplete cooldown evidence coverage")).toBeVisible();
    // Confidence reason must not be framed as a player weakness heading+content pair alone —
    // weakness text for performance exists, but cooldown coverage is under confidence.
    const cards = page.getByTestId("dimension-cards");
    await expect(cards.getByTestId("confidence-reasons").first()).toContainText(
      "Incomplete cooldown evidence coverage",
    );
  });
});
