<script setup lang="ts">
import { formatPercent, formatScore } from "../../lib/format";
import type { RedFlagDTO } from "../../api/types";

defineProps<{
  authenticityScore: number | null;
  flags: RedFlagDTO[];
  locked?: boolean;
}>();
</script>

<template>
  <section aria-labelledby="auth-title" data-testid="authenticity-section">
    <h2 id="auth-title">Authenticity</h2>
    <p v-if="locked" class="locked">Authenticity details are locked by entitlement.</p>
    <template v-else>
      <p class="score">
        Authenticity score:
        <strong>{{ formatScore(authenticityScore, 0) }}</strong>
        / 100
      </p>
      <p class="note">
        This score blends progression, roster, and performance patterns. Red flags below are
        probabilistic — never treat them as proof of boosting or account sharing.
      </p>
      <ul v-if="flags.length">
        <li v-for="f in flags" :key="f.key">
          {{ f.label }} ({{ f.severity }}, {{ formatPercent(f.confidence * 100, 0) }})
        </li>
      </ul>
      <p v-else class="note">No authenticity red flags on this snapshot.</p>
    </template>
  </section>
</template>

<style scoped>
.score {
  font-size: 1.1rem;
}

.note {
  color: var(--muted);
  font-size: 0.9rem;
}

ul {
  margin: 0.5rem 0 0;
  padding-left: 1.2rem;
}

.locked {
  color: var(--muted);
}
</style>
