<script setup lang="ts">
import { computed } from "vue";
import type { ScoringRunSelection } from "../../api/types";

const props = defineProps<{
  selection: ScoringRunSelection | null | undefined;
  locked?: boolean;
}>();

const filledCount = computed(
  () => props.selection?.selectedRuns.filter((run) => run.canonicalRunId).length ?? 0,
);

function formatWhen(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}
</script>

<template>
  <section aria-labelledby="selected-runs-title" data-testid="selected-runs-panel">
    <h2 id="selected-runs-title">Highest keys by dungeon</h2>
    <p class="lede">
      One canonical highest run per active-season dungeon ({{ selection?.expectedDungeonCount ?? 8 }}
      dungeons). Missing dungeons lower confidence — they are never scored as zero.
    </p>

    <p v-if="locked" class="locked">Run details are locked by entitlement.</p>
    <p v-else-if="!selection?.selectedRuns?.length" class="empty">
      No selected runs available for this character.
    </p>

    <div v-else class="runs-grid">
      <article
        v-for="run in selection.selectedRuns"
        :key="run.dungeonSlug"
        class="run-card"
        :data-missing="run.canonicalRunId ? 'false' : 'true'"
      >
        <h3>{{ run.dungeonName }}</h3>
        <template v-if="run.canonicalRunId">
          <p class="key mpts-data">
            +{{ run.keyLevel ?? "—" }}
            <span class="meta">{{ run.timed === false ? "Depleted" : run.timed ? "Timed" : "" }}</span>
          </p>
          <p class="meta">{{ formatWhen(run.completedAt) }}</p>
          <p v-if="run.coverageRatio != null" class="meta">
            WCL coverage {{ Math.round(run.coverageRatio * 100) }}%
          </p>
        </template>
        <p v-else class="missing">No logged run this season</p>
      </article>
    </div>

    <p v-if="selection" class="coverage mpts-data">
      {{ filledCount }}/{{ selection.expectedDungeonCount }}
      dungeons with a selected run
    </p>
  </section>
</template>

<style scoped>
.lede,
.empty,
.locked,
.meta,
.missing,
.coverage {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.runs-grid {
  display: grid;
  gap: var(--space-3);
  grid-template-columns: 1fr;
}

@media (min-width: 640px) {
  .runs-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (min-width: 1024px) {
  .runs-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

.run-card {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  padding: var(--space-3);
  background: var(--color-surface);
}

.run-card h3 {
  margin: 0 0 var(--space-2);
  font-size: var(--text-sm);
  font-weight: 600;
}

.run-card[data-missing="true"] {
  opacity: 0.75;
}

.key {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 700;
  color: var(--color-gold-300);
}
</style>
