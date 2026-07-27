<script setup lang="ts">
import { computed } from "vue";
import type { RedFlagDTO } from "../../api/types";
import { formatPercent } from "../../lib/format";

const props = defineProps<{
  flags: RedFlagDTO[];
}>();

const publicFlags = computed(() => props.flags.filter((f) => f.public));
</script>

<template>
  <section v-if="publicFlags.length" class="red-flags" data-testid="red-flags" aria-labelledby="red-flags-title">
    <h2 id="red-flags-title">Signals</h2>
    <p class="note">
      Labels are probabilistic indicators, not proven accusations. “Boost suspected” never means a confirmed purchase.
    </p>
    <ul>
      <li v-for="flag in publicFlags" :key="flag.key" :data-severity="flag.severity">
        <span class="label">{{ flag.label }}</span>
        <span class="sev">{{ flag.severity }}</span>
        <span class="conf">confidence {{ formatPercent(flag.confidence * 100, 0) }}</span>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.red-flags {
  margin: 1.25rem 0;
}

.note {
  color: var(--muted);
  font-size: 0.9rem;
}

ul {
  list-style: none;
  padding: 0;
  margin: 0.5rem 0 0;
  display: grid;
  gap: 0.5rem;
}

li {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: baseline;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel);
}

.label {
  font-weight: 600;
}

.sev,
.conf {
  font-size: 0.85rem;
  color: var(--muted);
}

li[data-severity="HIGH"],
li[data-severity="CRITICAL"] {
  border-left: 3px solid var(--danger);
}

li[data-severity="MEDIUM"] {
  border-left: 3px solid var(--warn);
}

li[data-severity="LOW"],
li[data-severity="INFO"] {
  border-left: 3px solid var(--accent);
}
</style>
