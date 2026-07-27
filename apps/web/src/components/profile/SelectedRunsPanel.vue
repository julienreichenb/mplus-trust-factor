<script setup lang="ts">
import { ref } from "vue";
import type { SelectedRunView } from "../../api/types";
import {
  formatNullableMetric,
  formatRunTimed,
} from "../../lib/selectedRunsViewModel";

defineProps<{
  runs: SelectedRunView[];
  coverageLabel: string;
  expectedCount: number;
  locked?: boolean;
}>();

const openId = ref<string | null>(null);

function toggle(id: string): void {
  openId.value = openId.value === id ? null : id;
}
</script>

<template>
  <section aria-labelledby="selected-runs-title" data-testid="selected-runs">
    <header class="head">
      <h2 id="selected-runs-title">Highest keys</h2>
      <p class="coverage mpts-data">{{ coverageLabel }}</p>
    </header>
    <p class="lede">
      One selected run per active-season dungeon (target {{ expectedCount }}). Expand a row for
      evidence — missing WCL matches stay unavailable, never zero.
    </p>

    <p v-if="locked" class="locked">Run details are locked by entitlement.</p>
    <p v-else-if="!runs.length" class="empty" data-testid="selected-runs-empty">
      No selected runs available for this character.
    </p>

    <div v-else class="table-wrap">
      <table class="desktop-table">
        <caption class="sr-only">Selected highest-key runs</caption>
        <thead>
          <tr>
            <th scope="col">Dungeon</th>
            <th scope="col">Key</th>
            <th scope="col">Result</th>
            <th scope="col">Parse</th>
            <th scope="col">WCL</th>
            <th scope="col">Evidence</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="run in runs" :key="run.runId">
            <tr>
              <th scope="row">{{ run.dungeonName }}</th>
              <td class="mpts-data">{{ run.keyLevel > 0 ? `+${run.keyLevel}` : "—" }}</td>
              <td>{{ formatRunTimed(run.timed) }}</td>
              <td class="mpts-data">{{ formatNullableMetric(run.parsePercentile, "percent") }}</td>
              <td>{{ run.wclReportMatched ? "Matched" : "Missing" }}</td>
              <td>
                <button type="button" class="btn link" @click="toggle(run.runId)">
                  {{ openId === run.runId ? "Hide" : "Show" }}
                </button>
              </td>
            </tr>
            <tr v-if="openId === run.runId" class="evidence-row">
              <td colspan="6">
                <p>{{ run.evidenceSummary || "No evidence summary." }}</p>
                <dl>
                  <div>
                    <dt>Selection</dt>
                    <dd class="mpts-data">{{ run.selectionReason }}</dd>
                  </div>
                  <div>
                    <dt>Key difficulty</dt>
                    <dd class="mpts-data">
                      {{ formatNullableMetric(run.keyDifficultyPercentile, "percent") }}
                    </dd>
                  </div>
                  <div>
                    <dt>Coverage</dt>
                    <dd class="mpts-data">
                      {{ formatNullableMetric(run.wclCoverageRatio, "percent") }}
                    </dd>
                  </div>
                  <div>
                    <dt>RIO score</dt>
                    <dd class="mpts-data">{{ formatNullableMetric(run.raiderIoScore) }}</dd>
                  </div>
                </dl>
                <p v-if="run.missingMetrics.length" class="missing">
                  Missing: {{ run.missingMetrics.map((m) => m.replaceAll("_", " ")).join(", ") }}
                </p>
              </td>
            </tr>
          </template>
        </tbody>
      </table>

      <ul class="mobile-cards" aria-label="Selected runs">
        <li v-for="run in runs" :key="`m-${run.runId}`">
          <button type="button" class="card" @click="toggle(run.runId)">
            <span class="card__top">
              <strong>{{ run.dungeonName }}</strong>
              <span class="mpts-data">{{ run.keyLevel > 0 ? `+${run.keyLevel}` : "—" }}</span>
            </span>
            <span class="card__meta">
              {{ formatRunTimed(run.timed) }} · Parse
              {{ formatNullableMetric(run.parsePercentile, "percent") }} ·
              {{ run.wclReportMatched ? "WCL matched" : "WCL missing" }}
            </span>
          </button>
          <div v-if="openId === run.runId" class="card__evidence">
            <p>{{ run.evidenceSummary || "No evidence summary." }}</p>
            <p v-if="run.missingMetrics.length" class="missing">
              Missing: {{ run.missingMetrics.map((m) => m.replaceAll("_", " ")).join(", ") }}
            </p>
          </div>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: baseline;
  justify-content: space-between;
}

.head h2 {
  margin: 0;
}

.coverage {
  color: var(--color-gold-300);
  font-size: var(--text-sm);
}

.lede,
.locked,
.empty {
  color: var(--color-text-muted);
  max-width: 60ch;
}

.table-wrap {
  overflow-x: auto;
}

.desktop-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
  display: none;
}

.desktop-table th,
.desktop-table td {
  text-align: left;
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--color-border);
  vertical-align: top;
}

.evidence-row td {
  background: var(--color-obsidian-900);
  color: var(--color-text-muted);
}

.evidence-row dl {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
  gap: var(--space-3);
  margin: var(--space-3) 0 0;
}

.evidence-row dt {
  font-size: var(--text-xs);
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.evidence-row dd {
  margin: var(--space-1) 0 0;
  font-weight: 600;
  color: var(--color-text);
}

.missing {
  color: var(--color-info-500);
  font-size: var(--text-sm);
}

.mobile-cards {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-3);
}

.card {
  width: 100%;
  text-align: left;
  display: grid;
  gap: var(--space-2);
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-surface);
  color: inherit;
  cursor: pointer;
}

.card__top {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
}

.card__meta {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.card__evidence {
  padding: 0 var(--space-4) var(--space-4);
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

@media (min-width: 900px) {
  .desktop-table {
    display: table;
  }

  .mobile-cards {
    display: none;
  }
}
</style>
