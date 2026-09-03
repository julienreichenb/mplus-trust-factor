import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import {
  createIndexedDbDraftStore,
  createMemoryDraftStore,
  emptyDraftMeta,
  parseDraftMeta,
  reconcileDraft,
  VOICE_PACK_DRAFT_SCHEMA_VERSION,
  type VoicePackDraftMeta,
} from "./exboss-voice-pack-storage";

describe("draft meta parsing and reconcile", () => {
  it("rejects unsupported schema versions", () => {
    expect(
      parseDraftMeta(
        {
          schemaVersion: 999,
          packName: "X",
          currentIndex: 0,
          alertStates: ["pending"],
        },
        1,
      ),
    ).toBeNull();
  });

  it("recovers custom metadata when the MP3 blob is missing", () => {
    const meta: VoicePackDraftMeta = {
      schemaVersion: VOICE_PACK_DRAFT_SCHEMA_VERSION,
      packName: "Test",
      currentIndex: 1,
      alertStates: ["custom", "fallback", "pending"],
    };
    const reconciled = reconcileDraft(meta, [/* no blobs */]);
    expect(reconciled.meta.alertStates).toEqual(["pending", "fallback", "pending"]);
  });
});

describe("memory draft store", () => {
  it("saves and loads metadata and MP3 blobs", async () => {
    const store = createMemoryDraftStore();
    const meta = emptyDraftMeta(3, "Pack");
    meta.alertStates[1] = "custom";
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mpeg" });
    await store.saveMeta(meta);
    await store.putMp3(1, blob);
    const loaded = await store.load(3);
    expect(loaded?.meta.packName).toBe("Pack");
    expect(loaded?.mp3s.get(1)?.size).toBe(3);
  });

  it("replaces and deletes recordings", async () => {
    const store = createMemoryDraftStore();
    const meta = emptyDraftMeta(2, "Pack");
    meta.alertStates[0] = "custom";
    await store.saveMeta(meta);
    await store.putMp3(0, new Blob([new Uint8Array([1])], { type: "audio/mpeg" }));
    await store.putMp3(0, new Blob([new Uint8Array([9, 9])], { type: "audio/mpeg" }));
    let loaded = await store.load(2);
    expect(loaded?.mp3s.get(0)?.size).toBe(2);
    await store.deleteMp3(0);
    meta.alertStates[0] = "pending";
    await store.saveMeta(meta);
    loaded = await store.load(2);
    expect(loaded?.mp3s.has(0)).toBe(false);
  });

  it("resets the entire draft", async () => {
    const store = createMemoryDraftStore();
    await store.saveMeta(emptyDraftMeta(1, "Pack"));
    await store.putMp3(0, new Blob([new Uint8Array([1])], { type: "audio/mpeg" }));
    await store.clear();
    expect(await store.load(1)).toBeNull();
  });

  it("recovers recorded metadata with a missing blob", async () => {
    const meta = emptyDraftMeta(2, "Pack");
    meta.alertStates[0] = "custom";
    const store = createMemoryDraftStore({ meta, mp3s: new Map() });
    const loaded = await store.load(2);
    expect(loaded?.meta.alertStates[0]).toBe("pending");
  });
});

describe("IndexedDB draft store", () => {
  it("persists metadata and MP3 blobs through IndexedDB", async () => {
    const store = createIndexedDbDraftStore({
      dbName: `exboss-test-draft-${Date.now()}-${Math.random()}`,
    });
    const meta = emptyDraftMeta(2, "Indexed");
    meta.alertStates[0] = "custom";
    meta.alertStates[1] = "fallback";
    const blob = new Uint8Array([7, 8, 9]);
    await store.saveMeta(meta);
    await store.putMp3(0, blob);
    const loaded = await store.load(2);
    expect(loaded?.meta.packName).toBe("Indexed");
    expect(loaded?.mp3s.size).toBe(1);
    expect(loaded?.mp3s.get(0)?.size).toBe(3);
    expect(loaded?.meta.alertStates[0]).toBe("custom");
    expect(loaded?.meta.alertStates[1]).toBe("fallback");
    await store.close?.();
  });

  it("recovers missing IndexedDB blobs safely", async () => {
    const store = createIndexedDbDraftStore({
      dbName: `exboss-test-missing-${Date.now()}-${Math.random()}`,
    });
    const meta = emptyDraftMeta(1, "Missing");
    meta.alertStates[0] = "custom";
    await store.saveMeta(meta);
    const loaded = await store.load(1);
    expect(loaded?.meta.alertStates[0]).toBe("pending");
    expect(loaded?.mp3s.size).toBe(0);
    await store.close?.();
  });
});
