import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { defineComponent, nextTick, ref } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { useCharacterMediaLadder } from "./useCharacterMediaLadder";
import type { CharacterMediaCandidate } from "../lib/characterMediaViewModel";

const main: CharacterMediaCandidate = {
  kind: "main-raw",
  url: "https://cdn.example/main.png",
  type: "render",
};
const inset: CharacterMediaCandidate = {
  kind: "inset",
  url: "https://cdn.example/inset.png",
  type: "avatar",
};
const avatar: CharacterMediaCandidate = {
  kind: "avatar",
  url: "https://cdn.example/avatar.png",
  type: "avatar",
};

function mountLadder(
  candidates: CharacterMediaCandidate[],
  opts: { identityKey?: string; maxRetriesPerCandidate?: number; retryDelayMs?: number } = {},
) {
  const candidatesRef = ref(candidates);
  const identityKey = ref(opts.identityKey ?? "char-1");
  let api: ReturnType<typeof useCharacterMediaLadder> | null = null;
  const Comp = defineComponent({
    setup() {
      api = useCharacterMediaLadder(candidatesRef, {
        identityKey,
        maxRetriesPerCandidate: opts.maxRetriesPerCandidate ?? 1,
        retryDelayMs: opts.retryDelayMs ?? 50,
      });
      return () => null;
    },
  });
  const wrapper = mount(Comp);
  return {
    wrapper,
    candidatesRef,
    identityKey,
    get api() {
      return api!;
    },
  };
}

describe("useCharacterMediaLadder", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("advances to the next candidate after bounded same-URL retries", async () => {
    const { api, wrapper } = mountLadder([main, inset, avatar]);
    expect(api.activeKind.value).toBe("main-raw");
    expect(api.requestUrl.value).toBe(main.url);

    api.onImageError();
    await vi.advanceTimersByTimeAsync(50);
    await flushPromises();
    expect(api.activeKind.value).toBe("main-raw");
    expect(api.requestUrl.value).toContain("_mpts_retry=1");

    api.onImageError();
    await nextTick();
    expect(api.activeKind.value).toBe("inset");
    expect(api.requestUrl.value).toContain("inset.png");
    wrapper.unmount();
  });

  it("exhausts to identity fallback after the full ladder fails", async () => {
    const { api, wrapper } = mountLadder([main, inset], { maxRetriesPerCandidate: 0 });
    api.onImageError();
    expect(api.activeKind.value).toBe("inset");
    api.onImageError();
    expect(api.exhausted.value).toBe(true);
    expect(api.showRemoteImage.value).toBe(false);
    wrapper.unmount();
  });

  it("resets when candidates or identity change", async () => {
    const { api, wrapper, candidatesRef, identityKey } = mountLadder([main, inset], {
      maxRetriesPerCandidate: 0,
    });
    api.onImageError();
    expect(api.activeKind.value).toBe("inset");

    candidatesRef.value = [main, inset, avatar];
    await nextTick();
    expect(api.activeKind.value).toBe("main-raw");
    expect(api.exhausted.value).toBe(false);

    api.onImageError();
    identityKey.value = "char-2";
    await nextTick();
    expect(api.activeKind.value).toBe("main-raw");
    expect(api.loadGeneration.value).toBe(0);
    wrapper.unmount();
  });

  it("clears pending retry timers on unmount", async () => {
    const { api, wrapper } = mountLadder([main], { retryDelayMs: 500 });
    api.onImageError();
    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.loadGeneration.value).toBe(0);
  });
});
