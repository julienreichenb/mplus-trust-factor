<script setup lang="ts">
import { computed } from "vue";
import type { DimensionScoreDTO, PerformanceSummaryDTO } from "@mplus/contracts";
import type { ScoringRunSelection } from "../../api/types";
import {
  DIMENSION_LABELS,
  filterDimensionsForModel,
  formatPercent,
  formatScore,
  formatWeight,
  type RadarDimension,
} from "../../lib/format";
import { buildDimensionExplainabilityView } from "../../lib/characterViewModel";
import DimensionAxisIcon from "../charts/DimensionAxisIcon.vue";
import MetaChip from "../common/MetaChip.vue";
import KeySignalRow from "./KeySignalRow.vue";
import PerformanceSummaryPanel from "./PerformanceSummaryPanel.vue";
import SelectedRunsSection from "./SelectedRunsSection.vue";

const props = defineProps<{
  dimensions: DimensionScoreDTO[];
  locked?: boolean;
  modelVersion?: number | null;
  performanceSummary?: PerformanceSummaryDTO | null;
  runSelection?: ScoringRunSelection | null;
  runsLocked?: boolean;
}>();

const cards = computed(() =>
  filterDimensionsForModel(props.dimensions, props.modelVersion)
    .filter((d) => d.dimension !== "AUTHENTICITY")
    .slice()
    .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
    .map((d) => {
      const dimKey = d.dimension as RadarDimension;
      const unavailable =
        d.state === "UNAVAILABLE" ||
        d.state === "PROCESSING" ||
        d.state === "ERROR" ||
        d.score == null ||
        d.confidence <= 0;
      const explain = buildDimensionExplainabilityView(d);
      const hasScoreStory =
        !unavailable &&
        (explain.strengths.length > 0 ||
          explain.weaknesses.length > 0 ||
          explain.facts.length > 0);
      const showConfidenceStory =
        explain.hasExplainability &&
        (explain.confidenceReasons.length > 0 || explain.fullConfidence);
      return {
        ...d,
        dimKey,
        label: DIMENSION_LABELS[dimKey] ?? d.dimension,
        unavailable,
        explain,
        hasScoreStory,
        showConfidenceStory,
        weightLabel: d.weight != null ? formatWeight(d.weight) : "—",
        confidenceLabel:
          unavailable || d.confidence == null ? "—" : formatPercent(d.confidence * 100, 0),
        scoreLabel: unavailable
          ? d.dimension === "EXPERIENCE"
            ? "Not available"
            : "N/A"
          : formatScore(d.score, 0),
        unavailableNote:
          d.dimension === "EXPERIENCE"
            ? "Not available — excluded from overall score; remaining weights are renormalized"
            : d.dimension === "UTILITY"
              ? "Utility combat evidence unavailable"
              : d.dimension === "SURVIVAL"
                ? "Survival combat evidence unavailable"
                : d.reason === "NO_OBSERVATIONS"
                  ? "Data unavailable"
                  : "Data unavailable",
      };
    }),
);
</script>

<template>
  <section
    class="season-perf"
    aria-labelledby="season-perf-title"
    data-testid="dimension-cards"
  >
    <h2 id="season-perf-title">Current-season performance</h2>

    <p v-if="locked" class="locked">Detailed dimension breakdown is locked by entitlement.</p>
    <div v-else class="dim-grid">
      <article
        v-for="card in cards"
        :key="card.dimension"
        class="card"
        :data-unavailable="card.unavailable ? 'true' : 'false'"
        :data-partial="card.state === 'PARTIAL' ? 'true' : 'false'"
      >
        <div class="card__head">
          <span class="card__icon" aria-hidden="true">
            <DimensionAxisIcon layout="fill" :dimension="card.dimKey" />
          </span>
          <h3 class="card__title">{{ card.label }}</h3>
          <p class="card__score mpts-data">
            <template v-if="card.unavailable">{{ card.scoreLabel }}</template>
            <template v-else>{{ card.scoreLabel }} <span>/ 100</span></template>
          </p>
        </div>

        <div
          class="card__chips"
          role="list"
          :aria-label="`${card.label} metadata`"
        >
          <MetaChip role="listitem" label="Weight" :value="card.weightLabel" />
          <MetaChip
            role="listitem"
            label="Confidence"
            :value="card.confidenceLabel"
            value-class="mpts-data"
          />
        </div>

        <template v-if="card.unavailable">
          <p class="card__empty">{{ card.unavailableNote }}</p>
          <div
            v-if="card.explain.confidenceReasons.length"
            class="card__block"
            data-testid="confidence-reasons"
          >
            <h4 class="card__subtitle">Why confidence is limited</h4>
            <ul class="card__signals" :aria-label="`${card.label} confidence reasons`">
              <KeySignalRow
                v-for="(signal, index) in card.explain.confidenceReasons"
                :key="`conf-${signal.code ?? signal.label}-${index}`"
                :signal="signal"
                hide-dimension
              />
            </ul>
          </div>
        </template>

        <template v-else>
          <div
            v-if="card.hasScoreStory"
            class="card__block"
            data-testid="score-drivers"
          >
            <h4 class="card__subtitle">What affects your score</h4>
            <div v-if="card.explain.strengths.length" class="card__group">
              <p class="card__group-label" data-kind="positive">Strengths</p>
              <ul class="card__signals" :aria-label="`${card.label} strengths`">
                <KeySignalRow
                  v-for="(signal, index) in card.explain.strengths"
                  :key="`pos-${signal.code ?? signal.label}-${index}`"
                  :signal="signal"
                  hide-dimension
                />
              </ul>
            </div>
            <div v-if="card.explain.weaknesses.length" class="card__group">
              <p class="card__group-label" data-kind="risk">Weaknesses</p>
              <ul class="card__signals" :aria-label="`${card.label} weaknesses`">
                <KeySignalRow
                  v-for="(signal, index) in card.explain.weaknesses"
                  :key="`neg-${signal.code ?? signal.label}-${index}`"
                  :signal="signal"
                  hide-dimension
                />
              </ul>
            </div>
            <div v-if="card.explain.facts.length" class="card__group">
              <p class="card__group-label" data-kind="fact">Facts / context</p>
              <ul class="card__signals" :aria-label="`${card.label} score facts`">
                <KeySignalRow
                  v-for="(signal, index) in card.explain.facts"
                  :key="`fact-${signal.code ?? signal.label}-${index}`"
                  :signal="signal"
                  hide-dimension
                />
              </ul>
            </div>
          </div>
          <p
            v-else-if="card.explain.legacyFallbackMessage"
            class="card__empty"
            data-testid="explainability-fallback"
          >
            {{ card.explain.legacyFallbackMessage }}
          </p>
          <p v-else-if="!card.explain.hasExplainability" class="card__empty">
            No key signals for this dimension
          </p>

          <div
            v-if="card.showConfidenceStory"
            class="card__block card__block--confidence"
            data-testid="confidence-reasons"
          >
            <h4 class="card__subtitle">
              Why confidence is {{ card.confidenceLabel }}
            </h4>
            <p v-if="card.explain.fullConfidence" class="card__full-conf">
              Full confidence
            </p>
            <ul
              v-else
              class="card__signals"
              :aria-label="`${card.label} confidence reasons`"
            >
              <KeySignalRow
                v-for="(signal, index) in card.explain.confidenceReasons"
                :key="`conf-${signal.code ?? signal.label}-${index}`"
                :signal="signal"
                hide-dimension
              />
            </ul>
          </div>
        </template>
      </article>
    </div>

    <SelectedRunsSection
      embedded
      :selection="runSelection"
      :locked="runsLocked"
    />

    <PerformanceSummaryPanel
      :summary="performanceSummary"
      :locked="locked"
      embedded
    />
  </section>
</template>

<style scoped>
.season-perf {
  display: grid;
  gap: var(--space-4);
}

.dim-grid {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

@media (min-width: 1100px) {
  .dim-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

.card {
  display: grid;
  gap: var(--space-2);
  align-content: start;
  min-width: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  padding: var(--space-3);
  background: var(--color-surface);
}

.card__head {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: var(--space-2);
  align-items: center;
}

.card__icon {
  display: grid;
  place-items: center;
  color: var(--color-gold-300);
}

.card__icon :deep(.dim-icon) {
  width: 1.75rem;
  height: 1.75rem;
}

.card__title {
  margin: 0;
  font-family: var(--font-data);
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-gold-300);
  overflow-wrap: anywhere;
}

.card__score {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 700;
  color: var(--color-gold-300);
  white-space: nowrap;
}

.card__score span {
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  font-weight: 500;
}

.card__chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.card__block {
  display: grid;
  gap: var(--space-2);
  padding-top: var(--space-1);
  border-top: 1px solid var(--color-border);
}

.card__block--confidence {
  border-top-style: dashed;
}

.card__subtitle {
  margin: 0;
  font-family: var(--font-data);
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.card__group {
  display: grid;
  gap: 0;
}

.card__group-label {
  margin: 0;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--color-text-muted);
}

.card__group-label[data-kind="positive"] {
  color: var(--color-success-500);
}

.card__group-label[data-kind="risk"] {
  color: var(--color-danger-500);
}

.card__group-label[data-kind="fact"] {
  color: var(--color-text-muted);
}

.card__signals {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0;
}

.card__empty,
.card__full-conf {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}

.card__full-conf {
  font-weight: 600;
}

.card[data-unavailable="true"] .card__score {
  color: var(--color-text-muted);
  font-weight: 600;
}

.locked {
  margin: 0;
  color: var(--color-text-muted);
}
</style>
