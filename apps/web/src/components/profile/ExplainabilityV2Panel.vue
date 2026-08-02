<script setup lang="ts">
import { computed } from "vue";
import type { ScoreExplainabilityV2PublicDTO } from "@mplus/contracts";
import { formatPercent, formatScore } from "../../lib/format";
import MetaChip from "../common/MetaChip.vue";

const props = defineProps<{
  explainability: ScoreExplainabilityV2PublicDTO | null | undefined;
  locked?: boolean;
}>();

const visible = computed(() => Boolean(props.explainability));
const coverage = computed(() => props.explainability?.coverage ?? null);
const stateLabel = computed(() => {
  const c = coverage.value;
  if (!c) return null;
  if (c.unavailable) return "Unavailable";
  if (c.provisional) return "Provisional";
  if (c.stale) return "Stale";
  return c.publicationState === "PUBLISHED" ? "Published" : c.publicationState;
});

function availabilityLabel(state: string): string {
  if (state === "PARTIAL") return "partial coverage";
  if (state === "UNAVAILABLE") return "unavailable (not scored)";
  return "available";
}

function limitationLabel(code: string): string {
  switch (code) {
    case "partial_coverage":
      return "Partial coverage";
    case "insufficient_evidence":
      return "Insufficient evidence";
    case "dimension_unavailable":
      return "Dimension unavailable";
    case "provisional_sample":
      return "Provisional sample";
    default:
      return code;
  }
}
</script>

<template>
  <section
    v-if="visible && explainability"
    class="explain-v2"
    aria-labelledby="explain-v2-title"
    data-testid="explainability-v2"
  >
    <h2 id="explain-v2-title">Evidence &amp; confidence</h2>
    <p class="lead">
      How this Trust Score was supported by selected runs. Grade U means unavailable or unranked, not
      a low score.
    </p>

    <p v-if="locked" class="locked">Detailed evidence breakdown is locked by entitlement.</p>
    <template v-else>
      <div class="chips" role="list" aria-label="Evidence coverage">
        <MetaChip
          role="listitem"
          label="Analyzed runs"
          :value="`${coverage?.analyzedRunCount ?? 0} / ${coverage?.expectedRunCount ?? 0}`"
          value-class="mpts-data"
        />
        <MetaChip
          role="listitem"
          label="Dungeons"
          :value="`${coverage?.representedDungeonCount ?? 0} / ${coverage?.expectedDungeonCount ?? 0}`"
          value-class="mpts-data"
        />
        <MetaChip role="listitem" label="State" :value="stateLabel ?? '—'" />
        <MetaChip
          v-if="explainability.dataAsOf"
          role="listitem"
          label="Data as of"
          :value="explainability.dataAsOf"
          value-class="mpts-data"
        />
      </div>

      <ul class="notes" aria-label="Evidence notes">
        <li v-for="(note, idx) in explainability.notes" :key="idx">{{ note }}</li>
      </ul>

      <div class="dims">
        <article
          v-for="dim in explainability.dimensions"
          :key="dim.dimension"
          class="dim"
          :data-grade-u="dim.gradeU ? 'true' : 'false'"
          :data-availability="dim.availabilityState"
        >
          <header>
            <h3>{{ dim.dimension }}</h3>
            <p class="score mpts-data">
              <template v-if="dim.gradeU">U</template>
              <template v-else>{{ formatScore(dim.score, 0) }} / 100</template>
            </p>
          </header>
          <p class="meta">
            Confidence
            <template v-if="dim.availabilityState === 'UNAVAILABLE'">n/a</template>
            <template v-else>{{ formatPercent(dim.confidence * 100, 0) }}</template>
            · {{ availabilityLabel(dim.availabilityState) }}
          </p>
          <ul v-if="dim.limitations.length" class="limits" aria-label="Limitations">
            <li v-for="code in dim.limitations" :key="code">{{ limitationLabel(code) }}</li>
          </ul>
          <p v-if="dim.utilitySemantics" class="utility" data-testid="utility-semantics">
            Utility uses observed combat contribution
            <span v-if="dim.utilitySemantics.notes[0]">— {{ dim.utilitySemantics.notes[0] }}</span>
          </p>
          <ul v-if="dim.topContributors.length" class="contrib">
            <li v-for="c in dim.topContributors" :key="c.key">
              {{ c.label }}
              <span v-if="c.score != null && !dim.gradeU" class="mpts-data">{{
                formatScore(c.score, 0)
              }}</span>
            </li>
          </ul>
        </article>
      </div>

      <section v-if="explainability.selectedRuns.length" aria-labelledby="selected-keys-title">
        <h3 id="selected-keys-title">Selected key levels</h3>
        <ul class="runs">
          <li
            v-for="run in explainability.selectedRuns"
            :key="`${run.dungeonSlug}:${run.slotIndex}`"
            data-testid="explainability-v2-run"
          >
            {{ run.dungeonSlug }} · slot {{ run.slotIndex }} ·
            <span class="mpts-data">+{{ run.keyLevel ?? "—" }}</span>
            <span v-if="run.hasWclSource"> · log source</span>
          </li>
        </ul>
      </section>
    </template>
  </section>
</template>

<style scoped>
.explain-v2 {
  display: grid;
  gap: var(--space-3, 0.75rem);
}

.lead,
.locked,
.meta,
.utility {
  margin: 0;
  opacity: 0.9;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.notes,
.runs,
.contrib,
.limits {
  margin: 0;
  padding-left: 1.1rem;
}

.dims {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
}

.dim {
  display: grid;
  gap: 0.35rem;
}

.dim header {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  align-items: baseline;
}

.dim h3,
.score {
  margin: 0;
}

.dim[data-grade-u="true"] .score {
  letter-spacing: 0.04em;
}

@media (max-width: 700px) {
  .dims {
    grid-template-columns: 1fr;
  }
}
</style>
