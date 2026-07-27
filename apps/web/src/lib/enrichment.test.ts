import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { presentGrade } from "./characterViewModel";
import { toCharacterMediaViewModel } from "./characterMediaViewModel";
import { toEquipmentViewModel } from "./equipmentViewModel";
import { resetFeatureFlagsCache } from "../config/features";
import { sanitizeHttpsUrl } from "./safeUrl";
import { FIXTURE_CHARACTERS } from "../api/mock/fixtures";
import EquipmentGrid from "../components/equipment/EquipmentGrid.vue";
import EquipmentSlot from "../components/equipment/EquipmentSlot.vue";
import CharacterMediaPanel from "../components/character/CharacterMediaPanel.vue";

describe("equipmentViewModel", () => {
  afterEach(() => {
    resetFeatureFlagsCache();
  });

  it("maps known equipment slots and leaves others unavailable", () => {
    const view = toEquipmentViewModel({
      averageItemLevel: 600,
      equippedItemLevel: 600,
      items: [],
      keyItems: [
        {
          slot: "Shirt",
          name: "Fancy Shirt",
          itemLevel: 1,
          itemId: null,
          quality: null,
          iconUrl: null,
          enchantments: [],
          gems: [],
        },
        {
          slot: "Trinket",
          name: "Known Trinket",
          itemLevel: 670,
          itemId: null,
          quality: null,
          iconUrl: null,
          enchantments: [],
          gems: [],
        },
      ],
    });
    expect(view!.items.find((i) => i.id === "trinket-1")?.name).toBe("Known Trinket");
    expect(view!.items.find((i) => i.slotLabel === "Shirt" || i.id.startsWith("unknown"))).toBeTruthy();
  });

  it("builds Wowhead links only for valid item IDs when links are enabled", () => {
    resetFeatureFlagsCache();
    vi.stubEnv("VITE_WOWHEAD_LINKS_ENABLED", "true");
    resetFeatureFlagsCache();
    const view = toEquipmentViewModel({
      averageItemLevel: null,
      equippedItemLevel: null,
      items: [],
      keyItems: [
        {
          slot: "Head",
          name: "Test Helm",
          itemLevel: 670,
          itemId: 12345,
          iconUrl: "https://render.worldofwarcraft.com/icons/56/inv_helmet.jpg",
          quality: "Epic",
          enchantments: [],
          gems: [],
        },
      ],
    });
    const head = view!.items.find((i) => i.id === "head")!;
    expect(head.itemId).toBe(12345);
    expect(head.iconUrl).toContain("https://");
    expect(head.externalUrl).toBe("https://www.wowhead.com/item=12345");
    expect(head.quality).toBe("Epic");
    vi.unstubAllEnvs();
    resetFeatureFlagsCache();
  });

  it("does not render missing item level as zero", () => {
    const view = toEquipmentViewModel({
      averageItemLevel: null,
      equippedItemLevel: null,
      items: [
        {
          slot: "Chest",
          name: "Mystery Chest",
          itemLevel: 0,
          itemId: 1,
          quality: null,
          iconUrl: null,
          enchantments: [],
          gems: [],
        },
      ],
      keyItems: [],
    });
    expect(view!.items.find((i) => i.id === "chest")?.itemLevel).toBeNull();
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
    const profile = {
      ...FIXTURE_CHARACTERS[0]!.profile,
      media: null,
    };
    const media = toCharacterMediaViewModel(profile);
    expect(media.type).toBe("placeholder");
    expect(media.url).toBeNull();
  });

  it("prefers typed profile.media HTTPS URLs", () => {
    const profile = {
      ...FIXTURE_CHARACTERS[0]!.profile,
      media: {
        avatarUrl: null,
        insetUrl: null,
        mainRawUrl: "https://render.worldofwarcraft.com/eu/main.jpg",
      },
    };
    const media = toCharacterMediaViewModel(profile);
    expect(media.type).toBe("render");
    expect(media.url).toContain("https://render.worldofwarcraft.com");
  });

  it("rejects invalid media URLs", () => {
    const profile = {
      ...FIXTURE_CHARACTERS[0]!.profile,
      media: {
        avatarUrl: "javascript:alert(1)",
        insetUrl: null,
        mainRawUrl: null,
      },
    };
    const media = toCharacterMediaViewModel(profile);
    expect(media.type).toBe("placeholder");
    expect(media.url).toBeNull();
  });
});

describe("equipment UI enrichment", () => {
  afterEach(() => {
    resetFeatureFlagsCache();
    vi.unstubAllEnvs();
  });

  it("keeps equipment usable without Wowhead data", () => {
    const wrapper = mount(EquipmentGrid, {
      props: { equipment: FIXTURE_CHARACTERS[1]!.profile.equipment },
    });
    expect(wrapper.get("[data-testid='equipment-grid']").text()).toContain("Unavailable");
    expect(wrapper.text()).toContain("0 keyed items");
  });

  it("renders an external link when enrichment provides an item ID", () => {
    vi.stubEnv("VITE_WOWHEAD_LINKS_ENABLED", "true");
    resetFeatureFlagsCache();
    const view = toEquipmentViewModel({
      averageItemLevel: 1,
      equippedItemLevel: 1,
      items: [],
      keyItems: [
        {
          slot: "Neck",
          name: "Ashkandi",
          itemLevel: 700,
          itemId: 19019,
          quality: null,
          iconUrl: null,
          enchantments: [],
          gems: [],
        },
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
      items: [],
      keyItems: [
        {
          slot: "Chest",
          name: "Broken Icon Item",
          itemLevel: 100,
          itemId: null,
          quality: null,
          iconUrl: "https://example.com/missing.png",
          enchantments: [],
          gems: [],
        },
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
      props: { profile: { ...FIXTURE_CHARACTERS[0]!.profile, media: null } },
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
