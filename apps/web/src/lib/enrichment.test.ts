import { afterEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { toEquipmentViewModel } from "./equipmentViewModel";
import { toCharacterMediaViewModel } from "./characterMediaViewModel";
import { presentGrade } from "./characterViewModel";
import { resetFeatureFlagsCache } from "../config/features";
import { FIXTURE_CHARACTERS } from "../api/mock/fixtures";
import EquipmentGrid from "../components/equipment/EquipmentGrid.vue";
import EquipmentSlot from "../components/equipment/EquipmentSlot.vue";
import CharacterMediaPanel from "../components/character/CharacterMediaPanel.vue";
import { sanitizeHttpsUrl } from "./safeUrl";

describe("equipmentViewModel", () => {
  afterEach(() => {
    resetFeatureFlagsCache();
  });

  it("maps fixture key items without inventing enrichment", () => {
    const view = toEquipmentViewModel(FIXTURE_CHARACTERS[0]!.profile.equipment);
    expect(view?.filledCount).toBe(2);
    const trinkets = view!.items.filter((i) => i.isAvailable);
    expect(trinkets.every((i) => i.itemId == null && i.iconUrl == null && i.externalUrl == null)).toBe(
      true,
    );
  });

  it("appends unknown slots instead of dropping them", () => {
    const view = toEquipmentViewModel({
      averageItemLevel: 600,
      equippedItemLevel: 600,
      keyItems: [
        { slot: "Shirt", name: "Fancy Shirt", itemLevel: 1 },
        { slot: "Trinket", name: "Known Trinket", itemLevel: 670 },
      ],
    });
    expect(view?.items.some((i) => i.slotLabel === "Shirt" && !i.isKnownSlot)).toBe(true);
    expect(view?.items.some((i) => i.slotLabel === "Trinket 1" && i.name === "Known Trinket")).toBe(
      true,
    );
  });

  it("builds Wowhead links only for valid item IDs when links are enabled", () => {
    const view = toEquipmentViewModel({
      averageItemLevel: null,
      equippedItemLevel: null,
      keyItems: [
        {
          slot: "Head",
          name: "Test Helm",
          itemLevel: 670,
          itemId: 12345,
          iconUrl: "https://render.worldofwarcraft.com/icons/56/inv_helmet.jpg",
          quality: "Epic",
        } as { slot: string; name: string; itemLevel: number | null },
      ],
    });
    const head = view!.items.find((i) => i.id === "head")!;
    expect(head.itemId).toBe(12345);
    expect(head.iconUrl).toContain("https://");
    expect(head.externalUrl).toBe("https://www.wowhead.com/item=12345");
    expect(head.quality).toBe("Epic");
  });

  it("rejects unsafe icon URLs", () => {
    expect(sanitizeHttpsUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizeHttpsUrl("http://example.com/x.png")).toBeNull();
    expect(sanitizeHttpsUrl("https://cdn.example.com/icon.png")).toBe(
      "https://cdn.example.com/icon.png",
    );
  });
});

describe("characterMediaViewModel", () => {
  afterEach(() => {
    resetFeatureFlagsCache();
  });

  it("falls back to placeholder when media is unavailable", () => {
    const media = toCharacterMediaViewModel(FIXTURE_CHARACTERS[0]!.profile);
    expect(media.type).toBe("placeholder");
    expect(media.url).toBeNull();
  });

  it("uses a trusted profile media URL when present", () => {
    const profile = {
      ...FIXTURE_CHARACTERS[0]!.profile,
      renderUrl: "https://render.worldofwarcraft.com/eu/character/test.jpg",
    };
    const media = toCharacterMediaViewModel(profile);
    expect(media.type).toBe("render");
    expect(media.url).toContain("https://render.worldofwarcraft.com");
  });

  it("rejects invalid media URLs", () => {
    const profile = {
      ...FIXTURE_CHARACTERS[0]!.profile,
      avatarUrl: "javascript:alert(1)",
    };
    const media = toCharacterMediaViewModel(profile);
    expect(media.type).toBe("placeholder");
    expect(media.url).toBeNull();
  });
});

describe("equipment UI enrichment", () => {
  it("keeps equipment usable without Wowhead data", () => {
    const wrapper = mount(EquipmentGrid, {
      props: { equipment: FIXTURE_CHARACTERS[1]!.profile.equipment },
    });
    expect(wrapper.get("[data-testid='equipment-grid']").text()).toContain("Unavailable");
    expect(wrapper.text()).toContain("0 keyed items");
  });

  it("renders an external link when enrichment provides an item ID", () => {
    const view = toEquipmentViewModel({
      averageItemLevel: 1,
      equippedItemLevel: 1,
      keyItems: [
        {
          slot: "Neck",
          name: "Ashkandi",
          itemLevel: 700,
          itemId: 19019,
        } as { slot: string; name: string; itemLevel: number | null },
      ],
    });
    const item = view!.items.find((i) => i.id === "neck")!;
    const wrapper = mount(EquipmentSlot, { props: { item } });
    const link = wrapper.get("a");
    expect(link.attributes("href")).toBe("https://www.wowhead.com/item=19019");
    expect(link.attributes("rel")).toContain("noopener");
    expect(link.text()).toContain("Ashkandi");
  });

  it("falls back when an icon fails to load", async () => {
    const view = toEquipmentViewModel({
      averageItemLevel: 1,
      equippedItemLevel: 1,
      keyItems: [
        {
          slot: "Chest",
          name: "Broken Icon Item",
          itemLevel: 100,
          iconUrl: "https://example.com/missing.png",
        } as { slot: string; name: string; itemLevel: number | null },
      ],
    });
    const item = view!.items.find((i) => i.id === "chest")!;
    const wrapper = mount(EquipmentSlot, { props: { item } });
    expect(wrapper.find("img").exists()).toBe(true);
    await wrapper.get("img").trigger("error");
    expect(wrapper.find("img").exists()).toBe(false);
    expect(wrapper.text()).toContain("Broken Icon Item");
  });
});

describe("character media panel", () => {
  it("renders a stable placeholder without media", () => {
    const wrapper = mount(CharacterMediaPanel, {
      props: { profile: FIXTURE_CHARACTERS[0]!.profile },
    });
    expect(wrapper.attributes("data-media-type")).toBe("placeholder");
    expect(wrapper.text()).toContain("Media placeholder");
  });
});

describe("grade U remains unaffected by enrichment", () => {
  it("still presents U as unrated", () => {
    expect(presentGrade("U").isUnrated).toBe(true);
  });
});
