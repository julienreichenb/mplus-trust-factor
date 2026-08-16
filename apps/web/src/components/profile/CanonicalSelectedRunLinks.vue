<script setup lang="ts">
import { computed } from "vue";
import type { CanonicalDungeonEvidencePublicDTO } from "@mplus/contracts";
import { sanitizeWarcraftLogsUrl } from "../../lib/warcraftLogsUrl";
import {
  canonicalReportsForDungeon,
  canonicalRunSlotHeadline,
} from "../../lib/canonicalSelectedRuns";

const props = defineProps<{
  dungeonSlug: string;
  canonicalDungeonEvidence?: CanonicalDungeonEvidencePublicDTO[];
}>();

const reports = computed(() =>
  canonicalReportsForDungeon(props.canonicalDungeonEvidence, props.dungeonSlug),
);
</script>

<template>
  <span
    v-if="reports.length === 0"
    class="canonical-run-links canonical-run-links--empty"
    data-testid="selected-run-links"
  >Unavailable</span>
  <span v-else class="canonical-run-links" data-testid="selected-run-links">
    <span
      v-for="report in reports"
      :key="report.identity"
      class="canonical-run-links__slot"
      :title="report.identity"
    >
      <a
        v-if="sanitizeWarcraftLogsUrl(report.wclUrl)"
        class="canonical-run-links__link selected-runs__link"
        :href="sanitizeWarcraftLogsUrl(report.wclUrl)!"
        target="_blank"
        rel="noopener noreferrer"
      >{{ canonicalRunSlotHeadline(report) }} ↗</a>
      <template v-else>
        <span class="canonical-run-links__plain selected-runs__plain">{{
          canonicalRunSlotHeadline(report)
        }}</span>
        <span class="canonical-run-links__unavailable">Unavailable</span>
      </template>
    </span>
  </span>
</template>

<style scoped>
.canonical-run-links {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.2rem;
  min-width: 11rem;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  white-space: nowrap;
}

.canonical-run-links__slot {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.05rem;
}

.canonical-run-links__link {
  color: var(--color-gold-300);
  text-decoration: none;
}

.canonical-run-links__link:hover,
.canonical-run-links__link:focus-visible {
  color: var(--color-brand-hover);
  text-decoration: underline;
  outline: none;
}

.canonical-run-links__plain,
.canonical-run-links--empty,
.canonical-run-links__unavailable {
  color: var(--color-text-muted);
}

.canonical-run-links__unavailable {
  font-size: var(--text-xs);
  font-weight: 600;
}
</style>
