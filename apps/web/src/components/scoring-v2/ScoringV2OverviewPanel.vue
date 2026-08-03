<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import type { ScoringV2OverviewDTO } from "@mplus/contracts";
import { ApiClientError } from "../../api/live-client";
import StatusBanner from "../common/StatusBanner.vue";
import StatusChip from "../character/StatusChip.vue";

const router = useRouter();
const apiBase = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

const busy = ref(false);
const error = ref<string | null>(null);
const overview = ref<ScoringV2OverviewDTO | null>(null);

const modeTone = computed(() => {
  const label = overview.value?.flags.modeLabel;
  if (label === "Active") return "success";
  if (label === "Candidate" || label === "Shadow") return "warning";
  return "neutral";
});

async function load(): Promise<void> {
  busy.value = true;
  error.value = null;
  try {
    const response = await fetch(`${apiBase}/api/v1/admin/scoring-v2/overview`, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    const body = (await response.json().catch(() => ({}))) as ScoringV2OverviewDTO & {
      error?: { message?: string };
    };
    if (response.status === 401 || response.status === 403) {
      void router.replace(response.status === 401 ? "/auth/signin" : "/access-denied");
      throw new ApiClientError(body.error?.message ?? "Unauthorized", response.status, "UNAUTHORIZED");
    }
    if (!response.ok) {
      throw new ApiClientError(
        body.error?.message ?? `Request failed (${response.status})`,
        response.status,
        "REQUEST_FAILED",
      );
    }
    overview.value = body;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to load overview";
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  void load();
});

defineExpose({ reload: load });
</script>

<template>
  <div class="overview">
    <StatusBanner v-if="error" tone="error" :message="error" />
    <p v-if="busy && !overview" class="muted">Loading overview…</p>

    <template v-if="overview">
      <section class="panel" aria-labelledby="mode-title">
        <h2 id="mode-title">System mode</h2>
        <p>
          <span class="chip" :data-tone="modeTone">{{ overview.flags.modeLabel }}</span>
          · master {{ overview.flags.masterEnabled ? "on" : "off" }} · publication
          {{ overview.flags.publicationEnabled ? "on" : "off" }} · calibration V2
          {{ overview.flags.calibrationV2Enabled ? "on" : "off" }}
        </p>
        <p class="muted">
          Flags remain environment-controlled. This page never activates Scoring V2 or publication.
        </p>
        <ul v-if="overview.flags.incompatibleReasons.length" class="issues">
          <li v-for="reason in overview.flags.incompatibleReasons" :key="reason">{{ reason }}</li>
        </ul>
      </section>

      <section class="panel" aria-labelledby="model-title">
        <h2 id="model-title">Active model and season</h2>
        <dl class="kv">
          <dt>Model</dt>
          <dd>
            <template v-if="overview.activeModel">
              {{ overview.activeModel.key }}@{{ overview.activeModel.version }} ({{
                overview.activeModel.status
              }})
            </template>
            <span v-else class="muted">None active</span>
          </dd>
          <dt>Season</dt>
          <dd>
            <template v-if="overview.currentSeason">
              {{ overview.currentSeason.slug }} · {{ overview.currentSeason.name }}
            </template>
            <span v-else class="muted">None current</span>
          </dd>
          <dt>Revision</dt>
          <dd class="mono">{{ overview.applicationRevision ?? "—" }}</dd>
        </dl>
      </section>

      <section class="panel" aria-labelledby="queue-title">
        <h2 id="queue-title">Queue load</h2>
        <table v-if="overview.queueCounts.length">
          <thead>
            <tr>
              <th>Workload</th>
              <th>Queued</th>
              <th>Active</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in overview.queueCounts" :key="row.workloadClass">
              <td>{{ row.workloadClass }}</td>
              <td>{{ row.queued }}</td>
              <td>{{ row.active }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="muted">No queue counts.</p>
      </section>

      <section class="panel" aria-labelledby="evidence-title">
        <h2 id="evidence-title">Evidence and cohort readiness</h2>
        <dl class="kv">
          <dt>Ready cohorts</dt>
          <dd>{{ overview.cohortReadiness.readyCohorts }}</dd>
          <dt>Draft cohorts</dt>
          <dd>{{ overview.cohortReadiness.draftCohorts }}</dd>
          <dt>Last evidence export</dt>
          <dd>
            <template v-if="overview.recentEvidenceExport">
              <span class="chip">{{ overview.recentEvidenceExport.status }}</span>
              · rev {{ overview.recentEvidenceExport.cohortRevision }} ·
              {{ overview.recentEvidenceExport.createdAt }}
            </template>
            <span v-else class="muted">None yet</span>
          </dd>
          <dt>Last frozen bundle</dt>
          <dd>
            <template v-if="overview.recentFrozenBundle">
              <span class="mono">{{ overview.recentFrozenBundle.contentHash.slice(0, 12) }}…</span>
              · {{ overview.recentFrozenBundle.frozenAt }}
            </template>
            <span v-else class="muted">None yet</span>
          </dd>
        </dl>
      </section>

      <section class="panel" aria-labelledby="blockers-title">
        <h2 id="blockers-title">Blockers and warnings</h2>
        <ul v-if="overview.blockers.length" class="issues issues--blocker">
          <li v-for="issue in overview.blockers" :key="issue.code + issue.message">
            <span class="chip chip--blocker">{{ issue.code }}</span> {{ issue.message }}
          </li>
        </ul>
        <p v-else class="muted">No blockers.</p>
        <ul v-if="overview.warnings.length" class="issues">
          <li v-for="issue in overview.warnings" :key="issue.code + issue.message">
            <span class="chip chip--warning">{{ issue.code }}</span> {{ issue.message }}
          </li>
        </ul>
      </section>

      <section class="panel" aria-labelledby="conc-title">
        <h2 id="conc-title">Concurrency snapshot</h2>
        <dl class="kv">
          <dt>Calibration</dt>
          <dd>
            configured {{ overview.concurrency.calibration.configured }} · effective
            {{ overview.concurrency.calibration.effective }} · active
            {{ overview.concurrency.calibration.active }} · queued
            {{ overview.concurrency.calibration.queued }}
          </dd>
          <dt>Operation</dt>
          <dd>
            configured {{ overview.concurrency.operation.configured }} · effective
            {{ overview.concurrency.operation.effective }} · active
            {{ overview.concurrency.operation.active }} · queued
            {{ overview.concurrency.operation.queued }}
          </dd>
          <dt>Sync state</dt>
          <dd><StatusChip :status="overview.concurrency.syncState" /></dd>
        </dl>
      </section>
    </template>
  </div>
</template>

<style scoped>
.overview {
  display: grid;
  gap: 1rem;
}

.panel {
  display: grid;
  gap: 0.5rem;
  padding: 0.75rem 0;
  border-top: 1px solid color-mix(in srgb, currentColor 18%, transparent);
}

.panel h2 {
  margin: 0;
  font-size: 1.05rem;
}

.kv {
  display: grid;
  grid-template-columns: minmax(8rem, 12rem) 1fr;
  gap: 0.35rem 0.75rem;
  margin: 0;
}

.kv dt {
  opacity: 0.8;
}

.kv dd {
  margin: 0;
}

.chip {
  display: inline-block;
  padding: 0.1rem 0.45rem;
  border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
  font-size: 0.8rem;
}

.chip[data-tone="success"] {
  border-color: color-mix(in srgb, #2f6b3c 55%, currentColor);
}

.chip[data-tone="warning"] {
  border-color: color-mix(in srgb, #9a6b16 55%, currentColor);
}

.chip--blocker {
  border-color: color-mix(in srgb, #a33 50%, currentColor);
}

.chip--warning {
  border-color: color-mix(in srgb, #9a6b16 50%, currentColor);
}

.issues {
  margin: 0;
  padding-left: 1.1rem;
}

.muted {
  opacity: 0.75;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.85em;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}

th,
td {
  text-align: left;
  padding: 0.35rem 0.4rem;
  border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
}
</style>
