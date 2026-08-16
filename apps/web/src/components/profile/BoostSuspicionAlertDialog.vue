<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from "vue";
import type { BoostAssessmentPublicDTO, BoostAssessmentSignalDTO } from "@mplus/contracts";
import { formatScore } from "../../lib/format";
import { boostSignalLabel, signalExplanation as explainSignal } from "../../lib/boostSuspicionPresentation";

const props = defineProps<{
  open: boolean;
  assessment: BoostAssessmentPublicDTO | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

function onKey(event: KeyboardEvent): void {
  if (event.key === "Escape" && props.open) emit("close");
}

onMounted(() => window.addEventListener("keydown", onKey));
onUnmounted(() => window.removeEventListener("keydown", onKey));

watch(
  () => props.open,
  (open) => {
    document.body.style.overflow = open ? "hidden" : "";
  },
);

const coverageLine = computed(() => {
  const c = props.assessment?.coverage;
  if (!c) return null;
  return `${c.analyzableTopRuns} of ${c.expectedTopRuns} highest dungeon runs could be behaviourally analysed.`;
});

const orderedSignals = computed(() => {
  const list = [...(props.assessment?.signals ?? [])];
  return list
    .filter((s) => s.status === "COMPUTED")
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .slice(0, 5);
});

function signalLabel(code: string): string {
  return boostSignalLabel(code);
}

function signalFact(signal: BoostAssessmentSignalDTO): string | null {
  return explainSignal(signal, props.assessment?.coverage.expectedTopRuns ?? null, "alert");
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && assessment"
      class="boost-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="boost-alert-title"
      data-testid="boost-suspicion-alert-dialog"
    >
      <button
        type="button"
        class="boost-dialog__backdrop"
        aria-label="Close boost suspicion warning"
        @click="emit('close')"
      />
      <div class="boost-dialog__panel">
        <header class="boost-dialog__head">
          <h2 id="boost-alert-title">High boost suspicion</h2>
          <button
            type="button"
            class="boost-dialog__close"
            data-testid="boost-alert-close"
            aria-label="Close"
            @click="emit('close')"
          >
            ×
          </button>
        </header>

        <div class="boost-dialog__body">
          <div class="boost-dialog__score-row">
            <p class="boost-dialog__score" data-testid="boost-alert-score">
              <span class="mpts-data">{{ formatScore(assessment.suspicionScore, 0) }}</span>
              <span> / 100</span>
              <span class="boost-dialog__band">{{ assessment.suspicionBand }}</span>
            </p>
            <span class="boost-dialog__confidence-chip" data-testid="boost-alert-confidence">
              Evidence confidence {{ Math.round(assessment.confidence * 100) }}%
            </span>
          </div>
          <p v-if="coverageLine" class="muted" data-testid="boost-alert-coverage">
            {{ coverageLine }}
          </p>

          <ul v-if="orderedSignals.length" data-testid="boost-alert-signals">
            <li v-for="(signal, index) in orderedSignals" :key="signal.code">
              <span class="boost-dialog__num" aria-hidden="true">{{ index + 1 }}</span>
              <span class="boost-dialog__signal">
                <strong>{{ signalLabel(signal.code) }}</strong>
                <span v-if="signalFact(signal)">{{ signalFact(signal) }}</span>
              </span>
            </li>
          </ul>

          <p class="disclaimer" data-testid="boost-alert-disclaimer">{{ assessment.disclaimer }}</p>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.boost-dialog {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: var(--space-4);
}

.boost-dialog__backdrop {
  position: absolute;
  inset: 0;
  border: 0;
  background: rgb(0 0 0 / 55%);
  cursor: pointer;
}

.boost-dialog__panel {
  position: relative;
  z-index: 1;
  width: min(48rem, 95vw);
  max-height: min(80vh, 40rem);
  overflow: auto;
  border: 1px solid var(--color-danger-500);
  border-radius: var(--radius-card);
  background: var(--color-surface);
  box-shadow: 0 16px 48px rgb(0 0 0 / 45%);
}

.boost-dialog__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-4);
  border-bottom: 1px solid var(--color-border);
}

.boost-dialog__head h2 {
  margin: 0;
  color: var(--color-danger-500);
  font-size: var(--text-lg);
}

.boost-dialog__close {
  border: 0;
  background: transparent;
  color: var(--color-text-muted);
  font-size: 1.5rem;
  line-height: 1;
  cursor: pointer;
}

.boost-dialog__body {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-4);
}

.boost-dialog__score-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.boost-dialog__score {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 700;
}

.boost-dialog__band {
  margin-left: var(--space-2);
  color: var(--color-danger-500);
  letter-spacing: 0.06em;
}

.boost-dialog__confidence-chip {
  margin-left: auto;
  flex-shrink: 0;
  padding: 0.35rem 0.65rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: rgb(255 255 255 / 3%);
  font-family: var(--font-data);
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  white-space: nowrap;
}

.muted,
.disclaimer {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.boost-dialog__body ul {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: var(--space-2);
  font-size: var(--text-sm);
}

.boost-dialog__body li {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--space-3);
  align-items: start;
}

.boost-dialog__num {
  display: grid;
  place-items: center;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 50%;
  background: color-mix(in srgb, var(--color-danger-500) 18%, transparent);
  color: var(--color-danger-500);
  font-family: var(--font-data);
  font-size: var(--text-xs);
  font-weight: 800;
}

.boost-dialog__signal {
  display: grid;
  gap: 0.15rem;
}

.disclaimer {
  border-top: 1px solid var(--color-border);
  padding-top: var(--space-3);
}
</style>
