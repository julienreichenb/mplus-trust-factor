<script setup lang="ts">
import { computed } from "vue";
import type { CharacterScoreLoadPhase } from "../../lib/characterScoreLoadState";
import { characterScoreLoadStatusMessage } from "../../lib/characterScoreLoadState";

const props = defineProps<{
  phase: Extract<CharacterScoreLoadPhase, "calculating" | "timed_out" | "failed">;
}>();

const emit = defineEmits<{
  retry: [];
}>();

const message = computed(() => characterScoreLoadStatusMessage(props.phase));
const isCalculating = computed(() => props.phase === "calculating");
const isError = computed(() => props.phase === "timed_out" || props.phase === "failed");
const title = computed(() => {
  if (props.phase === "timed_out") return "Calculation timed out";
  if (props.phase === "failed") return "Calculation failed";
  return "Trust Score in progress";
});
</script>

<template>
  <section
    class="score-loading"
    data-testid="character-score-loading"
    :data-phase="phase"
    :aria-busy="isCalculating ? 'true' : 'false'"
    aria-live="polite"
  >
    <div class="score-loading__header">
      <h2 class="score-loading__title">{{ title }}</h2>
      <p class="score-loading__status" role="status">{{ message }}</p>
    </div>

    <div
      v-if="isCalculating"
      class="score-loading__bar"
      role="progressbar"
      aria-valuetext="Calculating Trust Score"
      aria-label="Calculating Trust Score"
    >
      <span class="score-loading__bar-fill" />
    </div>

    <div class="score-loading__ghosts" aria-hidden="true">
      <div class="score-loading__grade-ghost" />
      <div class="score-loading__meta-ghosts">
        <span class="score-loading__chip-ghost" />
        <span class="score-loading__chip-ghost" />
        <span class="score-loading__chip-ghost" />
      </div>
      <div class="score-loading__dims">
        <span v-for="n in 4" :key="n" class="score-loading__dim-ghost" />
      </div>
    </div>

    <div v-if="isError" class="score-loading__actions">
      <button type="button" class="btn" data-testid="character-score-loading-retry" @click="emit('retry')">
        Retry
      </button>
    </div>
  </section>
</template>

<style scoped>
.score-loading {
  display: grid;
  gap: var(--space-4);
  padding: var(--space-5);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-hero);
  background:
    radial-gradient(circle at 12% 0%, rgb(var(--color-rank-rgb) / 12%), transparent 42%),
    linear-gradient(165deg, var(--color-iron-850), var(--color-obsidian-950) 70%);
  min-height: 14rem;
}

.score-loading__header {
  display: grid;
  gap: var(--space-2);
}

.score-loading__title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-xl);
  font-weight: 600;
  color: var(--color-text);
}

.score-loading__status {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.score-loading__bar {
  position: relative;
  height: 0.35rem;
  border-radius: 999px;
  overflow: hidden;
  background: var(--color-iron-800);
}

.score-loading__bar-fill {
  display: block;
  height: 100%;
  width: 40%;
  border-radius: inherit;
  background: linear-gradient(
    90deg,
    transparent,
    color-mix(in srgb, var(--color-gold-300) 80%, transparent),
    transparent
  );
  animation: score-loading-indeterminate 1.4s ease-in-out infinite;
}

.score-loading__ghosts {
  display: grid;
  gap: var(--space-3);
}

.score-loading__grade-ghost {
  width: 5.5rem;
  height: 5.5rem;
  border-radius: var(--radius-card);
  background: var(--color-iron-800);
}

.score-loading__meta-ghosts,
.score-loading__dims {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.score-loading__chip-ghost,
.score-loading__dim-ghost {
  display: block;
  height: 1.75rem;
  border-radius: var(--radius-control);
  background: linear-gradient(
    90deg,
    var(--color-iron-850) 0%,
    var(--color-iron-800) 50%,
    var(--color-iron-850) 100%
  );
  background-size: 200% 100%;
  animation: score-loading-shimmer 1.2s ease-in-out infinite;
}

.score-loading__chip-ghost {
  width: 6.5rem;
}

.score-loading__dim-ghost {
  width: 4.75rem;
  height: 4.75rem;
  border-radius: var(--radius-card);
}

.score-loading__actions {
  display: flex;
  gap: var(--space-2);
}

@keyframes score-loading-indeterminate {
  0% {
    transform: translateX(-120%);
  }
  100% {
    transform: translateX(320%);
  }
}

@keyframes score-loading-shimmer {
  0% {
    background-position: 100% 0;
  }
  100% {
    background-position: -100% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .score-loading__bar-fill,
  .score-loading__chip-ghost,
  .score-loading__dim-ghost {
    animation: none;
  }

  .score-loading__bar-fill {
    width: 100%;
    opacity: 0.55;
    transform: none;
  }
}
</style>
