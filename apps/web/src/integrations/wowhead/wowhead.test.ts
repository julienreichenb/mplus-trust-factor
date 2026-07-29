import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wowheadItemUrl, wowheadSpellUrl, isWowheadItemUrl, wowheadItemQuery } from "./urls";
import {
  getWowheadTooltipStatus,
  loadWowheadTooltipScript,
  resetWowheadTooltipLoader,
} from "./tooltips";

describe("wowhead urls", () => {
  it("generates valid item URLs", () => {
    expect(wowheadItemUrl(19019)).toBe("https://www.wowhead.com/item=19019");
    expect(isWowheadItemUrl("https://www.wowhead.com/item=19019")).toBe(true);
  });

  it("embeds equipped ilvl and bonus list for scaled/crafted tooltips", () => {
    expect(
      wowheadItemUrl(151796, { itemLevel: 298, bonusList: [6652, 1808] }),
    ).toBe("https://www.wowhead.com/item=151796&ilvl=298&bonus=6652:1808");
    expect(wowheadItemQuery(171412, { itemLevel: 285 })).toBe("item=171412&ilvl=285");
    expect(isWowheadItemUrl("https://www.wowhead.com/item=151796&ilvl=298&bonus=6652:1808")).toBe(
      true,
    );
  });

  it("rejects invalid item IDs", () => {
    expect(wowheadItemUrl(0)).toBeNull();
    expect(wowheadItemUrl(-1)).toBeNull();
    expect(wowheadItemUrl(1.5)).toBeNull();
    expect(wowheadSpellUrl(0)).toBeNull();
  });
});

describe("wowhead tooltip loader", () => {
  beforeEach(() => {
    resetWowheadTooltipLoader();
    document.head.innerHTML = "";
  });

  afterEach(() => {
    resetWowheadTooltipLoader();
    document.head.innerHTML = "";
  });

  it("is idempotent and does not insert duplicate scripts", async () => {
    const first = loadWowheadTooltipScript();
    const second = loadWowheadTooltipScript();
    expect(first).toBe(second);
    expect(getWowheadTooltipStatus()).toBe("loading");

    const scripts = document.querySelectorAll("script[data-mpts-wowhead-tooltips]");
    expect(scripts).toHaveLength(1);

    scripts[0]!.dispatchEvent(new Event("load"));
    await expect(first).resolves.toBe("ready");
    await expect(loadWowheadTooltipScript()).resolves.toBe("ready");
    expect(document.querySelectorAll("script[data-mpts-wowhead-tooltips]")).toHaveLength(1);
  });

  it("fails safely without retrying", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const pending = loadWowheadTooltipScript();
    const script = document.querySelector("script[data-mpts-wowhead-tooltips]")!;
    script.dispatchEvent(new Event("error"));
    await expect(pending).resolves.toBe("failed");
    await expect(loadWowheadTooltipScript()).resolves.toBe("failed");
    expect(document.querySelectorAll("script[data-mpts-wowhead-tooltips]")).toHaveLength(1);
    warn.mockRestore();
  });
});
