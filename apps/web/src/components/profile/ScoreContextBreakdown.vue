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
  <div v-if="visible && ctx" class="score-context" data-testid="score-context-breakdown">
    <dl class="rows" data-testid="context-flow">
      <div>
        <dt>Raw Trust Score</dt>
        <dd class="mpts-data" data-testid="context-raw">{{ formatScore(ctx.rawScoreBeforeContext, 1) }}</dd>
      </div>
      <div data-testid="key-context-detail">
        <dt>Key difficulty</dt>
        <dd>
          {{ factorLabel(ctx.keyContext.factor) }}
          <template v-if="ctx.keyContext.status === 'AVAILABLE'">
            <span class="muted">Median key +{{ ctx.keyContext.medianKeyLevel }}</span>
            <span class="muted">
              Band {{ ctx.keyContext.appliedAnchorPercentileLabel ?? "step band" }}
              threshold (+{{ ctx.keyContext.appliedAnchorKeyThreshold }})
            </span>
          </template>
          <span v-else class="muted" data-testid="key-unknown">{{
            statusReason(ctx.keyContext.status, ctx.keyContext.reason, "Season distribution unavailable")
          }}</span>
        </dd>
      </div>
      <div data-testid="meta-context-detail">
        <dt>Meta</dt>
        <dd>
          {{ factorLabel(ctx.metaContext.factor) }}
          <span v-if="ctx.metaContext.status === 'AVAILABLE'" class="muted" data-testid="meta-available">
            {{ humanizeSlug(ctx.metaContext.specSlug) }}
            {{ humanizeSlug(ctx.metaContext.classSlug) }}
            · Tier {{ ctx.metaContext.tier }}
          </span>
          <span v-else-if="ctx.metaContext.status === 'SPEC_UNKNOWN'" class="muted" data-testid="meta-spec-unknown">
            Specialization unknown
          </span>
          <span v-else class="muted" data-testid="meta-unconfigured">
            No meta tier configured
          </span>
        </dd>
      </div>
      <div>
        <dt>Combined adjustment</dt>
        <dd>{{ factorLabel(ctx.combinedFactor) }}</dd>
      </div>
      <div v-if="ctx.wasClamped" data-testid="context-clamp">
        <dt>Pre-clamp</dt>
        <dd>
          {{ formatScore(ctx.preClampAdjustedScore, 1) }}
          <span class="muted">Final {{ formatScore(ctx.finalScore, 1) }} · capped at 100</span>
        </dd>
      </div>
      <div>
        <dt>Final Trust Score</dt>
        <dd>
          <strong class="mpts-data" data-testid="context-final">{{ formatScore(ctx.finalScore, 1) }}</strong>
          <span v-if="ctx.finalGrade" data-testid="context-final-grade">{{ ctx.finalGrade }}</span>
        </dd>
      </div>
    </dl>
    <details v-if="canonicalRuns.length" data-testid="canonical-runs">
      <summary>Dungeon representatives</summary>
      <ul>
        <li v-for="run in canonicalRuns" :key="run.canonicalRunId">
          {{ humanizeSlug(run.dungeonSlug) }} +{{ run.keyLevel }}
        </li>
      </ul>
    </details>
  </div>
</template>

<style scoped>
.score-context {
  display: grid;
  gap: 0.45rem;
}
.rows {
  display: grid;
  gap: 0.4rem;
  margin: 0;
}
.rows > div {
  display: grid;
  grid-template-columns: minmax(7.5rem, 40%) 1fr;
  gap: 0.35rem 0.6rem;
  align-items: start;
}
dt {
  margin: 0;
  color: var(--color-text-muted);
  font-weight: 600;
}
dd {
  margin: 0;
  display: grid;
  gap: 0.1rem;
}
.muted {
  color: var(--color-text-muted);
  font-weight: 500;
}
details {
  margin-top: 0.25rem;
}
details ul {
  margin: 0.35rem 0 0;
  padding-left: 1.1rem;
}
</style>
