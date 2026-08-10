<script setup lang="ts">
import { computed, ref } from "vue";
import type { ScoreExplainabilityV1 } from "@mplus/contracts";

const props = defineProps<{
  explainability: ScoreExplainabilityV1 | null | undefined;
}>();

const showRaw = ref(false);

const dims = computed(() => {
  const expl = props.explainability;
  if (!expl) return [];
  return (["PERFORMANCE", "SURVIVAL", "UTILITY", "EXPERIENCE"] as const).map((key) => {
    const d = expl.dimensions[key];
    return {
      key,
      score: d.score,
      availability: d.availability,
      confidence: d.confidenceStory.value,
      band: d.confidenceStory.band,
      drivers: d.scoreStory.drivers,
      reasons: d.confidenceStory.reasons,
      components: d.confidenceStory.components,
    };
  });
});

const composite = computed(() => props.explainability?.composite ?? null);
const meta = computed(() =>
  props.explainability
    ? {
        schemaVersion: props.explainability.schemaVersion,
        labelCatalogVersion: props.explainability.labelCatalogVersion,
        materialityPolicyVersion: props.explainability.materialityPolicyVersion,
        fingerprint: props.explainability.fingerprint,
      }
    : null,
);

function fmt(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function dirLabel(direction: string): string {
  if (direction === "POSITIVE") return "+";
  if (direction === "NEGATIVE") return "−";
  return "•";
}
</script>

<template>
  <section
    class="audit"
    data-testid="score-explainability-audit"
    aria-label="Score Explainability V1 audit"
  >
    <header class="audit__head">
      <h3>Score Explainability V1 (audit)</h3>
      <p class="audit__note">
        Canonical CharacterScore explainability — distinct from Scoring V2 EvidenceManifest forensics.
      </p>
    </header>

    <p v-if="!explainability" class="audit__empty">
      No ScoreExplainabilityV1 on this CharacterScore (legacy row). Recalculate to populate.
    </p>

    <template v-else>
      <dl v-if="meta" class="audit__meta">
        <div><dt>schema</dt><dd><code>{{ meta.schemaVersion }}</code></dd></div>
        <div><dt>labels</dt><dd><code>{{ meta.labelCatalogVersion }}</code></dd></div>
        <div><dt>materiality</dt><dd><code>{{ meta.materialityPolicyVersion }}</code></dd></div>
        <div><dt>fingerprint</dt><dd><code class="fp">{{ meta.fingerprint }}</code></dd></div>
      </dl>

      <div v-if="composite" class="audit__composite">
        <h4>Composite</h4>
        <ul>
          <li>score {{ fmt(composite.score, 1) }} · confidence {{ fmt(composite.confidence, 3) }} · tier {{ composite.grade }}</li>
          <li>coverage {{ fmt(composite.availabilityCoverage, 3) }}</li>
          <li>available: {{ composite.availableDimensions.join(", ") || "—" }}</li>
          <li>unavailable: {{ composite.unavailableDimensions.join(", ") || "—" }}</li>
          <li>
            effective weights:
            <code>{{ JSON.stringify(composite.effectiveWeights) }}</code>
          </li>
        </ul>
      </div>

      <article v-for="dim in dims" :key="dim.key" class="audit__dim">
        <h4>
          {{ dim.key }}
          <span class="audit__dim-meta">
            score {{ fmt(dim.score, 1) }} · {{ dim.availability }} · conf {{ fmt(dim.confidence, 3) }}
            <template v-if="dim.band"> ({{ dim.band }})</template>
          </span>
        </h4>

        <h5>Score drivers</h5>
        <table v-if="dim.drivers.length" class="audit__table">
          <thead>
            <tr>
              <th scope="col">dir</th>
              <th scope="col">code</th>
              <th scope="col">label</th>
              <th scope="col">value</th>
              <th scope="col">norm</th>
              <th scope="col">weight</th>
              <th scope="col">contrib</th>
              <th scope="col">mat</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(driver, i) in dim.drivers" :key="`${driver.code}-${i}`">
              <td :data-dir="driver.direction" :title="driver.direction">
                {{ dirLabel(driver.direction) }}
              </td>
              <td><code>{{ driver.code }}</code></td>
              <td>{{ driver.label }}</td>
              <td>{{ fmt(driver.value) }}</td>
              <td>{{ fmt(driver.normalizedValue) }}</td>
              <td>{{ fmt(driver.weight) }}</td>
              <td>{{ fmt(driver.contribution) }}</td>
              <td>{{ fmt(driver.materiality) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="audit__empty">No score drivers</p>

        <details v-for="(driver, i) in dim.drivers" :key="`params-${driver.code}-${i}`" class="audit__params">
          <summary>{{ driver.code }} params / evidence</summary>
          <pre>{{ JSON.stringify({ params: driver.params, evidence: driver.evidence }, null, 2) }}</pre>
        </details>

        <h5>Confidence reasons</h5>
        <ul v-if="dim.reasons.length" class="audit__list">
          <li v-for="(reason, i) in dim.reasons" :key="`${reason.code}-${i}`">
            <code>{{ reason.code }}</code> — {{ reason.label }}
            <details v-if="Object.keys(reason.params).length || Object.keys(reason.evidence).length">
              <summary>params / evidence</summary>
              <pre>{{ JSON.stringify({ params: reason.params, evidence: reason.evidence }, null, 2) }}</pre>
            </details>
          </li>
        </ul>
        <p v-else class="audit__empty">No confidence reasons</p>

        <h5>Confidence components</h5>
        <ul v-if="dim.components.length" class="audit__list">
          <li v-for="(c, i) in dim.components" :key="`${c.key}-${i}`">
            <code>{{ c.key }}</code> = {{ fmt(c.value, 4) }} — {{ c.label }}
          </li>
        </ul>
        <p v-else class="audit__empty">No confidence components</p>
      </article>

      <details class="audit__raw" :open="showRaw" @toggle="showRaw = ($event.target as HTMLDetailsElement).open">
        <summary>Raw canonical JSON</summary>
        <pre>{{ JSON.stringify(explainability, null, 2) }}</pre>
      </details>
    </template>
  </section>
</template>

<style scoped>
.audit {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-surface);
  font-size: var(--text-sm);
}

.audit__head h3,
.audit__dim h4,
.audit__dim h5,
.audit__composite h4 {
  margin: 0 0 0.35rem;
}

.audit__note,
.audit__empty {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}

.audit__meta {
  display: grid;
  gap: 0.35rem;
  margin: 0;
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
}

.audit__meta div {
  display: grid;
  gap: 0.15rem;
}

.audit__meta dt {
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-muted);
}

.audit__meta dd {
  margin: 0;
  word-break: break-all;
}

.fp {
  font-size: 0.7rem;
}

.audit__dim {
  display: grid;
  gap: 0.5rem;
  padding-top: var(--space-2);
  border-top: 1px solid var(--color-border);
}

.audit__dim-meta {
  display: inline-block;
  margin-left: 0.5rem;
  font-weight: 500;
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}

.audit__table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-xs);
}

.audit__table th,
.audit__table td {
  border: 1px solid var(--color-border);
  padding: 0.25rem 0.35rem;
  text-align: left;
  vertical-align: top;
}

.audit__table td[data-dir="POSITIVE"] {
  color: var(--color-success-500);
  font-weight: 700;
}

.audit__table td[data-dir="NEGATIVE"] {
  color: var(--color-danger-500);
  font-weight: 700;
}

.audit__list {
  margin: 0;
  padding-left: 1.1rem;
}

.audit__params,
.audit__raw {
  font-size: var(--text-xs);
}

.audit__params pre,
.audit__raw pre,
.audit__list pre {
  margin: 0.35rem 0 0;
  max-height: 16rem;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
