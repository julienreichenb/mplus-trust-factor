<script setup lang="ts">
import { computed } from "vue";
import type {
  BoostAssessmentPublicDTO,
  BoostAssessmentSignalDTO,
  BoostCoverageDungeonDTO,
  BoostRunEvidencePublicDTO,
} from "@mplus/contracts";
import { formatScore } from "../../lib/format";

const props = defineProps<{
  assessment: BoostAssessmentPublicDTO | null | undefined;
  locked?: boolean;
}>();

const applicability = computed(() => props.assessment?.applicability.status ?? null);
const status = computed(() => props.assessment?.status ?? null);
const band = computed(() => props.assessment?.suspicionBand ?? null);

const confidencePct = computed(() => {
  const c = props.assessment?.confidence;
  if (typeof c !== "number" || Number.isNaN(c)) return null;
  return Math.round(c * 100);
});

const coverage = computed(() => props.assessment?.coverage ?? null);

const showScore = computed(() => {
  if (!props.assessment) return false;
  if (applicability.value !== "APPLICABLE") return false;
  return status.value === "AVAILABLE" || status.value === "PARTIAL";
});

const orderedSignals = computed(() => {
  const list = [...(props.assessment?.signals ?? [])];
  return list.sort((a, b) => a.displayOrder - b.displayOrder);
});

function dungeonLabel(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function signalLabel(code: string): string {
  switch (code) {
    case "STRONG_PEER_PERFORMANCE_GAP":
      return "Performance gap with teammates";
    case "RECURRENT_STRONG_PEER_COHORT":
      return "Recurring stronger teammates";
    case "HIGH_KEY_SURVIVAL_MISMATCH":
      return "Deaths on highest runs";
    case "TOP_RUN_PUBLIC_EVIDENCE_UNAVAILABLE":
      return "Highest runs without public evidence";
    case "HIGHEST_RUN_TEMPORAL_CLUSTER":
      return "Clustered highest-run timing";
    default:
      return code.replaceAll("_", " ").toLowerCase();
  }
}

function signalExplanation(signal: BoostAssessmentSignalDTO): string | null {
  const facts = signal.facts;
  if (facts.code === "STRONG_PEER_PERFORMANCE_GAP") {
    if (facts.extremePrimaryCount != null && facts.analyzablePrimaryRunCount != null) {
      return `${facts.extremePrimaryCount} extreme gaps across ${facts.analyzablePrimaryRunCount} analysed highest runs.`;
    }
    return null;
  }
  if (facts.code === "RECURRENT_STRONG_PEER_COHORT") {
    if (facts.gapDungeonCount != null) {
      return `Materially stronger teammates recur across ${facts.gapDungeonCount} dungeons.`;
    }
    return null;
  }
  if (facts.code === "HIGH_KEY_SURVIVAL_MISMATCH") {
    if (facts.totalDeaths != null && facts.verifiedPrimaryRunCount != null) {
      return `${facts.totalDeaths} deaths across ${facts.verifiedPrimaryRunCount} verified highest runs.`;
    }
    return null;
  }
  if (facts.code === "TOP_RUN_PUBLIC_EVIDENCE_UNAVAILABLE") {
    const cov = coverage.value;
    if (facts.unverifiableTopRunCount != null && cov) {
      return `${facts.unverifiableTopRunCount} of ${cov.expectedTopRuns} highest dungeon runs could not be publicly analysed.`;
    }
    return null;
  }
  if (facts.code === "HIGHEST_RUN_TEMPORAL_CLUSTER") {
    if (facts.maxDistinctDungeons48h != null) {
      return `Up to ${facts.maxDistinctDungeons48h} highest dungeon records were completed within 48 hours.`;
    }
    return null;
  }
  return null;
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
  <section aria-labelledby="boost-suspicion-title" data-testid="boost-suspicion-section">
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
      <p class="note">{{ assessment.disclaimer }}</p>
    </template>
    <template v-else-if="applicability === 'INSUFFICIENT_CONTEXT' || status === 'INSUFFICIENT_DATA'">
      <p class="band" data-testid="boost-suspicion-band">Insufficient data</p>
      <p class="note" data-testid="boost-insufficient-copy">
        Insufficient public evidence for a Boost assessment.
      </p>
      <p v-if="assessment.signals.some((s) => s.missingReason)" class="note">
        {{ assessment.signals.find((s) => s.missingReason)?.missingReason?.replaceAll("_", " ") }}
      </p>
      <p class="note">{{ assessment.disclaimer }}</p>
    </template>
    <template v-else>
      <div class="header">
        <p class="score-line">
          <span v-if="showScore && band" class="band" data-testid="boost-suspicion-band">{{ band }}</span>
          <span v-if="showScore" class="score">
            <strong data-testid="boost-suspicion-score">{{ formatScore(assessment.suspicionScore, 0) }}</strong>
            / 100
          </span>
        </p>
        <p v-if="confidencePct != null" class="confidence" data-testid="boost-evidence-confidence">
          Evidence confidence
          <strong>{{ confidencePct }}%</strong>
        </p>
      </div>
      <p v-if="status === 'PARTIAL'" class="note" data-testid="boost-partial-copy">
        Public evidence is incomplete. This is not a low-suspicion result.
      </p>
      <p v-if="coverage" class="note" data-testid="boost-coverage-summary">
        Based on public gameplay evidence from {{ coverage.analyzableTopRuns }} /
        {{ coverage.expectedTopRuns }} highest dungeon runs.
      </p>

      <div v-if="orderedSignals.length" class="signals">
        <h3>Strongest indicators</h3>
        <ul>
          <li
            v-for="signal in orderedSignals"
            :key="signal.code"
            class="signal"
            :data-testid="`boost-signal-${signal.code}`"
          >
            <div class="signal-head">
              <span>{{ signalLabel(signal.code) }}</span>
              <span class="contrib" data-testid="boost-signal-contribution">{{ signal.contribution }}</span>
            </div>
            <p v-if="signalExplanation(signal)" class="signal-copy">{{ signalExplanation(signal) }}</p>
            <p v-else-if="signal.status === 'UNAVAILABLE'" class="signal-copy muted">
              Not available for this sample.
            </p>
          </li>
        </ul>
      </div>

      <details v-if="coverage" class="fold" data-testid="boost-coverage-details">
        <summary>Evidence coverage</summary>
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
      </details>

      <details
        v-if="primaryRuns.length"
        class="fold"
        data-testid="boost-run-evidence"
      >
        <summary>Peer performance evidence</summary>
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
      </details>

      <p class="note" data-testid="boost-disclaimer">{{ assessment.disclaimer }}</p>
    </template>
  </section>
</template>

<style scoped>
.header {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
}

.score-line {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: baseline;
}

.score {
  font-size: 1.25rem;
}

.band {
  font-family: var(--font-data);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.confidence,
.note,
.muted,
.signal-copy {
  color: var(--muted);
  font-size: 0.9rem;
}

.signals h3,
.fold summary {
  margin: var(--space-4) 0 var(--space-2);
  font-size: 1rem;
}

ul {
  margin: 0;
  padding-left: 1.2rem;
}

.signal-head,
.run {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: var(--space-2);
}

.contrib,
.slot {
  font-family: var(--font-data);
  font-size: 0.85rem;
}

.locked {
  color: var(--muted);
}

.fold {
  margin-top: var(--space-3);
}

.fold ul {
  display: grid;
  gap: var(--space-2);
}
</style>
