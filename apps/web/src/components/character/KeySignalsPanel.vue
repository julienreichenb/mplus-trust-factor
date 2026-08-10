<script setup lang="ts">
import { computed } from "vue";
import type { DimensionScoreDTO } from "@mplus/contracts";
import type { RedFlagDTO } from "../../api/types";
import {
  evidenceNoteFromFlag,
  parseContributorSignals,
  topSignals,
} from "../../lib/characterViewModel";
import { formatPercent } from "../../lib/format";

const props = defineProps<{
  dimensions: DimensionScoreDTO[];
  flags: RedFlagDTO[];
}>();

const contributorSignals = computed(() => parseContributorSignals(props.dimensions));
const positives = computed(() => topSignals(contributorSignals.value, "positive", 3));
const risks = computed(() => topSignals(contributorSignals.value, "risk", 3));
const facts = computed(() => topSignals(contributorSignals.value, "fact", 3));
const publicFlags = computed(() => props.flags.filter((f) => f.public));
</script>

<template>
  <section class="signals" aria-labelledby="signals-title">
    <h2 id="signals-title">Why this trust profile</h2>
    <p class="note">
      Signals below are derived from scored dimensions and public probabilistic indicators. They are not
      proven accusations.
    </p>

    <div class="columns">
      <div>
        <h3>Positive signals</h3>
        <ul v-if="positives.length">
          <li v-for="(item, index) in positives" :key="`pos-${index}`">
            <span class="kind kind--pos">Positive</span>
            {{ item.label }}
            <span v-if="item.dimension" class="dim">{{ item.dimension }}</span>
          </li>
        </ul>
        <p v-else class="empty">No positive contributor labels in this snapshot.</p>
      </div>

      <div>
        <h3>Risks &amp; weaknesses</h3>
        <ul v-if="risks.length">
          <li v-for="(item, index) in risks" :key="`risk-${index}`">
            <span class="kind kind--risk">Weakness</span>
            {{ item.label }}
            <span v-if="item.dimension" class="dim">{{ item.dimension }}</span>
          </li>
        </ul>
        <p v-else class="empty">No risk contributor labels in this snapshot.</p>
      </div>

      <div v-if="facts.length">
        <h3>Facts / context</h3>
        <ul>
          <li v-for="(item, index) in facts" :key="`fact-${index}`">
            <span class="kind kind--fact">Fact</span>
            {{ item.label }}
            <span v-if="item.dimension" class="dim">{{ item.dimension }}</span>
          </li>
        </ul>
      </div>
    </div>

    <section
      v-if="publicFlags.length"
      class="flags"
      data-testid="red-flags"
      aria-labelledby="red-flags-title"
    >
      <h3 id="red-flags-title">Public indicators</h3>
      <p class="note">
        Labels are probabilistic indicators, not proven accusations. “Boost suspected” never means a
        confirmed purchase.
      </p>
      <ul>
        <li v-for="flag in publicFlags" :key="flag.key" :data-severity="flag.severity">
          <div class="flag__head">
            <span class="label">{{ flag.label }}</span>
            <span class="sev">{{ flag.severity }}</span>
            <span class="conf">confidence {{ formatPercent(flag.confidence * 100, 0) }}</span>
          </div>
          <p v-if="evidenceNoteFromFlag(flag)" class="evidence">{{ evidenceNoteFromFlag(flag) }}</p>
        </li>
      </ul>
    </section>
  </section>
</template>

<style scoped>
.signals {
  display: grid;
  gap: var(--space-4);
}

.signals h2,
.signals h3 {
  margin: 0;
}

.note,
.empty,
.dim,
.evidence {
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.note {
  margin: 0;
}

.columns {
  display: grid;
  gap: var(--space-5);
}

.columns ul,
.flags ul {
  list-style: none;
  margin: var(--space-3) 0 0;
  padding: 0;
  display: grid;
  gap: var(--space-2);
}

.columns li,
.flags li {
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-surface);
  font-size: var(--text-sm);
}

.kind {
  display: inline-block;
  margin-right: var(--space-2);
  font-family: var(--font-data);
  font-size: var(--text-xs);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.kind--pos {
  color: var(--color-success-500);
}

.kind--risk {
  color: var(--color-ember-500);
}

.kind--fact {
  color: var(--color-text-muted);
}

.dim {
  display: block;
  margin-top: var(--space-1);
}

.flag__head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  align-items: baseline;
}

.label {
  font-weight: 600;
  color: var(--color-text);
}

.sev,
.conf {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.flags li[data-severity="HIGH"],
.flags li[data-severity="CRITICAL"] {
  border-left: 3px solid var(--color-danger-500);
}

.flags li[data-severity="MEDIUM"] {
  border-left: 3px solid var(--color-amber-500);
}

.flags li[data-severity="LOW"],
.flags li[data-severity="INFO"] {
  border-left: 3px solid var(--color-info-500);
}

.evidence {
  margin: var(--space-2) 0 0;
}

@media (min-width: 768px) {
  .columns {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
