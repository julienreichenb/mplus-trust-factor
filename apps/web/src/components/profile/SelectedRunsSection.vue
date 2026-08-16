<script setup lang="ts">
import { computed } from "vue";
import type { CanonicalDungeonEvidencePublicDTO } from "@mplus/contracts";
import type { ScoringRunSelection, SelectedRunSummaryDTO } from "../../api/types";
import { dungeonBackgroundUrl } from "../../lib/dungeonArt";
import { canonicalReportsForDungeon } from "../../lib/canonicalSelectedRuns";
import { sanitizeWarcraftLogsUrl } from "../../lib/warcraftLogsUrl";
import type { RunDrawerModel } from "./RunDetailsDrawer.vue";

const props = defineProps<{
  selection: ScoringRunSelection | null | undefined;
  selectedRunDetails?: SelectedRunSummaryDTO[];
  canonicalDungeonEvidence?: CanonicalDungeonEvidencePublicDTO[];
  locked?: boolean;
  /** When true, omit the section heading (parent owns the season title). */
  embedded?: boolean;
}>();

const emit = defineEmits<{
  openRun: [run: RunDrawerModel];
}>();

const detailsBySlug = computed(() => {
  const map = new Map<string, SelectedRunSummaryDTO>();
  for (const row of props.selectedRunDetails ?? []) {
    map.set(row.dungeonSlug, row);
  }
  return map;
});

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
  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function canonicalPrimary(slug: string) {
  return canonicalReportsForDungeon(props.canonicalDungeonEvidence, slug).find(
    (report) => report.identity === "PRIMARY",
  );
}

function runWclUrl(run: NonNullable<ScoringRunSelection["selectedRuns"]>[number]): string | null {
  const primary = canonicalPrimary(run.dungeonSlug);
  return sanitizeWarcraftLogsUrl(primary?.wclUrl ?? null);
}

function openRun(run: NonNullable<ScoringRunSelection["selectedRuns"]>[number]): void {
  if (!run.canonicalRunId) return;
  const primary = canonicalPrimary(run.dungeonSlug);
  const detail = detailsBySlug.value.get(run.dungeonSlug);
  const keyLevel = primary?.keyLevel ?? run.keyLevel;
  emit("openRun", {
    dungeonName: run.dungeonName,
    dungeonSlug: run.dungeonSlug,
    keyLevel,
    completedAt: primary?.completedAt ?? run.completedAt,
    identity: "PRIMARY",
    wclUrl: sanitizeWarcraftLogsUrl(primary?.wclUrl ?? detail?.wclUrl ?? null),
    cooldownTimeline: primary?.cooldownTimeline ?? null,
  });
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
    <template v-else>
      <p class="runs-hint">Click a dungeon to inspect cooldown usage</p>
      <div class="runs-grid">
      <article
        v-for="run in selection.selectedRuns"
        :key="run.dungeonSlug"
        class="run-card"
        :data-missing="run.canonicalRunId ? 'false' : 'true'"
        :tabindex="run.canonicalRunId ? 0 : undefined"
        :role="run.canonicalRunId ? 'button' : undefined"
        @click="openRun(run)"
        @keydown.enter="openRun(run)"
        @keydown.space.prevent="openRun(run)"
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
              <span class="status-chip status-chip--date">{{ formatWhen(run.completedAt) }}</span>
            </p>
            <a
              v-if="runWclUrl(run)"
              class="run-card__wcl"
              data-testid="run-card-wcl-link"
              :href="runWclUrl(run)!"
              target="_blank"
              rel="noopener noreferrer"
              @click.stop
            >Warcraft Logs ↗</a>
          </template>
          <p v-else class="missing">No logged run this season</p>
        </div>
      </article>
    </div>
    </template>
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
.runs-hint {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.runs-hint {
  font-size: var(--text-xs);
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
  cursor: pointer;
  transition:
    border-color var(--duration-fast),
    background-color var(--duration-fast),
    transform var(--duration-fast),
    box-shadow var(--duration-fast);
}

.run-card[data-missing="false"]:hover,
.run-card[data-missing="false"]:focus-visible {
  border-color: color-mix(in srgb, var(--color-gold-300) 55%, var(--color-border));
  background: var(--color-surface-hover);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgb(0 0 0 / 28%);
  outline: none;
}

.run-card[data-missing="true"] {
  cursor: default;
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

.status-chip--date {
  color: var(--color-text-muted);
  border-color: var(--color-border);
  background: transparent;
  text-transform: none;
  letter-spacing: 0;
  font-weight: 600;
}

.run-card__wcl {
  display: inline-block;
  margin-top: var(--space-2);
  color: var(--color-gold-300);
  font-size: var(--text-xs);
  text-decoration: none;
}

.run-card__wcl:hover,
.run-card__wcl:focus-visible {
  text-decoration: underline;
  outline: none;
}
</style>
