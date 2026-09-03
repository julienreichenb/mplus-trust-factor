import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { reactive } from "vue";
import ExBossVoicePackPage from "./ExBossVoicePackPage.vue";
import type { VoicePackSession } from "../lib/exboss-voice-pack-session";
import type { ExBossVoiceAlert } from "../lib/exboss-voice-pack-manifest";
import type { VoicePackAlertState } from "../lib/exboss-voice-pack-storage";
import { EXBOSS_VOICE_PACK_PROVENANCE } from "../lib/exboss-voice-pack-manifest";
import { validatePackName } from "../lib/exboss-voice-pack-export";
import { routeDefs } from "../routes";

const ALERTS: ExBossVoiceAlert[] = [
  { index: 0, label: "准备AOE", filename: "prepare-aoe.ogg", englishCue: "Prepare AOE" },
  { index: 1, label: "准备打断", filename: "prepare-interrupt.ogg", englishCue: "Prepare interrupt" },
  { index: 2, label: "黄色", filename: "std-yellow.ogg", englishCue: "Yellow" },
];

function createFakeSession(
  overrides: Partial<{
    alertStates: VoicePackAlertState[];
    currentIndex: number;
    recording: boolean;
    encoding: boolean;
    lastError: unknown;
    packName: string;
  }> = {},
): VoicePackSession {
  const state = reactive({
    packName: overrides.packName ?? "",
    currentIndex: overrides.currentIndex ?? 0,
    alertStates: overrides.alertStates ?? (["pending", "pending", "pending"] as VoicePackAlertState[]),
    customMp3s: new Map<number, Blob>(),
    recording: overrides.recording ?? false,
    encoding: overrides.encoding ?? false,
    hydrated: false,
    lastError: overrides.lastError ?? null,
  });

  const counts = () => {
    let custom = 0;
    let fallback = 0;
    let pending = 0;
    for (const status of state.alertStates) {
      if (status === "custom") custom += 1;
      else if (status === "fallback") fallback += 1;
      else pending += 1;
    }
    return { custom, fallback, pending };
  };

  const session = {
    state,
    alerts: ALERTS,
    get totalCount() {
      return ALERTS.length;
    },
    get customCount() {
      return counts().custom;
    },
    get fallbackCount() {
      return counts().fallback;
    },
    get pendingCount() {
      return counts().pending;
    },
    get completionPercent() {
      const { custom, fallback } = counts();
      return Math.round(((custom + fallback) / ALERTS.length) * 100);
    },
    get reviewReady() {
      return counts().pending === 0;
    },
    get exportReady() {
      const blobsOk = state.alertStates.every((status, index) => {
        if (status !== "custom") return true;
        const blob = state.customMp3s.get(index);
        return Boolean(blob && blob.size > 0);
      });
      return (
        validatePackName(state.packName).ok &&
        blobsOk &&
        !state.recording &&
        !state.encoding
      );
    },
    hydrate: vi.fn(async () => {
      state.hydrated = true;
    }),
    setPackName: vi.fn(async (packName: string) => {
      state.packName = packName;
    }),
    selectAlert: vi.fn(async (index: number) => {
      state.currentIndex = index;
    }),
    next: vi.fn(async () => {
      state.currentIndex = Math.min(state.currentIndex + 1, ALERTS.length - 1);
    }),
    previous: vi.fn(async () => {
      state.currentIndex = Math.max(state.currentIndex - 1, 0);
    }),
    markFallback: vi.fn(async () => {
      state.alertStates[state.currentIndex] = "fallback";
      state.customMp3s.delete(state.currentIndex);
    }),
    startRecording: vi.fn(async () => {
      state.recording = true;
    }),
    stopRecording: vi.fn(async () => {
      state.recording = false;
      state.encoding = false;
      const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mpeg" });
      state.customMp3s.set(state.currentIndex, blob);
      state.alertStates[state.currentIndex] = "custom";
    }),
    deleteCustom: vi.fn(async () => {
      state.customMp3s.delete(state.currentIndex);
      state.alertStates[state.currentIndex] = "pending";
    }),
    applyCustomToAlerts: vi.fn(async (sourceIndex: number, targetIndexes: readonly number[]) => {
      const sourceBlob = state.customMp3s.get(sourceIndex);
      if (!sourceBlob || state.alertStates[sourceIndex] !== "custom") {
        throw new Error("missing custom");
      }
      const unique = [...new Set(targetIndexes)].filter((index) => index !== sourceIndex);
      for (const index of unique) {
        state.customMp3s.set(index, sourceBlob);
        state.alertStates[index] = "custom";
      }
      return unique.length;
    }),
    reset: vi.fn(async () => {
      state.currentIndex = 0;
      state.alertStates = ["pending", "pending", "pending"];
      state.customMp3s = new Map();
      state.packName = "";
      state.hydrated = true;
    }),
    dispose: vi.fn(async () => undefined),
    customSoundsForExport: vi.fn(() => {
      const sounds = new Map<number, Blob>();
      state.alertStates.forEach((status, index) => {
        if (status !== "custom") return;
        const blob = state.customMp3s.get(index);
        if (!blob || blob.size === 0) {
          throw new Error(`Custom recording for alert ${index + 1} is missing.`);
        }
        sounds.set(index, blob);
      });
      return sounds;
    }),
  } satisfies VoicePackSession;

  return session;
}

const pageWrappers: Array<{ unmount: () => void }> = [];

async function mountPage(
  session: VoicePackSession,
  options: {
    confirmReset?: () => boolean;
    buildZip?: ReturnType<typeof vi.fn>;
    downloadZip?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const router = createRouter({ history: createMemoryHistory(), routes: routeDefs });
  await router.push("/tools/exboss-voice-pack");
  await router.isReady();
  const wrapper = mount(ExBossVoicePackPage, {
    props: {
      session,
      confirmReset: options.confirmReset ?? (() => true),
      buildZip: options.buildZip as never,
      downloadZip: options.downloadZip,
    },
    global: { plugins: [router] },
  });
  await flushPromises();
  pageWrappers.push(wrapper);
  return wrapper;
}

function completeSession(
  overrides: Partial<{ packName: string }> = {},
): VoicePackSession {
  const session = createFakeSession({
    alertStates: ["custom", "fallback", "fallback"],
    packName: overrides.packName ?? "",
  });
  session.state.customMp3s.set(0, new Blob([new Uint8Array([7, 7])], { type: "audio/mpeg" }));
  return session;
}

describe("ExBossVoicePackPage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "Audio",
      class {
        duration = 1.8;
        preload = "";
        onended: (() => void) | null = null;
        onerror: (() => void) | null = null;
        onloadedmetadata: (() => void) | null = null;
        pause = vi.fn();
        play = vi.fn(async () => undefined);
        #src = "";
        get src() {
          return this.#src;
        }
        set src(value: string) {
          this.#src = value;
          if (value) queueMicrotask(() => this.onloadedmetadata?.());
        }
        constructor(src?: string) {
          if (src) this.src = src;
        }
      },
    );
    URL.createObjectURL = vi.fn(() => "blob:mock-url");
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    while (pageWrappers.length > 0) {
      pageWrappers.pop()?.unmount();
    }
  });

  it("hydrates the session and shows original versus custom counts", async () => {
    const session = createFakeSession({
      alertStates: ["custom", "fallback", "pending"],
    });
    session.state.customMp3s.set(0, new Blob([new Uint8Array([1])], { type: "audio/mpeg" }));
    const wrapper = await mountPage(session);
    expect(session.hydrate).toHaveBeenCalled();
    expect(wrapper.find("[data-testid='exboss-voice-pack-page']").exists()).toBe(true);
    expect(wrapper.get("[data-testid='voice-pack-export-counts']").text()).toContain("Custom 1");
    expect(wrapper.get("[data-testid='voice-pack-export-counts']").text()).toContain("Original 2");
    expect(wrapper.get("[data-testid='voice-pack-alert-state']").text()).toBe("Custom");
  });

  it("changes the current alert from the sidebar", async () => {
    const session = createFakeSession();
    const wrapper = await mountPage(session);
    await wrapper.get("[data-testid='voice-pack-alert-2']").trigger("click");
    await flushPromises();
    expect(session.selectAlert).toHaveBeenCalledWith(2);
    expect(wrapper.get("[data-testid='voice-pack-recording-card']").text()).toContain("Yellow");
  });

  it("keeps original on Enter when no custom recording exists", async () => {
    const session = createFakeSession();
    const wrapper = await mountPage(session);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await flushPromises();
    expect(session.markFallback).toHaveBeenCalled();
    expect(session.next).toHaveBeenCalled();
    expect(wrapper.text()).not.toContain("English reference");
  });

  it("starts recording through the session API and shows recording UI", async () => {
    const session = createFakeSession();
    const wrapper = await mountPage(session);
    await wrapper.get("[data-testid='voice-pack-record']").trigger("click");
    await flushPromises();
    expect(session.startRecording).toHaveBeenCalled();
    expect(wrapper.find("[data-testid='voice-pack-recording-active']").exists()).toBe(true);
  });

  it("renders custom recording state and can delete back to original", async () => {
    const session = createFakeSession({
      alertStates: ["custom", "pending", "pending"],
    });
    session.state.customMp3s.set(0, new Blob([new Uint8Array([9])], { type: "audio/mpeg" }));
    const wrapper = await mountPage(session);
    expect(wrapper.get("[data-testid='voice-pack-alert-state']").text()).toBe("Custom");
    expect(wrapper.find("[data-testid='voice-pack-play-custom']").exists()).toBe(true);
    await wrapper.get("[data-testid='voice-pack-delete-custom']").trigger("click");
    await flushPromises();
    expect(session.deleteCustom).toHaveBeenCalled();
    expect(wrapper.get("[data-testid='voice-pack-alert-state']").text()).toBe("Original");
  });

  it("supports Previous and Next", async () => {
    const session = createFakeSession({ currentIndex: 1 });
    const wrapper = await mountPage(session);
    await wrapper.get("[data-testid='voice-pack-next']").trigger("click");
    await flushPromises();
    expect(session.next).toHaveBeenCalled();
    await wrapper.get("[data-testid='voice-pack-previous']").trigger("click");
    await flushPromises();
    expect(session.previous).toHaveBeenCalled();
  });

  it("uses the pinned SHA for English reference playback", async () => {
    const constructed: Array<{ src: string }> = [];
    vi.stubGlobal(
      "Audio",
      class {
        src = "";
        onended: (() => void) | null = null;
        onerror: (() => void) | null = null;
        pause = vi.fn();
        play = vi.fn(async () => undefined);
        constructor(src?: string) {
          this.src = src ?? "";
          constructed.push(this);
        }
      },
    );
    const session = createFakeSession();
    const wrapper = await mountPage(session);
    await wrapper.get("[data-testid='voice-pack-play-english']").trigger("click");
    await flushPromises();
    expect(
      constructed.some(
        (entry) =>
          entry.src ===
          `https://raw.githubusercontent.com/aizuon/EXBOSS/${EXBOSS_VOICE_PACK_PROVENANCE.commitSha}/EXBOSS-ENG/Sounds/prepare-aoe.ogg`,
      ),
    ).toBe(true);
  });

  it("stops playback when switching alerts", async () => {
    const pause = vi.fn();
    vi.stubGlobal(
      "Audio",
      class {
        src = "";
        onended: (() => void) | null = null;
        onerror: (() => void) | null = null;
        pause = pause;
        play = vi.fn(async () => undefined);
      },
    );
    const session = createFakeSession();
    const wrapper = await mountPage(session);
    await wrapper.get("[data-testid='voice-pack-play-english']").trigger("click");
    await wrapper.get("[data-testid='voice-pack-alert-1']").trigger("click");
    await flushPromises();
    expect(pause).toHaveBeenCalled();
    expect(session.selectAlert).toHaveBeenCalledWith(1);
  });

  it("maps domain recording errors to UI feedback", async () => {
    const session = createFakeSession();
    session.startRecording = vi.fn(async () => {
      const { VoicePackRecordingError } = await import("../lib/exboss-voice-pack-recorder");
      throw new VoicePackRecordingError("PERMISSION_DENIED");
    });
    const wrapper = await mountPage(session);
    await wrapper.get("[data-testid='voice-pack-record']").trigger("click");
    await flushPromises();
    expect(wrapper.get("[data-testid='voice-pack-error']").text()).toMatch(/permission was denied/i);
  });

  it("resets the session after Start over confirmation", async () => {
    const session = createFakeSession({
      alertStates: ["fallback", "custom", "pending"],
      currentIndex: 2,
    });
    const confirmReset = vi.fn(() => true);
    const wrapper = await mountPage(session, { confirmReset });
    await wrapper.get("[data-testid='voice-pack-start-over']").trigger("click");
    await flushPromises();
    expect(confirmReset).toHaveBeenCalled();
    expect(session.reset).toHaveBeenCalled();
    expect(wrapper.text()).toContain("Alert 1 of 3");
  });

  it("exposes a mobile navigation control", async () => {
    const session = createFakeSession();
    const wrapper = await mountPage(session);
    expect(wrapper.find("[data-testid='voice-pack-mobile-nav']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='voice-pack-mobile-nav-toggle']").exists()).toBe(true);
  });

  it("shows English original duration next to play", async () => {
    const session = createFakeSession();
    const wrapper = await mountPage(session);
    await flushPromises();
    expect(wrapper.get("[data-testid='voice-pack-english-duration']").text()).toBe("1.8s");
  });

  it("navigates with arrow keys and keeps custom on Enter", async () => {
    const session = createFakeSession({
      alertStates: ["custom", "pending", "pending"],
      currentIndex: 0,
    });
    session.state.customMp3s.set(0, new Blob([new Uint8Array([9])], { type: "audio/mpeg" }));
    await mountPage(session);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    await flushPromises();
    expect(session.next).toHaveBeenCalled();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    await flushPromises();
    expect(session.next).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    await flushPromises();
    expect(session.previous).toHaveBeenCalled();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
    await flushPromises();
    expect(session.previous).toHaveBeenCalledTimes(2);

    const nextCallsBeforeKeep = (session.next as ReturnType<typeof vi.fn>).mock.calls.length;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await flushPromises();
    expect(session.markFallback).not.toHaveBeenCalled();
    expect(session.next).toHaveBeenCalledTimes(nextCallsBeforeKeep + 1);
  });

  it("filters the alert list from the search bar", async () => {
    const session = createFakeSession();
    const wrapper = await mountPage(session);
    const search = wrapper.get("[data-testid='voice-pack-alert-search-desktop']");
    await search.setValue("Yellow");
    const nav = search.element.closest(".alert-nav");
    expect(nav?.textContent).toContain("Yellow");
    expect(nav?.textContent).not.toContain("Prepare AOE");
  });

  it("applies the current custom recording to selected bulk targets", async () => {
    const session = createFakeSession({
      alertStates: ["custom", "pending", "pending"],
    });
    session.state.customMp3s.set(0, new Blob([new Uint8Array([9])], { type: "audio/mpeg" }));
    const wrapper = await mountPage(session);
    await wrapper.get("[data-testid='voice-pack-bulk-replace']").trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-testid='voice-pack-bulk-modal']").exists()).toBe(true);
    await wrapper.get("[data-testid='voice-pack-bulk-check-1']").setValue(true);
    await wrapper.get("[data-testid='voice-pack-bulk-apply']").trigger("click");
    await flushPromises();
    expect(session.applyCustomToAlerts).toHaveBeenCalled();
    const call = (session.applyCustomToAlerts as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    expect(call[0]).toBe(0);
    expect(call[1]).toContain(1);
    expect(wrapper.get("[data-testid='voice-pack-bulk-success']").text()).toMatch(/Applied/i);
  });

  it("keeps export and recording on the same page", async () => {
    const session = completeSession();
    const wrapper = await mountPage(session);
    expect(wrapper.find("[data-testid='voice-pack-open-review']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='voice-pack-review']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='voice-pack-recording-card']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='voice-pack-export']").exists()).toBe(true);
    expect(wrapper.get("[data-testid='voice-pack-export-counts']").text()).toContain("Custom 1");
    expect(wrapper.get("[data-testid='voice-pack-export-counts']").text()).toContain("Original 2");
    expect(wrapper.get("[data-testid='voice-pack-install-guidance']").text()).toContain("EXBOSS-ENG");
  });

  it("keeps export disabled until the pack name is valid", async () => {
    const session = createFakeSession({
      alertStates: ["custom", "fallback", "pending"],
    });
    session.state.customMp3s.set(0, new Blob([new Uint8Array([1])], { type: "audio/mpeg" }));
    const wrapper = await mountPage(session);
    expect(
      (wrapper.get("[data-testid='voice-pack-download']").element as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(wrapper.get("[data-testid='voice-pack-name-error']").text()).toMatch(/required|empty/i);
  });

  it("plays effective custom and original sounds from the alert list", async () => {
    const constructed: Array<{ src: string }> = [];
    vi.stubGlobal(
      "Audio",
      class {
        src = "";
        onended: (() => void) | null = null;
        onerror: (() => void) | null = null;
        pause = vi.fn();
        play = vi.fn(async () => undefined);
        constructor(src?: string) {
          this.src = src ?? "";
          constructed.push(this);
        }
      },
    );
    const session = completeSession();
    const wrapper = await mountPage(session);
    await wrapper.get("[data-testid='voice-pack-nav-play-0']").trigger("click");
    await flushPromises();
    expect(constructed.some((entry) => entry.src === "blob:mock-url")).toBe(true);
    await wrapper.get("[data-testid='voice-pack-nav-play-1']").trigger("click");
    await flushPromises();
    expect(
      constructed.some(
        (entry) =>
          entry.src ===
          `https://raw.githubusercontent.com/aizuon/EXBOSS/${EXBOSS_VOICE_PACK_PROVENANCE.commitSha}/EXBOSS-ENG/Sounds/prepare-interrupt.ogg`,
      ),
    ).toBe(true);
  });

  it("enables export for a valid pack name and shows the addon folder id", async () => {
    const session = completeSession();
    const wrapper = await mountPage(session);
    const download = wrapper.get("[data-testid='voice-pack-download']");
    expect((download.element as HTMLButtonElement).disabled).toBe(true);

    await wrapper.get("[data-testid='voice-pack-name-input']").setValue("Julien's Voice / FR");
    await flushPromises();
    expect(session.setPackName).toHaveBeenCalledWith("Julien's Voice / FR");
    expect(wrapper.get("[data-testid='voice-pack-addon-directory']").text()).toContain(
      "EXBOSS-MT-Juliens-Voice-FR",
    );
    expect((wrapper.get("[data-testid='voice-pack-download']").element as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("disables export for an invalid pack name", async () => {
    const session = completeSession({ packName: "Ready Pack" });
    const wrapper = await mountPage(session);
    await wrapper.get("[data-testid='voice-pack-name-input']").setValue("   ");
    await flushPromises();
    expect(
      (wrapper.get("[data-testid='voice-pack-download']").element as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(wrapper.find("[data-testid='voice-pack-name-error']").exists()).toBe(true);
  });

  it("passes custom MP3s to the exporter and downloads the ZIP filename", async () => {
    const session = completeSession({ packName: "Julien's Voice / FR" });
    const zipBytes = new Uint8Array([1, 2, 3]);
    const buildZip = vi.fn(
      async (_input: {
        packName: string;
        customSounds: Map<number, Blob>;
        alerts?: readonly ExBossVoiceAlert[];
      }) => ({
        addonDirectory: "EXBOSS-MT-Juliens-Voice-FR",
        packName: "Julien's Voice / FR",
        zipBytes,
        customFilenames: ["prepare-aoe.mp3"],
      }),
    );
    const downloadZip = vi.fn();
    const wrapper = await mountPage(session, { buildZip, downloadZip });
    await wrapper.get("[data-testid='voice-pack-download']").trigger("click");
    await flushPromises();
    expect(session.customSoundsForExport).toHaveBeenCalled();
    expect(buildZip).toHaveBeenCalledWith(
      expect.objectContaining({
        packName: "Julien's Voice / FR",
        customSounds: expect.any(Map),
      }),
    );
    const sounds = buildZip.mock.calls[0]![0].customSounds;
    expect(sounds.has(0)).toBe(true);
    expect(downloadZip).toHaveBeenCalledWith(zipBytes, "EXBOSS-MT-Juliens-Voice-FR.zip");
    expect(wrapper.get("[data-testid='voice-pack-export-success']").text()).toMatch(
      /EXBOSS-MT-Juliens-Voice-FR\.zip/,
    );
    expect(session.reset).not.toHaveBeenCalled();
  });

  it("prevents duplicate export while generating ZIP", async () => {
    const session = completeSession({ packName: "Ready Pack" });
    let release!: (value: {
      addonDirectory: string;
      packName: string;
      zipBytes: Uint8Array;
      customFilenames: string[];
    }) => void;
    const buildZip = vi.fn(
      () =>
        new Promise<{
          addonDirectory: string;
          packName: string;
          zipBytes: Uint8Array;
          customFilenames: string[];
        }>((resolve) => {
          release = resolve;
        }),
    );
    const downloadZip = vi.fn();
    const wrapper = await mountPage(session, { buildZip, downloadZip });
    await wrapper.get("[data-testid='voice-pack-download']").trigger("click");
    await flushPromises();
    expect(wrapper.get("[data-testid='voice-pack-download']").text()).toMatch(/Generating ZIP/i);
    expect(
      (wrapper.get("[data-testid='voice-pack-download']").element as HTMLButtonElement).disabled,
    ).toBe(true);
    await wrapper.get("[data-testid='voice-pack-download']").trigger("click");
    expect(buildZip).toHaveBeenCalledTimes(1);
    release({
      addonDirectory: "EXBOSS-MT-Ready-Pack",
      packName: "Ready Pack",
      zipBytes: new Uint8Array([9]),
      customFilenames: [],
    });
    await flushPromises();
    expect(downloadZip).toHaveBeenCalledTimes(1);
  });

  it("shows export failure without resetting the draft", async () => {
    const session = completeSession({ packName: "Ready Pack" });
    const buildZip = vi.fn(async () => {
      throw new Error("ZIP boom");
    });
    const wrapper = await mountPage(session, { buildZip, downloadZip: vi.fn() });
    await wrapper.get("[data-testid='voice-pack-download']").trigger("click");
    await flushPromises();
    expect(wrapper.get("[data-testid='voice-pack-error']").text()).toContain("ZIP boom");
    expect(session.reset).not.toHaveBeenCalled();
    expect(session.state.customMp3s.has(0)).toBe(true);
    expect(wrapper.find("[data-testid='voice-pack-export']").exists()).toBe(true);
  });
});

describe("exboss voice pack route registration", () => {
  it("registers the public tools route", () => {
    const route = routeDefs.find((entry) => entry.name === "exboss-voice-pack");
    expect(route?.path).toBe("/tools/exboss-voice-pack");
    expect(route?.meta?.requiresAuth).toBeUndefined();
  });
});
