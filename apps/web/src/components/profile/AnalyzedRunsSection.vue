<script setup lang="ts">
import type { AnalyzedRunSummary } from "../../api/types";

defineProps<{
  last: AnalyzedRunSummary | null;
  highest: AnalyzedRunSummary | null;
  locked?: boolean;
}>();
</script>

<template>
  <section aria-labelledby="runs-title">
    <h2 id="runs-title">Analyzed runs</h2>
    <p v-if="locked" class="locked">Run details are locked by entitlement.</p>
    <template v-else>
      <p v-if="!last && !highest" class="empty">No detailed runs available for this character.</p>
      <div v-else class="runs">
        <article v-if="last" class="run">
          <h3>
            {{ last.kind === "BOTH" ? "Latest & highest (same run)" : "Latest analyzed" }}
          </h3>
          <p>
            <strong>+{{ last.keyLevel }}</strong> {{ last.dungeonName }} ·
            {{ new Date(last.completedAt).toLocaleString() }}
            · {{ last.timed ? "Timed" : "Depleted" }}
          </p>
          <p>{{ last.performanceSummary }}</p>
          <p class="meta">Coverage {{ Math.round(last.coverageRatio * 100) }}%</p>
        </article>
        <article v-if="highest && highest.kind !== 'BOTH' && highest.runId !== last?.runId" class="run">
          <h3>Highest analyzed</h3>
          <p>
            <strong>+{{ highest.keyLevel }}</strong> {{ highest.dungeonName }} ·
            {{ new Date(highest.completedAt).toLocaleString() }}
            · {{ highest.timed ? "Timed" : "Depleted" }}
          </p>
          <p>{{ highest.performanceSummary }}</p>
          <p class="meta">Coverage {{ Math.round(highest.coverageRatio * 100) }}%</p>
        </article>
      </div>
    </template>
  </section>
</template>

<style scoped>
.runs {
  display: grid;
  gap: 0.75rem;
}

.run {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.85rem;
  background: var(--panel);
}

.run h3 {
  margin: 0 0 0.35rem;
}

.meta,
.empty,
.locked {
  color: var(--muted);
}
</style>
