<script setup lang="ts">
import { computed } from "vue";
import type { JobStatusDTO } from "../../api/types";
import {
  extractRefreshEta,
  presentRefreshEtaSummary,
} from "../../lib/refreshEta";

const props = defineProps<{
  job?: JobStatusDTO | null;
}>();

const eta = computed(() => extractRefreshEta(props.job ?? null));
const summary = computed(() => presentRefreshEtaSummary(eta.value));

const visible = computed(
  () =>
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

.refresh-eta__line {
  margin: 0.15rem 0 0;
}

.refresh-eta__muted {
  color: var(--color-text-muted, #7a8499);
  font-weight: 400;
}
</style>
