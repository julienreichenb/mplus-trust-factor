import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, nextTick, ref } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import {
  characterMediaCandidatesSignature,
  toCharacterMediaCandidates,
  toCharacterMediaLadder,
  toCharacterMediaViewModel,
} from "./characterMediaViewModel";
import { FIXTURE_CHARACTERS } from "../api/mock/fixtures";
import { resetFeatureFlagsCache } from "../config/features";
import CharacterMediaPanel from "../components/character/CharacterMediaPanel.vue";
import { useCharacterMediaLadder } from "../composables/useCharacterMediaLadder";

function baseProfile(media: {
  avatarUrl: string | null;
  insetUrl: string | null;
  mainRawUrl: string | null;
}) {
  return {
    ...FIXTURE_CHARACTERS[0]!.profile,
    media,
  };
}

describe("characterMediaViewModel ladder", () => {
  afterEach(() => {
    resetFeatureFlagsCache();
  });

  it("orders candidates main-raw → inset → avatar", () => {
    const candidates = toCharacterMediaCandidates(
      baseProfile({
        avatarUrl: "https://render.worldofwarcraft.com/eu/avatar.jpg",
        insetUrl: "https://render.worldofwarcraft.com/eu/inset.jpg",
        mainRawUrl: "https://render.worldofwarcraft.com/eu/main-raw.jpg",
      }),
    );
    expect(candidates.map((c) => c.kind)).toEqual(["main-raw", "inset", "avatar"]);
  });

  it("accepts mock-only same-origin /fixtures media paths", () => {
    const candidates = toCharacterMediaCandidates(
      baseProfile({
        avatarUrl: "/fixtures/media-avatar.svg",
        insetUrl: "/fixtures/media-inset.svg",
        mainRawUrl: "/fixtures/media-main.svg",
      }),
    );
    expect(candidates.map((c) => c.url)).toEqual([
      "/fixtures/media-main.svg",
      "/fixtures/media-inset.svg",
      "/fixtures/media-avatar.svg",
    ]);
  });

  it("prefers main-raw as primary view model", () => {
    const media = toCharacterMediaViewModel(
      baseProfile({
        avatarUrl: "https://render.worldofwarcraft.com/eu/avatar.jpg",
        insetUrl: "https://render.worldofwarcraft.com/eu/inset.jpg",
        mainRawUrl: "https://render.worldofwarcraft.com/eu/main-raw.jpg",
      }),
    );
    expect(media.type).toBe("render");
    expect(media.url).toContain("main-raw.jpg");
  });

  it("uses inset before avatar when main-raw is missing", () => {
    const candidates = toCharacterMediaCandidates(
      baseProfile({
        avatarUrl: "https://render.worldofwarcraft.com/eu/avatar.jpg",
        insetUrl: "https://render.worldofwarcraft.com/eu/inset.jpg",
        mainRawUrl: null,
      }),
    );
    expect(candidates.map((c) => c.kind)).toEqual(["inset", "avatar"]);
  });

  it("builds a character-specific polished fallback", () => {
    const ladder = toCharacterMediaLadder(
      baseProfile({
        avatarUrl: null,
        insetUrl: null,
        mainRawUrl: null,
      }),
    );
    expect(ladder.candidates).toHaveLength(0);
    expect(ladder.fallback.displayName).toBeTruthy();
    expect(ladder.fallback.initials.length).toBeGreaterThan(0);
    expect(ladder.fallback.classColor).toMatch(/^#|var\(/);
    expect(ladder.fallback.caption.toLowerCase()).toContain("mage");
  });

  it("rejects invalid media URLs", () => {
    const media = toCharacterMediaViewModel(
      baseProfile({
        avatarUrl: "javascript:alert(1)",
        insetUrl: null,
        mainRawUrl: null,
      }),
    );
    expect(media.type).toBe("placeholder");
    expect(media.url).toBeNull();
  });
});

describe("useCharacterMediaLadder", () => {
  function mountLadder(candidates: ReturnType<typeof toCharacterMediaCandidates>) {
    const candidatesRef = ref(candidates);
    let api: ReturnType<typeof useCharacterMediaLadder> | null = null;
    const Host = defineComponent({
      setup() {
        api = useCharacterMediaLadder(candidatesRef);
        return () => null;
      },
    });
    const wrapper = mount(Host);
    return { api: api!, wrapper, candidatesRef };
  }

  it("exposes main-raw on success path", () => {
    const { api, wrapper } = mountLadder(
      toCharacterMediaCandidates(
        baseProfile({
          avatarUrl: "https://render.worldofwarcraft.com/eu/avatar.jpg",
          insetUrl: "https://render.worldofwarcraft.com/eu/inset.jpg",
          mainRawUrl: "https://render.worldofwarcraft.com/eu/main-raw.jpg",
        }),
      ),
    );
    expect(api.activeKind.value).toBe("main-raw");
    expect(api.activeUrl.value).toContain("main-raw.jpg");
    wrapper.unmount();
  });

  it("cache-busts the same URL on bounded retry so a new request is issued", async () => {
    vi.useFakeTimers();
    const { api, wrapper } = mountLadder(
      toCharacterMediaCandidates(
        baseProfile({
          avatarUrl: null,
          insetUrl: null,
          mainRawUrl: "https://render.worldofwarcraft.com/eu/main-raw.jpg",
        }),
      ),
    );
    expect(api.requestUrl.value).toBe("https://render.worldofwarcraft.com/eu/main-raw.jpg");
    api.onImageError();
    await vi.advanceTimersByTimeAsync(400);
    expect(api.requestUrl.value).toContain("_mpts_retry=1");
    expect(api.activeKind.value).toBe("main-raw");
    wrapper.unmount();
    vi.useRealTimers();
  });

  it("falls back to inset after main-raw retries are exhausted", async () => {
    vi.useFakeTimers();
    const { api, wrapper } = mountLadder(
      toCharacterMediaCandidates(
        baseProfile({
          avatarUrl: "https://render.worldofwarcraft.com/eu/avatar.jpg",
          insetUrl: "https://render.worldofwarcraft.com/eu/inset.jpg",
          mainRawUrl: "https://render.worldofwarcraft.com/eu/main-raw.jpg",
        }),
      ),
    );

    api.onImageError();
    await vi.advanceTimersByTimeAsync(400);
    expect(api.activeKind.value).toBe("main-raw");

    api.onImageError();
    await nextTick();
    expect(api.activeKind.value).toBe("inset");
    expect(api.activeUrl.value).toContain("inset.jpg");
    wrapper.unmount();
    vi.useRealTimers();
  });

  it("falls back to avatar after render and inset fail", async () => {
    vi.useFakeTimers();
    const { api, wrapper } = mountLadder(
      toCharacterMediaCandidates(
        baseProfile({
          avatarUrl: "https://render.worldofwarcraft.com/eu/avatar.jpg",
          insetUrl: "https://render.worldofwarcraft.com/eu/inset.jpg",
          mainRawUrl: "https://render.worldofwarcraft.com/eu/main-raw.jpg",
        }),
      ),
    );

    // Fail main-raw (retry + advance)
    api.onImageError();
    await vi.advanceTimersByTimeAsync(400);
    api.onImageError();
    expect(api.activeKind.value).toBe("inset");

    // Fail inset
    api.onImageError();
    await vi.advanceTimersByTimeAsync(400);
    api.onImageError();
    expect(api.activeKind.value).toBe("avatar");
    expect(api.activeUrl.value).toContain("avatar.jpg");
    wrapper.unmount();
    vi.useRealTimers();
  });

  it("exhausts to polished fallback when every candidate fails", async () => {
    vi.useFakeTimers();
    const { api, wrapper } = mountLadder(
      toCharacterMediaCandidates(
        baseProfile({
          avatarUrl: "https://render.worldofwarcraft.com/eu/avatar.jpg",
          insetUrl: "https://render.worldofwarcraft.com/eu/inset.jpg",
          mainRawUrl: "https://render.worldofwarcraft.com/eu/main-raw.jpg",
        }),
      ),
    );

    for (let i = 0; i < 6; i += 1) {
      api.onImageError();
      await vi.advanceTimersByTimeAsync(400);
    }
    expect(api.exhausted.value).toBe(true);
    expect(api.showRemoteImage.value).toBe(false);
    wrapper.unmount();
    vi.useRealTimers();
  });

  it("resets candidate state when the profile candidates change", async () => {
    vi.useFakeTimers();
    const first = toCharacterMediaCandidates(
      baseProfile({
        avatarUrl: "https://render.worldofwarcraft.com/eu/avatar.jpg",
        insetUrl: "https://render.worldofwarcraft.com/eu/inset.jpg",
        mainRawUrl: "https://render.worldofwarcraft.com/eu/main-raw.jpg",
      }),
    );
    const { api, wrapper, candidatesRef } = mountLadder(first);

    api.onImageError();
    await vi.advanceTimersByTimeAsync(400);
    api.onImageError();
    expect(api.activeKind.value).toBe("inset");

    candidatesRef.value = toCharacterMediaCandidates(
      baseProfile({
        avatarUrl: "https://render.worldofwarcraft.com/eu/avatar-2.jpg",
        insetUrl: null,
        mainRawUrl: "https://render.worldofwarcraft.com/eu/main-raw-2.jpg",
      }),
    );
    await nextTick();
    expect(api.activeKind.value).toBe("main-raw");
    expect(api.activeUrl.value).toContain("main-raw-2.jpg");
    expect(api.exhausted.value).toBe(false);
    wrapper.unmount();
    vi.useRealTimers();
  });

  it("builds a stable signature for reset detection", () => {
    const a = toCharacterMediaCandidates(
      baseProfile({
        avatarUrl: null,
        insetUrl: null,
        mainRawUrl: "https://render.worldofwarcraft.com/eu/main-raw.jpg",
      }),
    );
    const b = toCharacterMediaCandidates(
      baseProfile({
        avatarUrl: null,
        insetUrl: null,
        mainRawUrl: "https://render.worldofwarcraft.com/eu/main-raw.jpg",
      }),
    );
    expect(characterMediaCandidatesSignature(a, "id-1")).toBe(
      characterMediaCandidatesSignature(b, "id-1"),
    );
    expect(characterMediaCandidatesSignature(a, "id-1")).not.toBe(
      characterMediaCandidatesSignature(a, "id-2"),
    );
  });
});

describe("CharacterMediaPanel", () => {
  it("renders main-raw image when available", () => {
    const wrapper = mount(CharacterMediaPanel, {
      props: {
        profile: baseProfile({
          avatarUrl: "https://render.worldofwarcraft.com/eu/avatar.jpg",
          insetUrl: "https://render.worldofwarcraft.com/eu/inset.jpg",
          mainRawUrl: "https://render.worldofwarcraft.com/eu/main-raw.jpg",
        }),
        priority: true,
      },
    });
    const img = wrapper.get("img.media-panel__image");
    expect(img.attributes("src")).toContain("main-raw.jpg");
    expect(img.attributes("loading")).toBe("eager");
    expect(wrapper.find("[data-testid='character-media-fallback']").exists()).toBe(false);
  });

  it("falls back to inset after main-raw image error", async () => {
    vi.useFakeTimers();
    const wrapper = mount(CharacterMediaPanel, {
      props: {
        profile: baseProfile({
          avatarUrl: "https://render.worldofwarcraft.com/eu/avatar.jpg",
          insetUrl: "https://render.worldofwarcraft.com/eu/inset.jpg",
          mainRawUrl: "https://render.worldofwarcraft.com/eu/main-raw.jpg",
        }),
      },
    });

    await wrapper.get("img.media-panel__image").trigger("error");
    await vi.advanceTimersByTimeAsync(400);
    await wrapper.get("img.media-panel__image").trigger("error");
    await flushPromises();
    expect(wrapper.get("img.media-panel__image").attributes("src")).toContain("inset.jpg");
    expect(wrapper.attributes("data-media-kind")).toBe("inset");
    wrapper.unmount();
    vi.useRealTimers();
  });

  it("shows polished identity fallback when all media fail", async () => {
    vi.useFakeTimers();
    const wrapper = mount(CharacterMediaPanel, {
      props: {
        profile: baseProfile({
          avatarUrl: "https://render.worldofwarcraft.com/eu/avatar.jpg",
          insetUrl: "https://render.worldofwarcraft.com/eu/inset.jpg",
          mainRawUrl: "https://render.worldofwarcraft.com/eu/main-raw.jpg",
        }),
      },
    });

    for (let i = 0; i < 6; i += 1) {
      const img = wrapper.find("img.media-panel__image");
      if (img.exists()) {
        await img.trigger("error");
        await vi.advanceTimersByTimeAsync(400);
      }
    }
    await flushPromises();
    expect(wrapper.find("[data-testid='character-media-fallback']").exists()).toBe(true);
    expect(wrapper.text()).toContain(FIXTURE_CHARACTERS[0]!.profile.displayName);
    expect(wrapper.find(".media-panel__silhouette").exists()).toBe(false);
    wrapper.unmount();
    vi.useRealTimers();
  });

  it("renders identity fallback with offline initials when media is missing", () => {
    const wrapper = mount(CharacterMediaPanel, {
      props: { profile: { ...FIXTURE_CHARACTERS[0]!.profile, media: null } },
    });
    expect(wrapper.attributes("data-media-type")).toBe("placeholder");
    expect(wrapper.find("[data-testid='character-media-fallback']").exists()).toBe(true);
    expect(wrapper.text()).toContain("Character identity");
    expect(wrapper.find(".media-panel__identity-initials").exists()).toBe(true);
  });
});
