<script setup lang="ts">
import { computed } from "vue";
import type {
  BoostAssessmentPublicDTO,
  BoostAssessmentSignalDTO,
  BoostCoverageDungeonDTO,
  BoostRunEvidencePublicDTO,
} from "@mplus/contracts";
import { formatScore } from "../../lib/format";
import {
  boostSignalLabel,
  signalExplanation as explainSignal,
  signalIndicatorSentences,
} from "../../lib/boostSuspicionPresentation";

const props = defineProps<{
  assessment: BoostAssessmentPublicDTO | null | undefined;
  locked?: boolean;
}>();

const applicability = computed(() => props.assessment?.applicability.status ?? null);
const status = computed(() => props.assessment?.status ?? null);
const band = computed(() => props.assessment?.suspicionBand ?? null);

const coverage = computed(() => props.assessment?.coverage ?? null);

const showScore = computed(() => {
  if (!props.assessment) return false;
  if (applicability.value !== "APPLICABLE") return false;
  return status.value === "AVAILABLE" || status.value === "PARTIAL";
});

const visualTone = computed(() => {
  if (applicability.value === "SUBJECT_NOT_EXCEPTIONAL_KEY_LEVEL") return "muted";
  if (applicability.value === "INSUFFICIENT_CONTEXT" || status.value === "INSUFFICIENT_DATA") {
    return "muted";
  }
  if (band.value === "HIGH") return "high";
  if (band.value === "ELEVATED") return "elevated";
  if (band.value === "LOW") return "low";
  return "muted";
});

const orderedSignals = computed(() => {
  const list = [...(props.assessment?.signals ?? [])];
  return list
    .filter((s) => s.status === "COMPUTED")
    .sort((a, b) => a.displayOrder - b.displayOrder);
});

const indicatorSentences = computed(() => {
  const expected = coverage.value?.expectedTopRuns ?? null;
  const out: string[] = [];
  for (const signal of orderedSignals.value) {
    out.push(...signalIndicatorSentences(signal, expected, "section"));
  }
  return out;
});

const summaryIndicators = computed(() => indicatorSentences.value.slice(0, 2));
const remainingIndicators = computed(() => indicatorSentences.value.slice(2));

function dungeonLabel(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function signalLabel(code: string): string {
  return boostSignalLabel(code);
}

function signalExplanation(signal: BoostAssessmentSignalDTO): string | null {
  return explainSignal(signal, coverage.value?.expectedTopRuns ?? null, "section");
}

function coverageRowNote(row: BoostCoverageDungeonDTO): string {
  return row.analysable ? "available" : "unavailable";
}

const primaryRuns = computed(() =>
  (props.assessment?.runEvidence ?? []).filter((row) => row.slot === "PRIMARY" && row.classification !== "UNAVAILABLE"),
);

function gapLabel(row: BoostRunEvidencePublicDTO): string {
  if (row.performanceDelta == null) return "—";
  return String(row.performanceDelta);
}
</script>

<template>
  <section
    aria-labelledby="boost-suspicion-title"
    class="boost-card"
    :class="`boost-card--${visualTone}`"
    data-testid="boost-suspicion-section"
    :data-boost-tone="visualTone"
  >
    <div class="boost-card__head">
      <h2 id="boost-suspicion-title">Boost suspicion</h2>
      <p v-if="locked" class="locked">Boost suspicion details are locked by entitlement.</p>
      <template v-else-if="!assessment">
        <p class="note">No boost suspicion assessment has been recorded for this character yet.</p>
      </template>
      <template v-else-if="applicability === 'SUBJECT_NOT_EXCEPTIONAL_KEY_LEVEL'">
        <p class="band" data-testid="boost-suspicion-band">Not applicable</p>
        <p class="note" data-testid="boost-applicability-copy">
          Boost assessment is not applicable at this key-level context. The detector is designed for
          exceptional high-key environments. This character's current season sample does not meet that
          applicability threshold.
        </p>
      </template>
      <template v-else-if="applicability === 'INSUFFICIENT_CONTEXT' || status === 'INSUFFICIENT_DATA'">
        <p class="band" data-testid="boost-suspicion-band">Insufficient data</p>
        <p class="note" data-testid="boost-insufficient-copy">
          Insufficient public evidence for a Boost assessment.
        </p>
      </template>
      <template v-else>
        <p class="boost-card__meta">
          <span v-if="showScore && band" class="band" data-testid="boost-suspicion-band">{{ band }}</span>
          <span v-if="showScore" class="score">
            <strong data-testid="boost-suspicion-score">{{ formatScore(assessment.suspicionScore, 0) }}</strong>
            / 100
          </span>
        </p>
      </template>
    </div>

    <template v-if="!locked && assessment && applicability === 'APPLICABLE' && status !== 'INSUFFICIENT_DATA'">
      <p v-if="coverage" class="note" data-testid="boost-coverage-summary">
        {{ coverage.analyzableTopRuns }} / {{ coverage.expectedTopRuns }} highest runs analysed
      </p>
      <p v-if="status === 'PARTIAL'" class="note" data-testid="boost-partial-copy">
        Public evidence is incomplete. This is not a low-suspicion result.
      </p>
      <ul v-if="summaryIndicators.length" class="summary-facts">
        <li v-for="line in summaryIndicators" :key="line">{{ line }}</li>
      </ul>

      <details class="fold" data-testid="boost-evidence-disclosure">
        <summary>View evidence</summary>
        <p v-if="assessment.confidence != null" class="note" data-testid="boost-evidence-confidence">
          Evidence confidence
          <strong>{{ Math.round(assessment.confidence * 100) }}%</strong>
        </p>
        <ul v-if="remainingIndicators.length" class="summary-facts">
          <li v-for="line in remainingIndicators" :key="line">{{ line }}</li>
        </ul>
        <div v-if="orderedSignals.length" class="signals">
          <ol>
            <li
              v-for="signal in orderedSignals"
              :key="signal.code"
              class="signal"
              :data-testid="`boost-signal-${signal.code}`"
            >
              <p class="signal-title">{{ signalLabel(signal.code) }}</p>
              <p v-if="signalExplanation(signal)" class="signal-copy">{{ signalExplanation(signal) }}</p>
              <p v-else class="signal-copy muted">Not available for this sample.</p>
            </li>
          </ol>
        </div>

        <div v-if="coverage" data-testid="boost-coverage-details">
          <p class="fold-label">Evidence coverage</p>
          <ul>
            <li v-for="row in coverage.dungeons" :key="row.dungeonSlug" :data-testid="`boost-coverage-${row.dungeonSlug}`">
              <strong>{{ dungeonLabel(row.dungeonSlug) }}</strong>
              <span v-if="row.blizzardBestKeyLevel != null">Highest timed: +{{ row.blizzardBestKeyLevel }}</span>
              <span>
                Public behavioural evidence:
                {{ coverageRowNote(row) }}
              </span>
              <span v-if="!row.analysable && row.publicAnalysableBestKeyLevel != null">
                Best public canonical evidence: +{{ row.publicAnalysableBestKeyLevel }}
              </span>
            </li>
          </ul>
        </div>

        <div
          v-if="primaryRuns.length"
          data-testid="boost-run-evidence"
        >
          <p class="fold-label">Peer performance evidence</p>
          <ul>
            <li v-for="row in primaryRuns" :key="`${row.dungeonSlug}-${row.slot}`" class="run">
              <p>
                <strong>{{ dungeonLabel(row.dungeonSlug) }}</strong>
                <span v-if="row.keyLevel != null"> +{{ row.keyLevel }}</span>
                <span class="slot">PRIMARY</span>
              </p>
              <p class="note">
                Your Key %: {{ row.subjectKeyPercent ?? "—" }} · Peer median:
                {{ row.peerMedianKeyPercent ?? "—" }} · Gap: {{ gapLabel(row) }}
              </p>
              <p v-if="row.reportUrl">
                <a :href="row.reportUrl" target="_blank" rel="noreferrer">View Warcraft Logs</a>
              </p>
            </li>
          </ul>
        </div>

        <p class="note" data-testid="boost-disclaimer">{{ assessment.disclaimer }}</p>
      </details>
    </template>
    <p
      v-else-if="!locked && assessment && (applicability === 'SUBJECT_NOT_EXCEPTIONAL_KEY_LEVEL' || applicability === 'INSUFFICIENT_CONTEXT' || status === 'INSUFFICIENT_DATA')"
      class="note"
    >{{ assessment.disclaimer }}</p>
  </section>
</template>

<style scoped>
.boost-card {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-surface);
}

.boost-card--high {
  border-color: var(--color-danger-500);
  background: color-mix(in srgb, var(--color-danger-500) 16%, transparent);
}

.boost-card--elevated {
  border-color: var(--color-amber-500);
  background: color-mix(in srgb, var(--color-amber-500) 14%, transparent);
}

.boost-card--low,
.boost-card--muted {
  border-color: var(--color-border);
  background: var(--color-surface);
}

.boost-card__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
}

.boost-card h2 {
  margin: 0;
  font-family: var(--font-data);
  font-size: var(--text-xs);
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.boost-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: baseline;
  margin: 0;
}

.score {
  font-size: 1.1rem;
}

.band {
  font-family: var(--font-data);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.boost-card--high .band {
  color: var(--color-danger-500);
}

.boost-card--elevated .band {
  color: var(--color-amber-400);
}

.note,
.muted,
.signal-copy,
.locked {
  color: var(--muted);
  font-size: 0.9rem;
  margin: 0;
}

.summary-facts {
  margin: 0;
  padding-left: 1.1rem;
  display: grid;
  gap: 0.25rem;
  font-size: var(--text-sm);
}

.fold {
  margin-top: var(--space-1);
}

.fold summary {
  cursor: pointer;
  color: var(--color-gold-300);
  font-size: var(--text-sm);
}

.fold-label {
  margin: var(--space-3) 0 var(--space-2);
  font-size: var(--text-sm);
  font-weight: 700;
}

.signals ol {
  margin: var(--space-2) 0 0;
  padding-left: 1.4rem;
  display: grid;
  gap: var(--space-3);
}

.signal-title {
  margin: 0;
  font-weight: 700;
}

ul {
  margin: 0;
  padding-left: 1.2rem;
}

.run {
  display: grid;
  gap: 0.2rem;
}

.slot {
  margin-left: var(--space-2);
  font-family: var(--font-data);
  font-size: 0.75rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}
</style>
