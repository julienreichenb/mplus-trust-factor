<script setup lang="ts">
import { formatPercent, formatScore, formatWeight } from "../../lib/format";
import type { DimensionEvidenceView } from "../../lib/characterViewModel";

defineProps<{
  dimensions: DimensionEvidenceView[];
  locked?: boolean;
}>();
</script>

<template>
  <section aria-labelledby="dimensions-title" data-testid="dimension-evidence">
    <h2 id="dimensions-title">Dimensions</h2>
    <p class="lede">
      Expand a dimension for internal weights, per-run evidence and missing metrics. Unavailable
      metrics are omitted — never shown as zero.
    </p>
    <p v-if="locked" class="locked">Detailed dimension breakdown is locked by entitlement.</p>
    <div v-else class="list">
      <details v-for="card in dimensions" :key="card.dimension" class="dim">
        <summary>
          <span class="dim__name">{{ card.label }}</span>
          <span class="dim__score mpts-data">
            {{ card.missing ? "Unavailable" : formatScore(card.score, 0) }}
            <span v-if="!card.missing">/ 100</span>
          </span>
        </summary>
        <dl class="dim__meta">
          <div>
            <dt>Weight</dt>
            <dd>{{ formatWeight(card.weight) }}</dd>
          </div>
          <div>
            <dt>Confidence</dt>
            <dd>
              {{
                card.confidence == null
                  ? "Unavailable"
                  : formatPercent(card.confidence <= 1 ? card.confidence * 100 : card.confidence, 0)
              }}
            </dd>
          </div>
          <div>
            <dt>Model</dt>
            <dd class="mpts-data">v{{ card.modelVersion ?? "—" }}</dd>
          </div>
        </dl>

        <div v-if="card.internalWeights.length" class="block">
          <h3>Internal weights</h3>
          <ul>
            <li v-for="w in card.internalWeights" :key="w.key">
              <span>{{ w.key.replaceAll("_", " ") }}</span>
              <span class="mpts-data">
                {{ w.available ? formatWeight(w.weight) : "Unavailable" }}
              </span>
            </li>
          </ul>
        </div>

        <div v-if="card.perRunEvidence.length" class="block">
          <h3>Per-run evidence</h3>
          <ul>
            <li v-for="ev in card.perRunEvidence" :key="`${ev.dungeon}-${ev.summary}`">
              <strong>{{ ev.dungeon }}</strong> — {{ ev.summary }}
            </li>
          </ul>
        </div>

        <div v-if="card.missingMetrics.length" class="block">
          <h3>Missing metrics</h3>
          <ul>
            <li v-for="m in card.missingMetrics" :key="m" class="missing">
              {{ m.replaceAll("_", " ") }} — unavailable (not zero)
            </li>
          </ul>
        </div>

        <p v-if="card.positive[0]" class="contrib"><strong>+</strong> {{ card.positive[0] }}</p>
        <p v-if="card.negative[0]" class="contrib"><strong>−</strong> {{ card.negative[0] }}</p>
      </details>
    </div>
  </section>
</template>

<style scoped>
.lede,
.locked {
  color: var(--color-text-muted);
  max-width: 60ch;
}

.list {
  display: grid;
  gap: var(--space-3);
}

.dim {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-surface);
  padding: 0 var(--space-4) var(--space-4);
}

.dim > summary {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  align-items: center;
  cursor: pointer;
  list-style: none;
  padding: var(--space-4) 0;
  font-weight: 600;
}

.dim > summary::-webkit-details-marker {
  display: none;
}

.dim__score {
  color: var(--color-gold-300);
  font-size: var(--text-lg);
}

.dim__score span {
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  font-weight: 500;
}

.dim__meta {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-3);
  margin: 0 0 var(--space-4);
}

.dim__meta dt {
  font-size: var(--text-xs);
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.dim__meta dd {
  margin: var(--space-1) 0 0;
  font-weight: 600;
}

.block {
  margin-bottom: var(--space-3);
}

.block h3 {
  margin: 0 0 var(--space-2);
  font-size: var(--text-sm);
}

.block ul {
  margin: 0;
  padding-left: 1.1rem;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  display: grid;
  gap: var(--space-1);
}

.block li {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
}

.missing {
  color: var(--color-info-500);
}

.contrib {
  margin: var(--space-1) 0 0;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}
</style>
