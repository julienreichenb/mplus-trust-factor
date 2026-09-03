<script setup lang="ts">
import { computed } from "vue";
import type { CharacterProfileView, JobStatusDTO } from "../../api/types";
import type { CharacterScoreLoadPhase } from "../../lib/characterScoreLoadState";
import { characterScoreLoadStatusMessage } from "../../lib/characterScoreLoadState";
import { humanizeSlug } from "../../lib/characterViewModel";
import { resolveExternalProfileLinks } from "../../lib/externalProfileLinks";
import {
  extractRefreshEta,
  formatCoarseWaitRange,
  presentRefreshEtaSummary,
} from "../../lib/refreshEta";
import { classColor } from "../../lib/wowClass";
import { formatScore } from "../../lib/format";
import HeroGearPanel from "../profile/HeroGearPanel.vue";
import HeroTalentPanel from "../profile/HeroTalentPanel.vue";

const props = defineProps<{
  phase: Extract<CharacterScoreLoadPhase, "calculating" | "timed_out" | "failed">;
  profile?: CharacterProfileView | null;
  /** Refresh job carrying ETA fields (queue wait / jobs ahead). */
  job?: JobStatusDTO | null;
}>();

const emit = defineEmits<{
  retry: [];
}>();

const isCalculating = computed(() => props.phase === "calculating");
const isError = computed(() => props.phase === "timed_out" || props.phase === "failed");

const eta = computed(() => extractRefreshEta(props.job ?? null));
const etaSummary = computed(() => presentRefreshEtaSummary(eta.value));

/**
 * Queue-wait estimate only (jobs ahead ÷ throughput), not total completion time.
 * Omit when missing or when estimate confidence is LOW.
 */
const waitRange = computed(() => {
  if (!eta.value || eta.value.estimateConfidence === "LOW") return null;
  return formatCoarseWaitRange(eta.value.estimatedWaitSeconds);
});
const jobsAheadLine = computed(() => {
  const n = eta.value?.queuePosition;
  if (n == null || !Number.isFinite(n)) return null;
  const jobs = Math.max(0, Math.floor(n));
  if (jobs === 0) return "Approximately no jobs ahead";
  return `Approximately ${jobs} job${jobs === 1 ? "" : "s"} ahead`;
});

const title = computed(() => {
  if (props.phase === "timed_out") return "Calculation timed out";
  if (props.phase === "failed") return "Calculation failed";
  if (waitRange.value) {
    return `Trust Score in progress (queue wait ${waitRange.value})`;
  }
  return "Trust Score in progress";
});

const message = computed(() => {
  if (props.phase !== "calculating") return characterScoreLoadStatusMessage(props.phase);
  if (waitRange.value) return "Calculating Trust Score…";
  return etaSummary.value.explanation ?? "Calculating Trust Score…";
});

const displayName = computed(() => props.profile?.displayName?.trim() || null);
const realmRegion = computed(() => {
  if (!props.profile) return null;
  return `${props.profile.realmSlug} · ${props.profile.region}`;
});
const classSpec = computed(() => {
  if (!props.profile) return null;
  const parts = [
    humanizeSlug(props.profile.specSlug),
    humanizeSlug(props.profile.classSlug),
  ].filter(Boolean);
  return parts.join(" ") || null;
});
const roleLabel = computed(() => {
  const role = props.profile?.role;
  if (!role) return null;
  return role;
});
const externalLinks = computed(() =>
  props.profile ? resolveExternalProfileLinks(props.profile) : [],
);
const mythicRating = computed(() => {
  const value = props.profile?.seasonSummary?.mythicRating;
  return value != null && Number.isFinite(value) ? value : null;
});
const hasEquipment = computed(() => (props.profile?.equipment?.items?.length ?? 0) > 0);
const hasTalents = computed(() => Boolean(props.profile?.talents?.summary || props.profile?.talents?.loadoutCode));
</script>

<template>
  <section
    class="score-loading"
    data-testid="character-score-loading"
    :data-phase="phase"
    :aria-busy="isCalculating ? 'true' : 'false'"
    aria-live="polite"
  >
    <div class="score-loading__grid">
      <div class="score-loading__score" data-testid="score-loading-score-area">
        <div class="score-loading__header">
          <h2 class="score-loading__title">{{ title }}</h2>
          <p class="score-loading__status" role="status">{{ message }}</p>
          <p
            v-if="isCalculating && jobsAheadLine"
            class="score-loading__eta"
            data-testid="score-loading-jobs-ahead"
          >
            {{ jobsAheadLine }}
          </p>
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
          <div class="score-loading__grade-ghost" data-testid="score-loading-grade-skeleton" />
          <div class="score-loading__radar-ghost" data-testid="score-loading-radar-skeleton" />
          <div class="score-loading__dims">
            <span v-for="n in 4" :key="n" class="score-loading__dim-ghost" />
          </div>
        </div>

        <div v-if="isError" class="score-loading__actions">
          <button
            type="button"
            class="btn"
            data-testid="character-score-loading-retry"
            @click="emit('retry')"
          >
            Retry
          </button>
        </div>
      </div>

      <div
        v-if="profile"
        class="score-loading__identity"
        data-testid="score-loading-identity"
      >
        <p class="score-loading__eyebrow">Character profile</p>
        <nav
          v-if="externalLinks.length"
          class="score-loading__links"
          aria-label="External character profiles"
        >
          <template v-for="(link, index) in externalLinks" :key="link.id">
            <span v-if="index > 0" class="score-loading__sep" aria-hidden="true">·</span>
            <a
              class="score-loading__link"
              :href="link.href"
              target="_blank"
              rel="noopener noreferrer"
            >
              {{ link.label }}
            </a>
          </template>
        </nav>
        <h3 v-if="displayName" class="score-loading__name" data-testid="score-loading-name">
          {{ displayName }}
        </h3>
        <p v-if="realmRegion" class="score-loading__realm" data-testid="score-loading-realm">
          {{ realmRegion }}
        </p>
        <p
          v-if="classSpec"
          class="score-loading__class"
          data-testid="score-loading-class"
          :style="{ color: classColor(profile.classSlug) }"
        >
          {{ classSpec }}
        </p>
        <p v-if="roleLabel" class="score-loading__role" data-testid="score-loading-role">
          {{ roleLabel }}
        </p>
        <p
          v-if="mythicRating != null"
          class="score-loading__mythic"
          data-testid="score-loading-mythic"
        >
          Mythic+ score {{ formatScore(mythicRating, 2) }}
        </p>
        <div
          v-if="hasEquipment"
          class="score-loading__gear"
          data-testid="score-loading-equipment"
        >
          <HeroGearPanel :equipment="profile.equipment" />
        </div>
        <div
          v-if="hasTalents"
          class="score-loading__talents"
          data-testid="score-loading-talents"
        >
          <HeroTalentPanel :talents="profile.talents" />
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.score-loading {
  position: relative;
  z-index: 1;
  display: grid;
  gap: var(--space-4);
  padding: var(--space-5) var(--space-4) var(--space-5);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-hero);
  background:
    radial-gradient(circle at 12% 0%, rgb(var(--color-rank-rgb) / 12%), transparent 42%),
    linear-gradient(165deg, var(--color-iron-850), var(--color-obsidian-950) 70%);
  min-height: min(62dvh, 32rem);
}

.score-loading__grid {
  display: grid;
  gap: var(--space-5);
  align-items: start;
}

.score-loading__score,
.score-loading__identity {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
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

.score-loading__status,
.score-loading__eta {
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

.score-loading__radar-ghost {
  width: min(100%, 14rem);
  height: 10rem;
  border-radius: var(--radius-card);
  background: linear-gradient(
    90deg,
    var(--color-iron-850) 0%,
    var(--color-iron-800) 50%,
    var(--color-iron-850) 100%
  );
  background-size: 200% 100%;
  animation: score-loading-shimmer 1.2s ease-in-out infinite;
}

.score-loading__dims {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.score-loading__dim-ghost {
  display: block;
  width: 4.75rem;
  height: 4.75rem;
  border-radius: var(--radius-card);
  background: linear-gradient(
    90deg,
    var(--color-iron-850) 0%,
    var(--color-iron-800) 50%,
    var(--color-iron-850) 100%
  );
  background-size: 200% 100%;
  animation: score-loading-shimmer 1.2s ease-in-out infinite;
}

.score-loading__actions {
  display: flex;
  gap: var(--space-2);
}

.score-loading__eyebrow {
  margin: 0;
  font-family: var(--font-data);
  font-size: var(--text-xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-gold-300);
}

.score-loading__links {
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
}

.score-loading__sep {
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}

.score-loading__link {
  color: var(--color-gold-300);
  font-size: var(--text-xs);
  font-weight: 600;
  text-decoration: none;
}

.score-loading__link:hover,
.score-loading__link:focus-visible {
  text-decoration: underline;
}

.score-loading__name {
  margin: 0;
  font-size: clamp(1.75rem, 3.5vw, 2.5rem);
  overflow-wrap: anywhere;
}

.score-loading__realm,
.score-loading__role,
.score-loading__mythic {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.score-loading__class {
  margin: 0;
  font-size: var(--text-sm);
  font-weight: 700;
}

.score-loading__gear,
.score-loading__talents {
  min-width: 0;
}

@media (min-width: 768px) {
  .score-loading {
    min-height: min(70dvh, 38rem);
  }

  .score-loading__grid {
    grid-template-columns: minmax(14rem, 40%) minmax(0, 1fr);
  }

  .score-loading__identity {
    max-width: 28rem;
    padding-right: min(42%, 16rem);
  }
}

@media (min-width: 1100px) {
  .score-loading {
    min-height: min(74dvh, 44rem);
  }

  .score-loading__identity {
    padding-right: min(40%, 18rem);
  }
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
  .score-loading__radar-ghost,
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
