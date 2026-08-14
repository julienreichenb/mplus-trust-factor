<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import type {
  AdminRealmSyncResult,
  RegionCode,
  ScoringSeasonSelectionStatusDTO,
} from "@mplus/contracts";
import { api } from "../api/client";
import { ApiClientError } from "../api/live-client";
import StatusBanner from "../components/common/StatusBanner.vue";
import AdminSelect from "../components/admin/AdminSelect.vue";
import { formatScoringSeasonLabel } from "../lib/scoringSeasonLabel";
import { ADMIN_SCORING_DEFAULT_REGION } from "../lib/adminScoringRegion";

const router = useRouter();

const REGION_OPTIONS = ["EU", "US", "KR", "TW"] as const satisfies ReadonlyArray<RegionCode>;

type RegionOption = (typeof REGION_OPTIONS)[number];
type BusyAction = "realms" | "season" | "scoringSeasonLoad" | "scoringSeasonSave" | null;

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

const selectedRegions = ref<RegionOption[]>([ADMIN_SCORING_DEFAULT_REGION]);
const forceDetails = ref(false);
const busyAction = ref<BusyAction>(null);
const error = ref<string | null>(null);
const message = ref<string | null>(null);
const realmResults = ref<AdminRealmSyncResult[]>([]);
const seasonResults = ref<SeasonSyncResultRow[]>([]);

const scoringSeasonStatus = ref<ScoringSeasonSelectionStatusDTO | null>(null);
const draftMode = ref<"AUTO" | "PINNED">("AUTO");
const draftPinnedBlizzardSeasonId = ref<number | null>(null);

const bannerText = computed(() => error.value || message.value || "");
const bannerTone = computed(() => (error.value ? "error" : "success"));
const anyBusy = computed(() => busyAction.value !== null);

const pinnableSeasons = computed(
  () => scoringSeasonStatus.value?.seasons.filter((s) => s.pinnable) ?? [],
);

const seasonSelectOptions = computed(() =>
  pinnableSeasons.value.map((season) => ({
    value: String(season.blizzardSeasonId),
    label: `${formatScoringSeasonLabel(season)}${season.isBlizzardCurrent ? " (Blizzard current)" : ""}`,
  })),
);

const modeSelectOptions = [
  { value: "AUTO", label: "Auto" },
  { value: "PINNED", label: "Pinned" },
];

const pinnedWarning = computed(() => {
  const status = scoringSeasonStatus.value;
  if (!status?.pinnedDiffersFromDetected) return null;
  const pinned = status.selection.mode === "PINNED" ? status.selection.blizzardSeasonId : null;
  const detected = status.detectedCurrentSeason?.blizzardSeasonId;
  if (pinned == null || detected == null) return null;
  return `Scoring is pinned to Season ${pinned} while Blizzard currently reports Season ${detected}.`;
});

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

function applyScoringSeasonStatus(status: ScoringSeasonSelectionStatusDTO): void {
  scoringSeasonStatus.value = status;
  draftMode.value = status.selection.mode;
  draftPinnedBlizzardSeasonId.value =
    status.selection.mode === "PINNED"
      ? status.selection.blizzardSeasonId
      : (status.effectiveScoringSeason?.blizzardSeasonId ??
        status.detectedCurrentSeason?.blizzardSeasonId ??
        null);
}

async function fetchJson<T>(
  path: string,
  init?: { method?: string; body?: string; headers?: Record<string, string> },
): Promise<T> {
  const apiBase = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";
  const response = await fetch(`${apiBase}${path}`, {
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
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

async function loadScoringSeason(): Promise<void> {
  busyAction.value = "scoringSeasonLoad";
  error.value = null;
  try {
    const region = selectedRegions.value[0] ?? ADMIN_SCORING_DEFAULT_REGION;
    const status = await fetchJson<ScoringSeasonSelectionStatusDTO>(
      `/api/v1/admin/misc/scoring-season?region=${region}`,
    );
    applyScoringSeasonStatus(status);
  } catch (err) {
    if (!handleAuthError(err)) error.value = (err as Error).message;
  } finally {
    busyAction.value = null;
  }
}

async function saveScoringSeason(): Promise<void> {
  if (anyBusy.value || !scoringSeasonStatus.value) return;
  if (draftMode.value === "PINNED" && draftPinnedBlizzardSeasonId.value == null) {
    error.value = "Select a pinnable season before saving PINNED mode.";
    return;
  }
  busyAction.value = "scoringSeasonSave";
  error.value = null;
  message.value = null;
  try {
    const region = selectedRegions.value[0] ?? ADMIN_SCORING_DEFAULT_REGION;
    const body =
      draftMode.value === "AUTO"
        ? {
            mode: "AUTO" as const,
            expectedVersion: scoringSeasonStatus.value.version,
            region,
          }
        : {
            mode: "PINNED" as const,
            blizzardSeasonId: draftPinnedBlizzardSeasonId.value!,
            expectedVersion: scoringSeasonStatus.value.version,
            region,
          };
    const status = await fetchJson<ScoringSeasonSelectionStatusDTO>(
      "/api/v1/admin/misc/scoring-season",
      { method: "PUT", body: JSON.stringify(body) },
    );
    applyScoringSeasonStatus(status);
    message.value =
      status.selection.mode === "AUTO"
        ? "Scoring season set to Auto (Blizzard current)."
        : `Scoring season pinned to Blizzard ${status.selection.blizzardSeasonId}.`;
  } catch (err) {
    if (!handleAuthError(err)) error.value = (err as Error).message;
  } finally {
    busyAction.value = null;
  }
}

async function postSeasonJson(body: unknown): Promise<{ ok?: boolean; results?: SeasonSyncResultRow[] }> {
  return fetchJson("/api/v1/admin/misc/season/sync-authority", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function syncRealms(): Promise<void> {
  if (anyBusy.value || selectedRegions.value.length === 0) return;
  busyAction.value = "realms";
  error.value = null;
  message.value = null;
  realmResults.value = [];
  try {
    const body = await api.syncRealmCatalog({
      regions: selectedRegions.value,
      forceDetails: forceDetails.value,
    });
    realmResults.value = body.results;
    const totalEligible = realmResults.value.reduce((n, r) => n + r.eligible, 0);
    const totalErrors = realmResults.value.reduce((n, r) => n + r.errors.length, 0);
    message.value =
      totalErrors > 0
        ? `Realm sync finished with ${totalErrors} error(s). Eligible ${totalEligible} realm(s).`
        : `Realm catalog refreshed. Eligible ${totalEligible} realm(s).`;
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
    const body = await postSeasonJson({ regions: selectedRegions.value });
    seasonResults.value = body.results ?? [];
    const changed = seasonResults.value.filter((r) => r.changed).length;
    message.value =
      changed > 0
        ? `Season authority synced. ${changed} region(s) changed.`
        : "Season authority synced. No changes.";
    await loadScoringSeason();
  } catch (err) {
    if (!handleAuthError(err)) error.value = (err as Error).message;
  } finally {
    busyAction.value = null;
  }
}

onMounted(() => {
  void loadScoringSeason();
});
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

    <article class="tool-row" data-testid="scoring-season-tool">
      <div class="tool-row__copy">
        <h2>Scoring season</h2>
        <p class="muted">
          Controls which season the platform scores against. Distinct from Blizzard season
          authority refresh below.
        </p>
        <dl v-if="scoringSeasonStatus" class="scoring-season-grid" data-testid="scoring-season-status">
          <div>
            <dt>Detected by Blizzard</dt>
            <dd data-testid="detected-blizzard-season">
              <template v-if="scoringSeasonStatus.detectedCurrentSeason">
                {{ formatScoringSeasonLabel(scoringSeasonStatus.detectedCurrentSeason) }}
              </template>
              <template v-else>—</template>
            </dd>
          </div>
          <div class="scoring-season-controls">
            <AdminSelect
              :model-value="draftMode"
              label="Mode"
              :options="modeSelectOptions"
              :disabled="anyBusy"
              control-test-id="scoring-season-mode"
              @update:model-value="draftMode = $event === 'PINNED' ? 'PINNED' : 'AUTO'"
            />
            <AdminSelect
              :model-value="draftPinnedBlizzardSeasonId == null ? '' : String(draftPinnedBlizzardSeasonId)"
              label="Season"
              wide
              :options="seasonSelectOptions"
              :disabled="anyBusy || draftMode !== 'PINNED' || pinnableSeasons.length === 0"
              control-test-id="scoring-season-pin"
              :hint="pinnableSeasons.length === 0 ? 'No pinnable seasons with a validated M+ catalog.' : null"
              @update:model-value="draftPinnedBlizzardSeasonId = $event ? Number($event) : null"
            />
          </div>
          <div>
            <dt>Effective scoring season</dt>
            <dd data-testid="effective-scoring-season">
              <template v-if="scoringSeasonStatus.effectiveScoringSeason">
                {{ formatScoringSeasonLabel(scoringSeasonStatus.effectiveScoringSeason) }}
              </template>
              <template v-else>—</template>
            </dd>
          </div>
        </dl>
        <p
          v-if="pinnedWarning"
          class="pinned-warning"
          data-testid="scoring-season-pin-warning"
        >
          {{ pinnedWarning }}
        </p>
      </div>
      <button
        type="button"
        class="btn"
        data-testid="save-scoring-season-button"
        :disabled="anyBusy || !scoringSeasonStatus"
        @click="saveScoringSeason"
      >
        {{ busyAction === "scoringSeasonSave" ? "Saving…" : "Save" }}
      </button>
    </article>

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
          — index {{ row.indexEntries }}, eligible {{ row.eligible }}, details
          {{ row.detailsFetched }}, active {{ row.activeCatalogCount }}
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
            marker per region (no score refreshes). Does not clear a scoring-season pin.
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
.scoring-season-grid {
  display: grid;
  gap: 0.75rem;
  margin: 0;
}
.scoring-season-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: var(--space-3);
}
.scoring-season-grid dt {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}
.scoring-season-grid dd {
  margin: 0.15rem 0 0;
}
.pinned-warning {
  margin: 0;
  color: var(--color-text-muted);
  border-left: 3px solid #d4a017;
  padding-left: 0.75rem;
}
</style>
