<script setup lang="ts">
import { computed } from "vue";
import type { JobStatusDTO } from "../../api/types";
import {
  extractRefreshEta,
  presentRefreshEtaSummary,
} from "../../lib/refreshEta";

const props = defineProps<{
  job?: JobStatusDTO | null;
  /** Coarse profile refresh status for distinguishing QUEUED vs PROCESSING. */
  refreshStatus?: string | null;
  failed?: boolean;
}>();

const eta = computed(() => extractRefreshEta(props.job ?? null));
const summary = computed(() => presentRefreshEtaSummary(eta.value));

const phaseLabel = computed(() => {
  if (props.failed || props.job?.status === "failed") return "Refresh failed";
  if (props.job?.status === "active" || props.refreshStatus === "IN_PROGRESS" || props.refreshStatus === "REFRESHING") {
    return "Processing";
  }
  if (props.job?.status === "queued" || props.refreshStatus === "QUEUED") {
    return "Queued";
  }
  return null;
});

const visible = computed(
  () =>
    Boolean(phaseLabel.value) ||
    Boolean(summary.value.jobsAhead) ||
    Boolean(summary.value.waitRange) ||
    Boolean(summary.value.explanation),
);
</script>

<template>
  <div
    v-if="visible"
    class="refresh-eta"
    data-testid="refresh-eta"
    role="status"
    aria-live="polite"
  >
    <p v-if="phaseLabel" class="refresh-eta__phase" data-testid="refresh-eta-phase">
      {{ phaseLabel }}
    </p>
    <p v-if="summary.jobsAhead" class="refresh-eta__line" data-testid="refresh-eta-jobs-ahead">
      {{ summary.jobsAhead }}
    </p>
    <p v-if="summary.waitRange" class="refresh-eta__line" data-testid="refresh-eta-wait">
      Approximate wait: {{ summary.waitRange }}
      <span v-if="summary.confidence" class="refresh-eta__muted">
        ({{ summary.confidence }})
      </span>
    </p>
    <p
      v-else-if="summary.explanation"
      class="refresh-eta__line refresh-eta__muted"
      data-testid="refresh-eta-explanation"
    >
      {{ summary.explanation }}
    </p>
  </div>
</template>

<style scoped>
.refresh-eta {
  margin-top: var(--space-2);
  font-size: 0.875rem;
  line-height: 1.4;
  color: var(--color-text-secondary, #9aa3b2);
}

.refresh-eta__phase {
  margin: 0 0 0.25rem;
  font-weight: 600;
  color: var(--color-text-primary, #e8ecf4);
}

.refresh-eta__line {
  margin: 0.15rem 0 0;
}

.refresh-eta__muted {
  color: var(--color-text-muted, #7a8499);
  font-weight: 400;
}
</style>
