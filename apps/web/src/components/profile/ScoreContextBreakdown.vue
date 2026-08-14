<script setup lang="ts">
import { computed } from "vue";
import type { ScoreSnapshotDTO } from "@mplus/contracts";
import { humanizeSlug } from "../../lib/characterViewModel";
import { formatScore } from "../../lib/format";

const props = defineProps<{
  score: ScoreSnapshotDTO | null | undefined;
}>();

const ctx = computed(() => props.score?.scoreContext ?? null);
const visible = computed(() => Boolean(ctx.value));
const canonicalRuns = computed(() => ctx.value?.keyContext.canonicalRuns ?? []);

function factorLabel(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "×1.00";
  return `×${value.toFixed(2)}`;
}

function statusReason(status: string | undefined, reason: string | null | undefined, fallback: string): string {
  if (status === "AVAILABLE") return "";
  if (reason === "MEDIAN_KEY_DISTRIBUTION_MISSING") return "Season distribution unavailable";
  if (reason === "NOT_CONFIGURED" || status === "NOT_CONFIGURED") return fallback;
  if (status === "SPEC_UNKNOWN") return "Specialization unknown — no meta adjustment";
  if (reason) return reason.replaceAll("_", " ").toLowerCase();
  return fallback;
}
</script>

<template>
  <section v-if="visible && ctx" class="score-context" data-testid="score-context-breakdown">
    <h2>Score context</h2>
    <ol class="flow" data-testid="context-flow">
      <li>
        Raw Trust Score
        <strong class="mpts-data" data-testid="context-raw">{{ formatScore(ctx.rawScoreBeforeContext, 3) }}</strong>
      </li>
      <li>
        Key difficulty {{ factorLabel(ctx.keyContext.factor) }}
        <span class="muted">{{
          statusReason(ctx.keyContext.status, ctx.keyContext.reason, "Season distribution unavailable")
        }}</span>
      </li>
      <li>
        Meta {{ factorLabel(ctx.metaContext.factor) }}
        <span class="muted">{{
          statusReason(ctx.metaContext.status, ctx.metaContext.reason, "No meta tier configured for this specialization")
        }}</span>
      </li>
      <li>
        Combined {{ factorLabel(ctx.combinedFactor) }}
      </li>
      <li v-if="ctx.wasClamped" data-testid="context-clamp">
        Pre-clamp {{ formatScore(ctx.preClampAdjustedScore, 3) }} → capped at 100
      </li>
      <li>
        Final Trust Score
        <strong class="mpts-data" data-testid="context-final">{{ formatScore(ctx.finalScore, 3) }}</strong>
        <span v-if="ctx.finalGrade" data-testid="context-final-grade">{{ ctx.finalGrade }}</span>
      </li>
    </ol>

    <div class="detail" data-testid="key-context-detail">
      <h3>Key difficulty</h3>
      <p v-if="ctx.keyContext.status === 'AVAILABLE'">
        Median key: +{{ ctx.keyContext.medianKeyLevel }}
        · Difficulty band: {{ ctx.keyContext.appliedAnchorPercentileLabel ?? "step band" }}
        threshold (+{{ ctx.keyContext.appliedAnchorKeyThreshold }})
        · Factor: {{ factorLabel(ctx.keyContext.factor) }}
      </p>
      <p v-else data-testid="key-unknown">
        {{ factorLabel(1) }}
        ·
        {{ statusReason(ctx.keyContext.status, ctx.keyContext.reason, "Season distribution unavailable") }}
      </p>
      <ul v-if="canonicalRuns.length" data-testid="canonical-runs">
        <li v-for="run in canonicalRuns" :key="run.canonicalRunId">
          {{ humanizeSlug(run.dungeonSlug) }} +{{ run.keyLevel }}
        </li>
      </ul>
    </div>

    <div class="detail" data-testid="meta-context-detail">
      <h3>Meta</h3>
      <p v-if="ctx.metaContext.status === 'AVAILABLE'" data-testid="meta-available">
        {{ humanizeSlug(ctx.metaContext.specSlug) }}
        {{ humanizeSlug(ctx.metaContext.classSlug) }}
        · Meta Tier {{ ctx.metaContext.tier }}
        · {{ factorLabel(ctx.metaContext.factor) }}
      </p>
      <p v-else-if="ctx.metaContext.status === 'SPEC_UNKNOWN'" data-testid="meta-spec-unknown">
        {{ factorLabel(1) }} · Specialization unknown
      </p>
      <p v-else data-testid="meta-unconfigured">
        {{ factorLabel(1) }} · No meta tier configured for this specialization
      </p>
    </div>
  </section>
</template>

<style scoped>
.score-context {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
}
.flow {
  margin: 0;
  padding-left: 1.2rem;
  display: grid;
  gap: 0.35rem;
}
.muted {
  color: var(--color-text-muted);
  font-weight: 500;
}
.detail ul {
  margin: 0.35rem 0 0;
  padding-left: 1.1rem;
}
</style>
