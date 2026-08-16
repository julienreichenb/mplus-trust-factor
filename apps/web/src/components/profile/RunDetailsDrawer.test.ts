import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import RunDetailsDrawer from "./RunDetailsDrawer.vue";
import { gradeThemeCssVars } from "../../lib/gradeTheme";

describe("RunDetailsDrawer", () => {
  it("renders canonical run metadata without inventing values", () => {
    const wrapper = mount(RunDetailsDrawer, {
      props: {
        open: true,
        run: {
          dungeonName: "Ara-Kara",
          dungeonSlug: "ara-kara",
          keyLevel: 23,
          completedAt: "2026-07-31T00:00:00.000Z",
          identity: "PRIMARY",
          wclUrl: "https://www.warcraftlogs.com/reports/ABC?fight=1",
        },
      },
      attachTo: document.body,
    });
    const root = document.querySelector("[data-testid='run-details-drawer']");
    expect(root?.textContent).toContain("Ara-Kara");
    expect(root?.querySelector(".drawer__title .drawer__key")?.textContent).toContain("+23");
    expect(root?.querySelector(".drawer__meta")?.textContent).not.toContain("+23");
    expect(root?.textContent).toContain("PRIMARY");
    expect(root?.textContent).not.toContain("Your Key %");
    expect(root?.querySelector(".drawer__meta .drawer__link")?.getAttribute("href")).toContain(
      "warcraftlogs.com/reports/ABC",
    );
    expect(document.querySelector("[data-testid='run-drawer-facts']")).toBeNull();
    expect(document.querySelector("[data-testid='run-cooldown-timeline']")).not.toBeNull();
    expect(document.body.textContent).toContain("Cooldown replay unavailable for this run.");
    expect(document.querySelectorAll(".event")).toHaveLength(0);
    wrapper.unmount();
  });

  it("omits peer facts when they are not tied to the run", () => {
    const wrapper = mount(RunDetailsDrawer, {
      props: {
        open: true,
        run: {
          dungeonName: "Ara-Kara",
          dungeonSlug: "ara-kara",
          keyLevel: 23,
          completedAt: null,
          identity: "PRIMARY",
          wclUrl: null,
        },
      },
      attachTo: document.body,
    });
    expect(document.querySelector("[data-testid='run-drawer-facts']")).toBeNull();
    expect(document.body.textContent).toContain("No Warcraft Logs report");
    wrapper.unmount();
  });

  it("applies CharacterPage gradeThemeCssVars on the teleported drawer root", () => {
    const a = mount(RunDetailsDrawer, {
      props: {
        open: true,
        grade: "A",
        run: {
          dungeonName: "Ara-Kara",
          dungeonSlug: "ara-kara",
          keyLevel: 12,
          completedAt: null,
          identity: "PRIMARY",
          cooldownTimeline: {
            status: "AVAILABLE",
            durationMs: 60_000,
            events: [],
            segments: [{ index: 2, startMs: 10_000, endMs: 20_000 }],
          },
        },
      },
      attachTo: document.body,
    });
    const rootA = document.querySelector("[data-testid='run-details-drawer']") as HTMLElement;
    expect(rootA.style.getPropertyValue("--color-rank-rgb")).toBe(gradeThemeCssVars("A")["--color-rank-rgb"]);
    a.unmount();

    const c = mount(RunDetailsDrawer, {
      props: {
        open: true,
        grade: "C",
        run: {
          dungeonName: "Ara-Kara",
          dungeonSlug: "ara-kara",
          keyLevel: 12,
          completedAt: null,
          identity: "PRIMARY",
          cooldownTimeline: {
            status: "AVAILABLE",
            durationMs: 60_000,
            events: [],
            segments: [{ index: 2, startMs: 10_000, endMs: 20_000 }],
          },
        },
      },
      attachTo: document.body,
    });
    const rootC = document.querySelector("[data-testid='run-details-drawer']") as HTMLElement;
    expect(rootC.style.getPropertyValue("--color-rank-rgb")).toBe(gradeThemeCssVars("C")["--color-rank-rgb"]);
    expect(gradeThemeCssVars("A")["--color-rank-rgb"]).not.toBe(gradeThemeCssVars("C")["--color-rank-rgb"]);
    c.unmount();
  });
});
