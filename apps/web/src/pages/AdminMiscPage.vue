<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import type {
  AdminRealmSyncResult,
  AdminRelevantRefreshSettingsDTO,
  RegionCode,
  ScoringSeasonSelectionStatusDTO,
} from "@mplus/contracts";
import { api } from "../api/client";
import { ApiClientError } from "../api/live-client";
import StatusBanner from "../components/common/StatusBanner.vue";
import AdminSelect from "../components/admin/AdminSelect.vue";
import { formatScoringSeasonLabel } from "../lib/scoringSeasonLabel";
import { ADMIN_SCORING_DEFAULT_REGION } from "../lib/adminScoringRegion";
import {
  formatTopPercentLabel,
  topPercentToPercentileBps,
} from "../lib/relevantPopulationPercentile";

const router = useRouter();

const REGION_OPTIONS = ["EU", "US", "KR", "TW"] as const satisfies ReadonlyArray<RegionCode>;

type RegionOption = (typeof REGION_OPTIONS)[number];
type BusyAction =
  | "realms"
  | "season"
  | "scoringSeasonLoad"
  | "scoringSeasonSave"
  | "scoringSeasonSync"
  | "relevantRefreshLoad"
  | "relevantRefreshSave"
  | "relevantDiscoveryRun"
  | "relevantDrainRun"
  | null;

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

const relevantRefresh = ref<AdminRelevantRefreshSettingsDTO | null>(null);
const draftRelevantEnabled = ref(false);
const draftParallelEnabled = ref(false);
const draftConcurrency = ref(2);
const draftCandidateTarget = ref(500);
const draftTopPercent = ref(10);
const draftDrainSeconds = ref(300);

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

const drainMinutesLabel = computed(() => {
  const seconds = draftDrainSeconds.value;
  if (!Number.isFinite(seconds)) return "—";
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds} s`;
});

const killSwitchLabel = computed(() => {
  if (!relevantRefresh.value) return null;
  return relevantRefresh.value.killSwitchActive
    ? "Infrastructure kill switch: ACTIVE — automatic relevant refresh is forced off"
    : "Infrastructure kill switch: inactive";
});

function applyRelevantRefresh(settings: AdminRelevantRefreshSettingsDTO): void {
  relevantRefresh.value = settings;
  draftRelevantEnabled.value = settings.relevantRefreshEnabled;
  draftParallelEnabled.value = settings.refreshConcurrencyEnabled;
  draftConcurrency.value = settings.concurrencyOperation;
  draftCandidateTarget.value = settings.relevantCandidateTarget;
  draftTopPercent.value = settings.relevantPopulationTopPercent;
  draftDrainSeconds.value = settings.wclPreResetDrainSeconds;
}

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

async function synchronizeSeasonData(): Promise<void> {
  if (anyBusy.value || !scoringSeasonStatus.value) return;
  busyAction.value = "scoringSeasonSync";
  error.value = null;
  message.value = null;
  try {
    const region = selectedRegions.value[0] ?? ADMIN_SCORING_DEFAULT_REGION;
    const body = await fetchJson<{
      ok: true;
      status: ScoringSeasonSelectionStatusDTO;
    }>("/api/v1/admin/misc/scoring-season/synchronize-data", {
      method: "POST",
      body: JSON.stringify({ region }),
    });
    applyScoringSeasonStatus(body.status);
    const catalogReady = body.status.seasonData?.catalogReady;
    message.value = catalogReady
      ? "Season data synchronized."
      : "Season data sync finished with incomplete catalog.";
  } catch (err) {
    if (!handleAuthError(err)) error.value = (err as Error).message;
  } finally {
    busyAction.value = null;
  }
}

async function loadRelevantRefresh(): Promise<void> {
  busyAction.value = "relevantRefreshLoad";
  error.value = null;
  try {
    const body = await fetchJson<AdminRelevantRefreshSettingsDTO>(
      "/api/v1/admin/misc/relevant-refresh",
    );
    applyRelevantRefresh(body);
  } catch (err) {
    if (!handleAuthError(err)) error.value = (err as Error).message;
  } finally {
    busyAction.value = null;
  }
}

async function saveRelevantRefresh(): Promise<void> {
  if (anyBusy.value || !relevantRefresh.value) return;
  const topPercent = Number(draftTopPercent.value);
  const bps = topPercentToPercentileBps(topPercent);
  if (!Number.isFinite(topPercent) || topPercent <= 0 || topPercent >= 100) {
    error.value = "Relevant population must be a Top % between 0 and 100 (exclusive).";
    return;
  }
  if (bps < 1 || bps > 10_000) {
    error.value = "Relevant population percentile is out of range.";
    return;
  }
  const concurrency = Number(draftConcurrency.value);
  const hardMax = relevantRefresh.value.concurrencyHardMax;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > hardMax) {
    error.value = `Concurrent character refreshes must be an integer from 1 to ${hardMax}.`;
    return;
  }
  const target = Number(draftCandidateTarget.value);
  if (!Number.isInteger(target) || target < 1 || target > 10_000) {
    error.value = "Candidates per discovery run must be an integer from 1 to 10000.";
    return;
  }
  const drain = Number(draftDrainSeconds.value);
  if (!Number.isInteger(drain) || drain < 0 || drain > 3600) {
    error.value = "Pre-reset drain window must be an integer from 0 to 3600 seconds.";
    return;
  }

  busyAction.value = "relevantRefreshSave";
  error.value = null;
  message.value = null;
  try {
    const body = await fetchJson<AdminRelevantRefreshSettingsDTO>(
      "/api/v1/admin/misc/relevant-refresh",
      {
        method: "PUT",
        body: JSON.stringify({
          relevantRefreshEnabled: draftRelevantEnabled.value,
          refreshConcurrencyEnabled: draftParallelEnabled.value,
          concurrencyOperation: concurrency,
          relevantCandidateTarget: target,
          relevantCandidatePercentileBps: bps,
          wclPreResetDrainSeconds: drain,
          expectedVersion: relevantRefresh.value.settingsVersion,
        }),
      },
    );
    applyRelevantRefresh(body);
    message.value = "Relevant character refresh settings saved.";
  } catch (err) {
    if (!handleAuthError(err)) error.value = (err as Error).message;
  } finally {
    busyAction.value = null;
  }
}

async function runRelevantDiscovery(mode: "daily_discovery" | "drain_feed"): Promise<void> {
  if (anyBusy.value) return;
  busyAction.value = mode === "drain_feed" ? "relevantDrainRun" : "relevantDiscoveryRun";
  error.value = null;
  message.value = null;
  try {
    const regionCode = selectedRegions.value[0] ?? ADMIN_SCORING_DEFAULT_REGION;
    const body = await fetchJson<{
      jobId: string;
      dedupeKey: string;
      reused: boolean;
      enqueued: boolean;
      mode: string;
      regionCode: string;
    }>("/api/v1/admin/misc/relevant-refresh/run", {
      method: "POST",
      body: JSON.stringify({ regionCode, mode }),
    });
    const status = body.reused ? "reused existing job" : body.enqueued ? "queued" : "accepted";
    message.value =
      mode === "drain_feed"
        ? `WCL drain check ${status} (${body.regionCode}) · job ${body.jobId}`
        : `Relevant discovery ${status} (${body.regionCode}) · job ${body.jobId}`;
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
  void loadRelevantRefresh();
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
              :hint="pinnableSeasons.length === 0 ? 'No seasons with a Blizzard season id.' : null"
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
        <dl
          v-if="scoringSeasonStatus?.seasonData"
          class="scoring-season-grid season-data-grid"
          data-testid="season-data-status"
        >
          <div>
            <dt>Identity</dt>
            <dd data-testid="season-data-identity">
              {{ scoringSeasonStatus.seasonData.identityReady ? "Ready" : "Missing" }}
            </dd>
          </div>
          <div>
            <dt>Dungeon catalog</dt>
            <dd data-testid="season-data-dungeons">
              {{ scoringSeasonStatus.seasonData.dungeonCount }}
              /
              {{ scoringSeasonStatus.seasonData.expectedDungeonCount ?? "—" }}
            </dd>
          </div>
          <div>
            <dt>WCL bindings</dt>
            <dd data-testid="season-data-wcl">
              {{ scoringSeasonStatus.seasonData.catalogReady ? "Ready" : "Not ready" }}
              <template v-if="scoringSeasonStatus.seasonData.wclZoneId != null">
                (zone {{ scoringSeasonStatus.seasonData.wclZoneId }})
              </template>
            </dd>
          </div>
          <div>
            <dt>Median-key distribution</dt>
            <dd data-testid="season-data-distribution">
              {{ scoringSeasonStatus.seasonData.medianKeyDistribution?.status ?? "Missing" }}
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
      <div class="tool-row__actions">
        <button
          type="button"
          class="btn"
          data-testid="save-scoring-season-button"
          :disabled="anyBusy || !scoringSeasonStatus"
          @click="saveScoringSeason"
        >
          {{ busyAction === "scoringSeasonSave" ? "Saving…" : "Save" }}
        </button>
        <button
          type="button"
          class="btn"
          data-testid="sync-season-data-button"
          :disabled="anyBusy || !scoringSeasonStatus"
          @click="synchronizeSeasonData"
        >
          {{ busyAction === "scoringSeasonSync" ? "Synchronizing…" : "Synchronize season data" }}
        </button>
      </div>
    </article>

    <article class="tool-row" data-testid="relevant-refresh-tool">
      <div class="tool-row__copy">
        <h2>Relevant character refresh</h2>
        <p class="muted">
          Operational controls for discovering and refreshing high-value Mythic+ characters.
          Settings apply at runtime through RuntimeSettings — no redeploy required.
        </p>
        <dl v-if="relevantRefresh" class="scoring-season-grid" data-testid="relevant-refresh-status">
          <div>
            <dt>Environment</dt>
            <dd data-testid="relevant-refresh-app-env">{{ relevantRefresh.appEnv }}</dd>
          </div>
          <div>
            <dt>Automatic scheduling</dt>
            <dd data-testid="relevant-refresh-scheduling">
              {{
                relevantRefresh.automaticSchedulingActive
                  ? "Active on this environment"
                  : "Disabled in local development (manual Run Now still works)"
              }}
            </dd>
          </div>
          <div>
            <dt>Kill switch</dt>
            <dd data-testid="relevant-refresh-kill-switch">{{ killSwitchLabel }}</dd>
          </div>
          <div>
            <dt>Summary</dt>
            <dd data-testid="relevant-refresh-summary">
              Automatic:
              {{ draftRelevantEnabled ? "Enabled" : "Disabled" }}
              · Parallel: {{ draftParallelEnabled ? "Enabled" : "Disabled" }}
              · Concurrency: {{ draftConcurrency }}
              · Candidates: {{ draftCandidateTarget }}
              · Population: {{ formatTopPercentLabel(topPercentToPercentileBps(Number(draftTopPercent))) }}
              · Drain: {{ drainMinutesLabel }}
            </dd>
          </div>
        </dl>

        <div v-if="relevantRefresh" class="relevant-refresh-form" data-testid="relevant-refresh-form">
          <label class="admin-checkbox">
            <input
              v-model="draftRelevantEnabled"
              type="checkbox"
              data-testid="relevant-refresh-enabled"
              :disabled="anyBusy || relevantRefresh.killSwitchActive"
            />
            <span>Automatic relevant-character refresh</span>
          </label>
          <p class="field-help">
            Automatically discovers and queues high-value Mythic+ characters on deployed
            environments. Local development never schedules automatically, even when this toggle
            is on.
          </p>

          <label class="admin-checkbox">
            <input
              v-model="draftParallelEnabled"
              type="checkbox"
              data-testid="refresh-concurrency-enabled"
              :disabled="anyBusy"
            />
            <span>Parallel character refresh</span>
          </label>

          <label class="field">
            <span>Concurrent character refreshes</span>
            <input
              v-model.number="draftConcurrency"
              type="number"
              min="1"
              :max="relevantRefresh.concurrencyHardMax"
              step="1"
              data-testid="concurrency-operation"
              :disabled="anyBusy"
            />
            <span class="field-help">Hard maximum: {{ relevantRefresh.concurrencyHardMax }}</span>
          </label>

          <label class="field">
            <span>Candidates per discovery run</span>
            <input
              v-model.number="draftCandidateTarget"
              type="number"
              min="1"
              max="10000"
              step="1"
              data-testid="relevant-candidate-target"
              :disabled="anyBusy"
            />
          </label>

          <label class="field">
            <span>Relevant population (Top %)</span>
            <input
              v-model.number="draftTopPercent"
              type="number"
              min="0.01"
              max="99.99"
              step="0.01"
              data-testid="relevant-population-top-percent"
              :disabled="anyBusy"
            />
            <span class="field-help">
              Example: 10 = Top 10% (9000 bps). Stored as
              {{ topPercentToPercentileBps(Number(draftTopPercent)) }} bps.
            </span>
          </label>

          <label class="field">
            <span>Pre-reset drain window (seconds)</span>
            <input
              v-model.number="draftDrainSeconds"
              type="number"
              min="0"
              max="3600"
              step="1"
              data-testid="wcl-pre-reset-drain-seconds"
              :disabled="anyBusy"
            />
            <span class="field-help">
              Near the Warcraft Logs hourly reset, unused API budget may be spent on useful
              background refreshes. Does not bypass WCL admission ({{ drainMinutesLabel }}).
            </span>
          </label>
        </div>
      </div>
      <div class="tool-row__actions">
        <button
          type="button"
          class="btn"
          data-testid="save-relevant-refresh-button"
          :disabled="anyBusy || !relevantRefresh"
          @click="saveRelevantRefresh"
        >
          {{ busyAction === "relevantRefreshSave" ? "Saving…" : "Save" }}
        </button>
        <button
          type="button"
          class="btn"
          data-testid="run-relevant-discovery-button"
          :disabled="anyBusy || relevantRefresh?.killSwitchActive"
          @click="runRelevantDiscovery('daily_discovery')"
        >
          {{
            busyAction === "relevantDiscoveryRun" ? "Queuing…" : "Run relevant discovery now"
          }}
        </button>
        <button
          type="button"
          class="btn"
          data-testid="run-relevant-drain-button"
          :disabled="anyBusy || relevantRefresh?.killSwitchActive"
          @click="runRelevantDiscovery('drain_feed')"
        >
          {{
            busyAction === "relevantDrainRun" ? "Queuing…" : "Run WCL drain check now"
          }}
        </button>
      </div>
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
.tool-row__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: flex-start;
}
.tool-row h2 {
  margin: 0;
  font-size: 1.05rem;
}
.relevant-refresh-form {
  display: grid;
  gap: var(--space-3);
  margin-top: var(--space-2);
}
.field {
  display: grid;
  gap: 0.35rem;
  max-width: 20rem;
}
.field input[type="number"] {
  min-height: 2.25rem;
  padding: 0.35rem 0.55rem;
  border: 1px solid rgb(255 255 255 / 18%);
  border-radius: 0.35rem;
  background: rgb(0 0 0 / 20%);
  color: inherit;
}
.field-help {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
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
