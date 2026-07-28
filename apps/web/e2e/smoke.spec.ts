import { test, expect } from "@playwright/test";

test.describe("M+ Trust Factor web (mock mode)", () => {
  test("search navigates to character profile", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/");
    await expect(page.getByTestId("api-mode")).toContainText("mock");
    const heroForm = page.getByTestId("hero-search-form");
    await heroForm.getByTestId("character-autocomplete-input").fill("Aleria-tarren-mill");
    await heroForm.getByTestId("search-submit").click();
    await expect(page).toHaveURL(/\/character\/EU\/tarren-mill\/Aleria/i);
    await expect(page.getByTestId("score-header")).toBeVisible();
    await expect(page.getByTestId("overall-score")).toHaveText("88");
    await expect(page.getByTestId("grade")).toContainText("A");
    await expect(page.getByTestId("radar-fallback")).toBeVisible();
    await expect(page.getByTestId("selected-runs-panel")).toBeVisible();
    await expect(page.getByTestId("raiderio-attribution")).toBeVisible();
    await expect(page.getByText("Mythic Raid")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("autocomplete keyboard navigation selects a suggestion", async ({ page }) => {
    await page.goto("/");
    const input = page.getByTestId("hero-search-form").getByTestId("character-autocomplete-input");
    await input.fill("Ale");
    await expect(page.getByTestId("character-suggestions")).toBeVisible({ timeout: 5000 });
    await input.press("ArrowDown");
    await input.press("Enter");
    await expect(page).toHaveURL(/\/character\/EU\/tarren-mill\/Aleria/i);
  });

  test("navbar autocomplete navigates to profile", async ({ page }) => {
    await page.goto("/");
    const navbarInput = page.locator("#navbar-character-search");
    await navbarInput.fill("Aleria-tarren-mill");
    await navbarInput.press("Enter");
    await expect(page).toHaveURL(/\/character\/EU\/tarren-mill\/Aleria/i);
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

  test("admin clone validate activate flow", async ({ page }) => {
    await page.goto("/admin/models");
    await expect(page.getByTestId("model-list")).toBeVisible();
    await page.getByTestId("clone-model").click();
    await expect(page.getByText(/draft/i).first()).toBeVisible();
    await page.getByTestId("validate-model").click();
    await expect(page.getByTestId("validation-result")).toContainText("Valid");

    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("confirm");
      await dialog.accept();
    });
    await page.getByTestId("activate-model").click();
    await expect(page.getByText("Model activated.")).toBeVisible({ timeout: 10_000 });
  });

  test("accessibility smoke: landmarks and headings", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Know who you run with." })).toBeVisible();
    await expect(page.getByTestId("hero-search-form")).toBeVisible();
    await page.goto("/character/EU/tarren-mill/Aleria");
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByTestId("selected-runs-panel")).toBeVisible();
    await expect(page.getByText("Analyzed runs")).toHaveCount(0);
  });
});
