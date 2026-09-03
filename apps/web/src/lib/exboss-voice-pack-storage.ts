import { blobToUint8Array, bytesToMpegBlob, restoreBinaryBlob } from "./exboss-voice-pack-binary";

export const VOICE_PACK_DRAFT_SCHEMA_VERSION = 1;
export const VOICE_PACK_IDB_NAME = "mplus-exboss-voice-pack";
export const VOICE_PACK_IDB_VERSION = 1;

export type VoicePackAlertState = "pending" | "custom" | "fallback";
export type VoicePackUiState = "original" | "custom";

export function voicePackUiState(state: VoicePackAlertState | undefined): VoicePackUiState {
  return state === "custom" ? "custom" : "original";
}

export interface VoicePackDraftMeta {
  schemaVersion: number;
  packName: string;
  currentIndex: number;
  alertStates: VoicePackAlertState[];
}

export interface HydratedVoicePackDraft {
  meta: VoicePackDraftMeta;
  mp3s: Map<number, Blob>;
}

export interface VoicePackDraftStore {
  load(expectedAlertCount: number): Promise<HydratedVoicePackDraft | null>;
  saveMeta(meta: VoicePackDraftMeta): Promise<void>;
  putMp3(index: number, blob: Blob | Uint8Array): Promise<void>;
  deleteMp3(index: number): Promise<void>;
  clear(): Promise<void>;
  close?(): Promise<void>;
}

const META_KEY = "draft";
const META_STORE = "meta";
const MP3_STORE = "mp3s";

export function emptyDraftMeta(alertCount: number, packName = ""): VoicePackDraftMeta {
  return {
    schemaVersion: VOICE_PACK_DRAFT_SCHEMA_VERSION,
    packName,
    currentIndex: 0,
    alertStates: Array.from({ length: alertCount }, () => "pending"),
  };
}

export function parseDraftMeta(raw: unknown, expectedAlertCount: number): VoicePackDraftMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (record.schemaVersion !== VOICE_PACK_DRAFT_SCHEMA_VERSION) return null;
  if (typeof record.packName !== "string") return null;
  if (!Number.isInteger(record.currentIndex)) return null;
  if (!Array.isArray(record.alertStates)) return null;
  const alertStates = record.alertStates.map((state) =>
    state === "custom" || state === "fallback" || state === "pending" ? state : null,
  );
  if (alertStates.some((state) => state === null)) return null;
  return {
    schemaVersion: VOICE_PACK_DRAFT_SCHEMA_VERSION,
    packName: record.packName,
    currentIndex: clampIndex(Number(record.currentIndex), expectedAlertCount),
    alertStates: normalizeAlertStates(alertStates as VoicePackAlertState[], expectedAlertCount),
  };
}

export function reconcileDraft(
  meta: VoicePackDraftMeta,
  mp3Indexes: Iterable<number>,
): HydratedVoicePackDraft {
  const available = new Set(mp3Indexes);
  const mp3s = new Map<number, Blob>();
  const alertStates = meta.alertStates.map((state, index) => {
    if (state === "custom" && !available.has(index)) return "pending" as const;
    return state;
  });
  return {
    meta: {
      ...meta,
      alertStates,
    },
    mp3s,
  };
}

export function createMemoryDraftStore(
  initial?: HydratedVoicePackDraft | null,
): VoicePackDraftStore {
  let meta: VoicePackDraftMeta | null = initial?.meta ?? null;
  const mp3s = new Map<number, Blob>(initial?.mp3s ?? []);

  return {
    async load(expectedAlertCount: number): Promise<HydratedVoicePackDraft | null> {
      const parsed = parseDraftMeta(meta, expectedAlertCount);
      if (!parsed) {
        meta = null;
        mp3s.clear();
        return null;
      }
      const reconciled = reconcileDraft(parsed, mp3s.keys());
      const kept = new Map<number, Blob>();
      reconciled.meta.alertStates.forEach((state, index) => {
        const blob = mp3s.get(index);
        if (state === "custom" && blob && blob.size > 0) {
          kept.set(index, blob);
        }
      });
      mp3s.clear();
      for (const [index, blob] of kept) mp3s.set(index, blob);
      meta = reconciled.meta;
      return { meta: reconciled.meta, mp3s: new Map(kept) };
    },
    async saveMeta(next: VoicePackDraftMeta): Promise<void> {
      meta = next;
    },
    async putMp3(index: number, blob: Blob | Uint8Array): Promise<void> {
      mp3s.set(index, blob instanceof Uint8Array ? bytesToMpegBlob(blob) : blob);
    },
    async deleteMp3(index: number): Promise<void> {
      mp3s.delete(index);
    },
    async clear(): Promise<void> {
      meta = null;
      mp3s.clear();
    },
  };
}

export function createIndexedDbDraftStore(
  options: { indexedDB?: IDBFactory; dbName?: string } = {},
): VoicePackDraftStore {
  const factory = options.indexedDB ?? globalThis.indexedDB;
  const dbName = options.dbName ?? VOICE_PACK_IDB_NAME;
  let connection: IDBDatabase | null = null;
  let openPromise: Promise<IDBDatabase> | null = null;

  async function openDb(): Promise<IDBDatabase> {
    if (!factory) {
      throw new Error("IndexedDB is unavailable.");
    }
    if (connection) return connection;
    if (openPromise) return openPromise;
    openPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(dbName, VOICE_PACK_IDB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE);
        }
        if (!db.objectStoreNames.contains(MP3_STORE)) {
          db.createObjectStore(MP3_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed."));
    })
      .then((db) => {
        connection = db;
        connection.onclose = () => {
          connection = null;
          openPromise = null;
        };
        return db;
      })
      .catch((error) => {
        openPromise = null;
        throw error;
      });
    return openPromise;
  }

  async function withStores<T>(
    mode: IDBTransactionMode,
    work: (metaStore: IDBObjectStore, mp3Store: IDBObjectStore) => void,
  ): Promise<T> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([META_STORE, MP3_STORE], mode);
      tx.oncomplete = () => resolve(undefined as T);
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed."));
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted."));
      work(tx.objectStore(META_STORE), tx.objectStore(MP3_STORE));
    });
  }

  function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
    });
  }

  return {
    async load(expectedAlertCount: number): Promise<HydratedVoicePackDraft | null> {
      try {
        const db = await openDb();
        const tx = db.transaction([META_STORE, MP3_STORE], "readonly");
        const metaRequest = tx.objectStore(META_STORE).get(META_KEY);
        const valuesRequest = tx.objectStore(MP3_STORE).getAll();
        const keysRequest = tx.objectStore(MP3_STORE).getAllKeys();
        const [rawMeta, values, keys] = await Promise.all([
          requestToPromise(metaRequest),
          requestToPromise(valuesRequest),
          requestToPromise(keysRequest),
        ]);
        const parsed = parseDraftMeta(rawMeta, expectedAlertCount);
        if (!parsed) return null;

        const storedMp3s = new Map<number, Blob>();
        (keys as IDBValidKey[]).forEach((key, offset) => {
          const index = Number(key);
          if (!Number.isInteger(index) || index < 0) return;
          const blob = restoreBinaryBlob(values[offset]);
          if (blob) storedMp3s.set(index, blob);
        });

        const reconciled = reconcileDraft(parsed, storedMp3s.keys());
        const mp3s = new Map<number, Blob>();
        const orphanKeys: string[] = [];
        (keys as IDBValidKey[]).forEach((key) => {
          const index = Number(key);
          if (!Number.isInteger(index) || index < 0 || index >= expectedAlertCount) {
            orphanKeys.push(String(key));
          }
        });
        reconciled.meta.alertStates.forEach((state, index) => {
          const blob = storedMp3s.get(index);
          if (state === "custom" && blob && blob.size > 0) {
            mp3s.set(index, blob);
          } else {
            if (state === "custom") {
              reconciled.meta.alertStates[index] = "pending";
            }
            if (storedMp3s.has(index)) {
              orphanKeys.push(String(index));
            }
          }
        });
        if (orphanKeys.length > 0) {
          await withStores("readwrite", (_metaStore, mp3Store) => {
            for (const key of orphanKeys) mp3Store.delete(key);
          });
        }
        return { meta: reconciled.meta, mp3s };
      } catch {
        return null;
      }
    },
    async saveMeta(meta: VoicePackDraftMeta): Promise<void> {
      await withStores("readwrite", (metaStore) => {
        metaStore.put(meta, META_KEY);
      });
    },
    async putMp3(index: number, blob: Blob | Uint8Array): Promise<void> {
      const bytes =
        blob instanceof Uint8Array ? blob.slice() : await blobToUint8Array(blob);
      await withStores("readwrite", (_metaStore, mp3Store) => {
        mp3Store.put(bytes.slice(), String(index));
      });
    },
    async deleteMp3(index: number): Promise<void> {
      await withStores("readwrite", (_metaStore, mp3Store) => {
        mp3Store.delete(String(index));
      });
    },
    async clear(): Promise<void> {
      await withStores("readwrite", (metaStore, mp3Store) => {
        metaStore.clear();
        mp3Store.clear();
      });
    },
    async close(): Promise<void> {
      if (connection) {
        connection.close();
        connection = null;
      }
    },
  };
}

function clampIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(Math.max(0, index), count - 1);
}

function normalizeAlertStates(
  states: VoicePackAlertState[],
  expectedAlertCount: number,
): VoicePackAlertState[] {
  const next = states.slice(0, expectedAlertCount);
  while (next.length < expectedAlertCount) next.push("pending");
  return next;
}
