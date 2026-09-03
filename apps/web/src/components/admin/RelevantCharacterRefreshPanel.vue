<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import type { AdminRelevantRefreshSettingsDTO, RegionCode } from "@mplus/contracts";
import { ApiClientError } from "../../api/live-client";
import StatusBanner from "../common/StatusBanner.vue";
import { formatTopPercentLabel, topPercentToPercentileBps } from "../../lib/relevantPopulationPercentile";
import { ADMIN_SCORING_DEFAULT_REGION } from "../../lib/adminScoringRegion";

const router = useRouter();

const REGION_OPTIONS = ["EU", "US", "KR", "TW"] as const satisfies ReadonlyArray<RegionCode>;
type RegionOption = (typeof REGION_OPTIONS)[number];

type BusyAction = "relevantRefreshLoad" | "relevantRefreshSave" | "relevantDiscoveryRun" | "relevantDrainRun" | null;

const selectedRegions = ref<RegionOption[]>([ADMIN_SCORING_DEFAULT_REGION]);
const busyAction = ref<BusyAction>(null);
const error = ref<string | null>(null);
const message = ref<string | null>(null);

const anyBusy = computed(() => busyAction.value !== null);
const bannerText = computed(() => error.value || message.value || "");
const bannerTone = computed(() => (error.value ? "error" : "success"));

const relevantRefresh = ref<AdminRelevantRefreshSettingsDTO | null>(null);

const draftRelevantEnabled = ref(false);
const draftParallelEnabled = ref(false);
const draftConcurrency = ref(2);
const draftCandidateTarget = ref(500);
const draftTopPercent = ref(10);
const draftDrainSeconds = ref(300);

const killSwitchLabel = computed(() => {
  if (!relevantRefresh.value) return null;
  return relevantRefresh.value.killSwitchActive
    ? "Infrastructure kill switch: ACTIVE — automatic relevant refresh is forced off"
    : "Infrastructure kill switch: inactive";
});

const drainMinutesLabel = computed(() => {
  const seconds = draftDrainSeconds.value;
  if (!Number.isFinite(seconds)) return "—";
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds} s`;
});

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
    method: init?.method,
    body: init?.body,
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

async function loadRelevantRefresh(): Promise<void> {
  busyAction.value = "relevantRefreshLoad";
  error.value = null;
  try {
    const body = await fetchJson<AdminRelevantRefreshSettingsDTO>("/api/v1/admin/misc/relevant-refresh");
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
    const body = await fetchJson<AdminRelevantRefreshSettingsDTO>("/api/v1/admin/misc/relevant-refresh", {
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
    });

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
      trigger: string;
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

onMounted(() => {
  void loadRelevantRefresh();
});
</script>

<template>
  <section class="relevant-refresh-panel" data-testid="relevant-refresh-panel">
    <StatusBanner v-if="bannerText" :tone="bannerTone" :message="bannerText" />

    <fieldset class="regions" :disabled="anyBusy">
      <legend>Regions (shared)</legend>
      <label v-for="region in REGION_OPTIONS" :key="region" class="admin-checkbox">
        <input type="checkbox" :checked="selectedRegions.includes(region)" @change="toggleRegion(region)" />
        <span>{{ region }}</span>
      </label>
    </fieldset>

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
            <dd data-testid="relevant-refresh-app-env">
              <span class="chip chip--neutral">{{ relevantRefresh.appEnv }}</span>
            </dd>
          </div>
          <div>
            <dt>Automatic scheduling</dt>
            <dd data-testid="relevant-refresh-scheduling">
              <span class="chip" :class="relevantRefresh.automaticSchedulingActive ? 'chip--success' : 'chip--neutral'">
                {{ relevantRefresh.automaticSchedulingActive ? "Enabled" : "Disabled" }}
              </span>
              <span class="chip-help">
                {{
                  relevantRefresh.automaticSchedulingActive
                    ? "Active on this environment"
                    : "Disabled in local development (manual Run Now still works)"
                }}
              </span>
            </dd>
          </div>
          <div>
            <dt>Kill switch</dt>
            <dd data-testid="relevant-refresh-kill-switch">
              <span class="chip" :class="relevantRefresh.killSwitchActive ? 'chip--danger' : 'chip--neutral'">
                {{ relevantRefresh.killSwitchActive ? "ACTIVE" : "inactive" }}
              </span>
              <span v-if="killSwitchLabel" class="chip-help">{{ killSwitchLabel }}</span>
            </dd>
          </div>
          <div>
            <dt>Summary</dt>
            <dd data-testid="relevant-refresh-summary" class="relevant-summary">
              <span class="chip chip--neutral">Automatic: {{ draftRelevantEnabled ? "Enabled" : "Disabled" }}</span>
              <span class="chip chip--neutral">Parallel: {{ draftParallelEnabled ? "Enabled" : "Disabled" }}</span>
              <span class="chip chip--neutral">Concurrency: {{ draftConcurrency }}</span>
              <span class="chip chip--neutral">Candidates: {{ draftCandidateTarget }}</span>
              <span class="chip chip--neutral">
                Population: {{ formatTopPercentLabel(topPercentToPercentileBps(Number(draftTopPercent))) }}
              </span>
              <span class="chip chip--neutral">Drain: {{ drainMinutesLabel }}</span>
            </dd>
          </div>
        </dl>

        <div v-if="relevantRefresh" class="relevant-refresh-form" data-testid="relevant-refresh-form">
          <label class="admin-checkbox override">
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

          <label class="admin-checkbox override">
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
  </section>
</template>

<style scoped>
.relevant-refresh-panel {
  display: grid;
  gap: var(--space-4);
}

.muted {
  color: var(--color-text-muted);
  margin: 0;
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

.tool-row {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-4) 0;
  border: 0;
  border-bottom: 1px solid rgb(255 255 255 / 14%);
  background: transparent;
  border-radius: 0;
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

.scoring-season-grid {
  display: grid;
  gap: 0.75rem;
  margin: 0;
  grid-template-columns: 1fr;
}

@media (min-width: 900px) {
  .scoring-season-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.scoring-season-grid dt {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.scoring-season-grid dd {
  margin: 0.15rem 0 0;
}

.chip {
  display: inline-flex;
  align-items: center;
  padding: 0.15rem 0.5rem;
  border-radius: var(--radius-pill, 999px);
  border: 1px solid var(--color-border);
  font-size: var(--text-xs);
  font-family: var(--font-data);
  color: var(--color-text-muted);
  white-space: nowrap;
}

.chip--neutral {
  color: var(--color-text-muted);
  background: rgb(255 255 255 / 6%);
}

.chip--success {
  color: var(--color-success-500);
  background: rgb(34 197 94 / 10%);
  border-color: rgb(34 197 94 / 35%);
}

.chip--danger {
  color: var(--color-danger-500);
  background: rgb(239 68 68 / 10%);
  border-color: rgb(239 68 68 / 35%);
}

.chip-help {
  display: block;
  margin-top: 0.25rem;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  white-space: normal;
}

.relevant-summary {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.relevant-refresh-form {
  display: grid;
  gap: var(--space-3);
  grid-template-columns: 1fr;
}

@media (min-width: 900px) {
  .relevant-refresh-form {
    grid-template-columns: 1fr 1fr;
  }
  .relevant-refresh-form > .field-help {
    grid-column: 1 / -1;
  }
}

.field {
  display: grid;
  gap: 0.35rem;
  max-width: none;
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

.admin-checkbox.override {
  display: flex;
  align-items: center;
  gap: 0.5rem;
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
</style>

