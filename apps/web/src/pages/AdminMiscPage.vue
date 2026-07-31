<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { ApiClientError } from "../api/live-client";
import StatusBanner from "../components/common/StatusBanner.vue";

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";
const router = useRouter();

const REGION_OPTIONS = ["EU", "US", "KR", "TW"] as const;

type RegionOption = (typeof REGION_OPTIONS)[number];
type BusyAction = "realms" | "season" | null;

interface RealmSyncResultRow {
  region: string;
  indexed: number;
  upserted: number;
  detailsFetched: number;
  skippedDetails: number;
  errors: string[];
}

interface SeasonSyncResultRow {
  region: string;
  previous: { blizzardSeasonId: number | null; slug: string | null };
  current: {
    blizzardSeasonId: number;
    slug: string;
    authoritySource: string;
    authorityVerifiedAt: string;
  };
  changed: boolean;
}

const selectedRegions = ref<RegionOption[]>(["EU"]);
const forceDetails = ref(false);
const busyAction = ref<BusyAction>(null);
const error = ref<string | null>(null);
const message = ref<string | null>(null);
const realmResults = ref<RealmSyncResultRow[]>([]);
const seasonResults = ref<SeasonSyncResultRow[]>([]);

const bannerText = computed(() => error.value || message.value || "");
const bannerTone = computed(() => (error.value ? "error" : "success"));
const anyBusy = computed(() => busyAction.value !== null);

function handleAuthError(err: unknown): boolean {
  if (err instanceof ApiClientError && (err.status === 401 || err.status === 403)) {
    void router.replace(err.status === 401 ? "/auth/signin" : "/access-denied");
    return true;
  }
  return false;
}

function toggleRegion(region: RegionOption): void {
  const next = new Set(selectedRegions.value);
  if (next.has(region)) {
    if (next.size === 1) return;
    next.delete(region);
  } else {
    next.add(region);
  }
  selectedRegions.value = REGION_OPTIONS.filter((r) => next.has(r));
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: { message?: string };
  };
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      void router.replace(response.status === 401 ? "/auth/signin" : "/access-denied");
      throw new ApiClientError(
        payload.error?.message ?? "Unauthorized",
        response.status,
        response.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN",
      );
    }
    throw new Error(payload.error?.message ?? `Request failed (${response.status})`);
  }
  return payload;
}

async function syncRealms(): Promise<void> {
  if (anyBusy.value || selectedRegions.value.length === 0) return;
  busyAction.value = "realms";
  error.value = null;
  message.value = null;
  realmResults.value = [];
  try {
    const body = await postJson<{ ok?: boolean; results?: RealmSyncResultRow[] }>(
      "/api/v1/admin/misc/realms/sync",
      {
        regions: selectedRegions.value,
        forceDetails: forceDetails.value,
      },
    );
    realmResults.value = body.results ?? [];
    const totalUpserted = realmResults.value.reduce((n, r) => n + r.upserted, 0);
    const totalErrors = realmResults.value.reduce((n, r) => n + r.errors.length, 0);
    message.value =
      totalErrors > 0
        ? `Realm sync finished with ${totalErrors} error(s). Upserted ${totalUpserted} realm(s).`
        : `Realm catalog refreshed. Upserted ${totalUpserted} realm(s).`;
  } catch (err) {
    if (!handleAuthError(err)) error.value = (err as Error).message;
  } finally {
    busyAction.value = null;
  }
}

async function syncSeasonAuthority(): Promise<void> {
  if (anyBusy.value || selectedRegions.value.length === 0) return;
  busyAction.value = "season";
  error.value = null;
  message.value = null;
  seasonResults.value = [];
  try {
    const body = await postJson<{ ok?: boolean; results?: SeasonSyncResultRow[] }>(
      "/api/v1/admin/misc/season/sync-authority",
      { regions: selectedRegions.value },
    );
    seasonResults.value = body.results ?? [];
    const changed = seasonResults.value.filter((r) => r.changed).length;
    message.value =
      changed > 0
        ? `Season authority synced. ${changed} region(s) changed.`
        : "Season authority synced. No changes.";
  } catch (err) {
    if (!handleAuthError(err)) error.value = (err as Error).message;
  } finally {
    busyAction.value = null;
  }
}
</script>

<template>
  <section class="admin-misc" data-testid="admin-misc-page">
    <h1>Admin misc</h1>
    <p class="muted">
      One-off operational actions that don’t belong on a dedicated admin surface yet.
    </p>

    <StatusBanner v-if="bannerText" :tone="bannerTone" :message="bannerText" />

    <fieldset class="regions" :disabled="anyBusy">
      <legend>Regions (shared)</legend>
      <label v-for="region in REGION_OPTIONS" :key="region" class="admin-checkbox">
        <input
          type="checkbox"
          :checked="selectedRegions.includes(region)"
          @change="toggleRegion(region)"
        />
        <span>{{ region }}</span>
      </label>
    </fieldset>

    <article class="tool-row" data-testid="realm-sync-tool">
      <div class="tool-row__main">
        <div class="tool-row__copy">
          <h2>Refresh realm catalog</h2>
          <p class="muted">
            Same as <code>pnpm realms:sync</code> — pulls Blizzard Game Data realms into the local
            catalog.
          </p>
          <label class="admin-checkbox force-details">
            <input v-model="forceDetails" type="checkbox" :disabled="anyBusy" />
            <span>Force re-fetch realm details (slow)</span>
          </label>
        </div>
        <button
          type="button"
          class="btn"
          data-testid="sync-realms-button"
          :disabled="anyBusy || selectedRegions.length === 0"
          @click="syncRealms"
        >
          {{ busyAction === "realms" ? "Syncing…" : "Refresh realms" }}
        </button>
      </div>
      <ul v-if="realmResults.length" class="results" data-testid="realm-sync-results">
        <li v-for="row in realmResults" :key="row.region">
          <strong>{{ row.region }}</strong>
          — indexed {{ row.indexed }}, upserted {{ row.upserted }}, details
          {{ row.detailsFetched }}, skipped {{ row.skippedDetails }}
          <span v-if="row.errors.length" class="errors"> · {{ row.errors.length }} error(s)</span>
        </li>
      </ul>
    </article>

    <article class="tool-row" data-testid="season-sync-tool">
      <div class="tool-row__main">
        <div class="tool-row__copy">
          <h2>Refresh season authority</h2>
          <p class="muted">
            Same as <code>pnpm season:sync-authority</code> — repairs the current Blizzard season
            marker per region (no score refreshes).
          </p>
        </div>
        <button
          type="button"
          class="btn"
          data-testid="sync-season-button"
          :disabled="anyBusy || selectedRegions.length === 0"
          @click="syncSeasonAuthority"
        >
          {{ busyAction === "season" ? "Syncing…" : "Refresh season" }}
        </button>
      </div>
      <ul v-if="seasonResults.length" class="results" data-testid="season-sync-results">
        <li v-for="row in seasonResults" :key="row.region">
          <strong>{{ row.region }}</strong>
          —
          <template v-if="row.changed">
            {{ row.previous.slug ?? "—" }} → {{ row.current.slug }}
          </template>
          <template v-else> unchanged ({{ row.current.slug }})</template>
        </li>
      </ul>
    </article>
  </section>
</template>

<style scoped>
.admin-misc {
  display: grid;
  gap: var(--space-4);
  max-width: 48rem;
}
.muted {
  color: var(--color-text-muted);
  margin: 0;
}
.tool-row {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-4) 0;
  border: 0;
  border-bottom: 1px solid rgb(255 255 255 / 14%);
  background: transparent;
  border-radius: 0;
}
.tool-row__main {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
}
.tool-row__copy {
  display: grid;
  gap: var(--space-2);
  flex: 1;
  min-width: 14rem;
}
.tool-row h2 {
  margin: 0;
  font-size: 1.05rem;
}
.regions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 1rem;
  margin: 0;
  padding: 0;
  border: 0;
}
.regions legend {
  padding: 0;
  margin-bottom: 0.35rem;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}
.force-details {
  width: fit-content;
}
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: fit-content;
  min-height: 2.5rem;
  padding: 0.45rem 1rem;
  border: none;
  border-radius: 0.4rem;
  background: #1f6feb;
  color: #fff;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  flex-shrink: 0;
}
.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.results {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.35rem;
  font-size: 0.9rem;
}
.errors {
  color: #fca5a5;
}
code {
  font-family: var(--font-data);
  font-size: 0.9em;
}
</style>
