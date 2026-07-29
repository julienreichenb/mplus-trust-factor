<script setup lang="ts">
import { computed } from "vue";
import type { ScoringRunSelection } from "../../api/types";
import { dungeonBackgroundUrl } from "../../lib/dungeonArt";

const props = defineProps<{
  selection: ScoringRunSelection | null | undefined;
  locked?: boolean;
  /** When true, omit the section heading (parent owns the season title). */
  embedded?: boolean;
}>();

const filledCount = computed(
  () => props.selection?.selectedRuns.filter((run) => run.canonicalRunId).length ?? 0,
);

const artBySlug = computed(() => {
  const map = new Map<string, string>();
  for (const run of props.selection?.selectedRuns ?? []) {
    const url = dungeonBackgroundUrl(run.dungeonSlug);
    if (url) map.set(run.dungeonSlug, url);
  }
  return map;
});

function formatWhen(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

function artStyle(slug: string): Record<string, string> | undefined {
  const url = artBySlug.value.get(slug);
  // CSS var so ::before can paint + zoom past transparent EJ button chrome
  return url ? { "--run-art": `url("${url}")` } : undefined;
}
</script>

<template>
  <section
    class="selected-runs"
    :class="{ 'selected-runs--embedded': embedded }"
    :aria-labelledby="embedded ? undefined : 'selected-runs-title'"
    :aria-label="embedded ? 'Highest keys by dungeon' : undefined"
    data-testid="selected-runs-panel"
  >
    <template v-if="!embedded">
      <h2 id="selected-runs-title">Highest keys by dungeon</h2>
    </template>

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
        <div
          class="run-card__art"
          :class="{ 'run-card__art--empty': !artBySlug.get(run.dungeonSlug) }"
          :style="artStyle(run.dungeonSlug)"
          role="img"
          :aria-label="`${run.dungeonName} illustration`"
        />
        <div class="run-card__body">
          <h3>{{ run.dungeonName }}</h3>
          <template v-if="run.canonicalRunId">
            <p class="key mpts-data">
              +{{ run.keyLevel ?? "—" }}
              <span
                v-if="run.timed === true"
                class="status-chip status-chip--timed"
              >Timed</span>
              <span
                v-else-if="run.timed === false"
                class="status-chip status-chip--depleted"
              >Depleted</span>
            </p>
            <p class="meta">{{ formatWhen(run.completedAt) }}</p>
            <p v-if="run.coverageRatio != null" class="meta">
              WCL coverage {{ Math.round(run.coverageRatio * 100) }}%
            </p>
          </template>
          <p v-else class="missing">No logged run this season</p>
        </div>
      </article>
    </div>

    <p v-if="selection && !locked" class="coverage mpts-data">
      {{ filledCount }}/{{ selection.expectedDungeonCount }}
      dungeons with a selected run
    </p>
  </section>
</template>

<style scoped>
.selected-runs {
  display: grid;
  gap: var(--space-3);
}

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
  display: flex;
  flex-direction: row;
  align-items: stretch;
  min-width: 0;
  isolation: isolate;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  overflow: hidden;
  background: #171719;
}

/*
 * Blizzard journal-instance zone tiles (render.worldofwarcraft.com).
 * Real photos — plain cover fills the rail without chrome crop/zoom.
 */
.run-card__art {
  position: relative;
  flex: 0 0 5.5rem;
  width: 5.5rem;
  max-width: 5.5rem;
  align-self: stretch;
  min-height: 5.5rem;
  overflow: hidden;
  background-color: #0e0e10;
}

.run-card__art:not(.run-card__art--empty)::before {
  content: "";
  position: absolute;
  inset: 0;
  background-image: var(--run-art);
  background-repeat: no-repeat;
  background-position: center;
  background-size: cover;
}

.run-card__art--empty {
  background-color: rgb(255 255 255 / 4%);
}

.run-card__body {
  position: relative;
  z-index: 1;
  flex: 1 1 auto;
  min-width: 0;
  padding: var(--space-3);
  background: #171719;
}

.run-card h3 {
  margin: 0 0 var(--space-2);
  font-size: var(--text-sm);
  font-weight: 600;
  overflow-wrap: anywhere;
}

.run-card[data-missing="true"] {
  opacity: 0.75;
}

.key {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 700;
  color: var(--color-gold-300);
}

.status-chip {
  display: inline-flex;
  align-items: center;
  padding: 0.2rem 0.55rem;
  border: 1px solid transparent;
  border-radius: var(--radius-control);
  font-family: var(--font-data);
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  line-height: 1.2;
}

.status-chip--timed {
  color: var(--color-success-500);
  border-color: color-mix(in srgb, var(--color-success-500) 45%, transparent);
  background: color-mix(in srgb, var(--color-success-500) 14%, transparent);
}

.status-chip--depleted {
  color: var(--color-danger-500);
  border-color: color-mix(in srgb, var(--color-danger-500) 45%, transparent);
  background: color-mix(in srgb, var(--color-danger-500) 14%, transparent);
}
</style>
