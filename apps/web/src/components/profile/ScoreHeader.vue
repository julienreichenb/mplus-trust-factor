<script setup lang="ts">
import { computed, ref } from "vue";
import type { CharacterProfileView, JobStatusDTO } from "../../api/types";
import type { CharacterScoreLoadPhase } from "../../lib/characterScoreLoadState";
import { characterScoreLoadStatusMessage } from "../../lib/characterScoreLoadState";
import { humanizeSlug, presentGrade } from "../../lib/characterViewModel";
import { filterDimensionsForModel, formatScore } from "../../lib/format";
import { resolveExternalProfileLinks } from "../../lib/externalProfileLinks";
import { gradeThemeCssVars } from "../../lib/gradeTheme";
import {
  extractRefreshEta,
  formatCoarseWaitRange,
  presentRefreshEtaSummary,
} from "../../lib/refreshEta";
import { classColor } from "../../lib/wowClass";
import TierGradeLetter from "../brand/TierGradeLetter.vue";
import TrustRadarChart from "../charts/TrustRadarChart.vue";
import HeroInsightAccordion from "./HeroInsightAccordion.vue";
import ActiveRerolls from "../character/ActiveRerolls.vue";
import ScoreContextBreakdown from "./ScoreContextBreakdown.vue";
import ScoreContextPopover from "./ScoreContextPopover.vue";
import type { ActiveRerollCharacterDTO } from "@mplus/contracts";

type ScoreLoadUiPhase = Extract<CharacterScoreLoadPhase, "calculating" | "timed_out" | "failed">;

const props = defineProps<{
  profile: CharacterProfileView;
  activeRerolls?: ActiveRerollCharacterDTO[];
  displayedCharacterIsMain?: boolean;
  /** When set, trust/score chrome is skeletonized while identity stays real. */
  scoreLoadPhase?: ScoreLoadUiPhase | null;
  /** First-score ETA source (queue wait / jobs ahead). */
  refreshJob?: JobStatusDTO | null;
}>();

const emit = defineEmits<{
  openBoostAlert: [];
  retryScoreLoad: [];
}>();

const isScoreLoading = computed(() => Boolean(props.scoreLoadPhase));
const isCalculating = computed(() => props.scoreLoadPhase === "calculating");
const isScoreLoadError = computed(
  () => props.scoreLoadPhase === "timed_out" || props.scoreLoadPhase === "failed",
);

const eta = computed(() => extractRefreshEta(props.refreshJob ?? null));
const etaSummary = computed(() => presentRefreshEtaSummary(eta.value));

/** Queue wait only (jobs ahead ÷ throughput), not total completion time. */
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

const scoreLoadTitle = computed(() => {
  if (props.scoreLoadPhase === "timed_out") return "Calculation timed out";
  if (props.scoreLoadPhase === "failed") return "Calculation failed";
  if (waitRange.value) {
    return `Trust Score in progress (queue wait ${waitRange.value})`;
  }
  return "Trust Score in progress";
});

const scoreLoadMessage = computed(() => {
  if (!props.scoreLoadPhase || props.scoreLoadPhase === "calculating") {
    if (waitRange.value) return "Calculating Trust Score…";
    return etaSummary.value.explanation ?? "Calculating Trust Score…";
  }
  return characterScoreLoadStatusMessage(props.scoreLoadPhase);
});

const grade = computed(() => presentGrade(props.profile.score?.grade));
const externalLinks = computed(() => resolveExternalProfileLinks(props.profile));
const visibleDimensions = computed(() =>
  filterDimensionsForModel(
    props.profile.score?.dimensions ?? [],
    props.profile.score?.modelVersion,
  ),
);
const detailsLocked = computed(() => !(props.profile.entitlements?.detailsUnlocked ?? true));
const accentColor = computed(() => gradeThemeCssVars(props.profile.score?.grade)["--color-brand"]);

const partialDimensionsNote = computed(() => {
  if (isScoreLoading.value) return null;
  const dims = props.profile.score?.dimensions ?? [];
  const missing = dims.filter(
    (d) => d.dimension !== "AUTHENTICITY" && (d.state === "UNAVAILABLE" || d.score == null),
  );
  if (missing.length === 0) return null;
  return "Unavailable dimensions are excluded from the overall score; remaining weights are renormalized.";
});

const classSpec = computed(() => {
  const parts = [
    humanizeSlug(props.profile.specSlug),
    humanizeSlug(props.profile.classSlug),
  ].filter(Boolean);
  return parts.join(" ");
});
const roleLabel = computed(() => props.profile.role || null);

const scoreContext = computed(() => props.profile.score?.scoreContext ?? null);

const rawScore = computed(() => {
  const value = scoreContext.value?.rawScoreBeforeContext;
  return value != null && Number.isFinite(value) ? value : null;
});

const showRawScore = computed(() => {
  const raw = rawScore.value;
  const published = props.profile.score?.overallScore;
  if (raw == null || published == null || !Number.isFinite(published)) return false;
  return Math.round(raw) !== Math.round(published);
});

const rawGrade = computed(() => scoreContext.value?.rawGrade ?? null);

const keyFactor = computed(() => {
  const value = scoreContext.value?.keyContext.factor;
  return value != null && Number.isFinite(value) ? value : null;
});

const metaFactor = computed(() => {
  const value = scoreContext.value?.metaContext.factor;
  return value != null && Number.isFinite(value) ? value : null;
});

function factorChipKind(factor: number | null): "bonus" | "malus" | "neutral" {
  if (factor == null || Math.abs(factor - 1) < 0.005) return "neutral";
  return factor > 1 ? "bonus" : "malus";
}

function factorChipLabel(kind: "Key" | "Meta", factor: number | null): string {
  const formatted = factor != null ? factor.toFixed(2) : "1.00";
  return `${kind} ×${formatted}`;
}

const rawBarOpen = ref(false);

const rawBarToggleLabel = computed(() =>
  rawBarOpen.value
    ? "Hide score before key level and meta adjustments"
    : "Show score before key level and meta adjustments",
);

function toggleRawBar(): void {
  rawBarOpen.value = !rawBarOpen.value;
}

const gradeAriaLabel = computed(() => {
  const parts = [`${grade.value.title}: ${grade.value.interpretation}`];
  if (showRawScore.value && rawScore.value != null) {
    parts.push(`Raw Trust Score ${formatScore(rawScore.value, 1)}`);
  }
  return parts.join(", ");
});
</script>

<template>
  <header
    class="score-header"
    data-testid="score-header"
    :data-score-loading="isScoreLoading ? 'true' : undefined"
    :aria-busy="isCalculating ? 'true' : undefined"
  >
    <div
      class="hero-grid"
      :data-testid="isScoreLoading ? 'character-score-loading' : undefined"
      :data-phase="scoreLoadPhase ?? undefined"
    >
      <div class="trust" aria-label="Trust Factor summary" data-testid="score-loading-score-area">
        <template v-if="isScoreLoading">
          <div class="trust__heading">
            <div class="trust__load-status">
              <h2 class="trust__load-title">{{ scoreLoadTitle }}</h2>
              <p class="trust__load-message" role="status">{{ scoreLoadMessage }}</p>
              <p
                v-if="isCalculating && jobsAheadLine"
                class="trust__load-jobs"
                data-testid="score-loading-jobs-ahead"
              >
                {{ jobsAheadLine }}
              </p>
            </div>

            <div
              v-if="isCalculating"
              class="trust__load-bar"
              role="progressbar"
              aria-valuetext="Calculating Trust Score"
              aria-label="Calculating Trust Score"
            >
              <span class="trust__load-bar-fill" />
            </div>

            <div class="trust__header trust__header--skeleton" aria-hidden="true">
              <div
                class="trust__grade-skeleton"
                data-testid="score-loading-grade-skeleton"
              />
              <div class="trust__meta">
                <span class="trust__meta-title-skeleton" />
                <span class="trust__meta-label-skeleton" />
              </div>
              <div class="trust__score-block">
                <span
                  class="trust__score-skeleton"
                  data-testid="score-loading-score-skeleton"
                />
              </div>
            </div>
          </div>

          <div
            class="trust__radar-skeleton"
            data-testid="score-loading-radar-skeleton"
            aria-hidden="true"
          />

          <div v-if="isScoreLoadError" class="trust__load-actions">
            <button
              type="button"
              class="btn"
              data-testid="character-score-loading-retry"
              @click="emit('retryScoreLoad')"
            >
              Retry
            </button>
          </div>
        </template>

        <template v-else>
          <div class="trust__heading">
            <div class="trust__header" role="img" :aria-label="gradeAriaLabel">
              <TierGradeLetter
                class="trust__grade"
                :tier="profile.score?.grade ?? null"
                size="xl"
                surface="panel"
              />
              <div class="trust__meta">
                <span class="trust__meta-title">{{ grade.title }}</span>
                <span class="trust__meta-label">{{ grade.interpretation }}</span>
              </div>
              <div v-if="!grade.isUnrated" class="trust__score-block">
                <div class="trust__value-row">
                  <span class="trust__value mpts-data" data-testid="overall-score">{{
                    formatScore(profile.score?.overallScore, 1)
                  }}</span>
                  <span class="trust__scale">/ 100</span>
                </div>
                <span class="trust__score-caption">Final Trust Score</span>
              </div>
            </div>
            <div
              v-if="showRawScore || (!grade.isUnrated && scoreContext)"
              class="trust__raw-collapse"
            >
              <div class="trust__raw-actions">
                <button
                  v-if="showRawScore"
                  type="button"
                  class="trust__raw-toggle"
                  data-testid="raw-score-toggle"
                  :aria-expanded="rawBarOpen ? 'true' : 'false'"
                  aria-controls="raw-score-bar"
                  @click="toggleRawBar"
                >
                  {{ rawBarToggleLabel }}
                </button>
                <ScoreContextPopover v-if="!grade.isUnrated && scoreContext">
                  <span class="trust__help">?</span>
                  <template #panel>
                    <ScoreContextBreakdown :score="profile.score" />
                  </template>
                </ScoreContextPopover>
              </div>
              <div
                v-if="showRawScore && rawBarOpen"
                id="raw-score-bar"
                class="trust__raw-bar"
                data-testid="raw-score-bar"
              >
                <div class="trust__raw-bar-start">
                  <TierGradeLetter
                    class="trust__raw-grade"
                    :tier="rawGrade"
                    size="sm"
                    surface="panel"
                    data-testid="raw-grade"
                  />
                  <div class="trust__raw-bar-score">
                    <span class="trust__raw-value-row">
                      <span class="trust__raw-value mpts-data" data-testid="raw-score">{{
                        formatScore(rawScore, 1)
                      }}</span>
                      <span class="trust__raw-scale">/ 100</span>
                    </span>
                  </div>
                  <span
                    class="trust__context-chip"
                    :data-kind="factorChipKind(keyFactor)"
                    data-testid="key-context-chip"
                  >
                    {{ factorChipLabel("Key", keyFactor) }}
                  </span>
                  <span
                    class="trust__context-chip"
                    :data-kind="factorChipKind(metaFactor)"
                    data-testid="meta-context-chip"
                  >
                    {{ factorChipLabel("Meta", metaFactor) }}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <TrustRadarChart
            v-if="visibleDimensions.length"
            class="trust__radar"
            embedded
            :series="[
              {
                id: profile.characterId,
                name: profile.displayName,
                dimensions: visibleDimensions,
              },
            ]"
            :model-version="profile.score?.modelVersion"
            :locked="detailsLocked"
            :accent-color="accentColor"
          />
          <p
            v-if="partialDimensionsNote"
            class="trust__partial-note"
            data-testid="partial-dimensions-note"
            :title="partialDimensionsNote"
          >
            {{ partialDimensionsNote }}
          </p>
        </template>
      </div>

      <div class="hero-grid__main" data-testid="score-loading-identity">
        <div class="hero-grid__content">
          <div class="hero-grid__body">
            <div class="identity">
              <div class="identity__eyebrow-row">
                <p class="eyebrow">Character profile</p>
                <nav
                  v-if="externalLinks.length"
                  class="external-links"
                  aria-label="External character profiles"
                >
                  <template v-for="(link, index) in externalLinks" :key="link.id">
                    <span v-if="index > 0" class="external-links__sep" aria-hidden="true">·</span>
                    <a
                      class="external-links__item"
                      :href="link.href"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {{ link.label }}
                      <svg
                        class="external-links__arrow"
                        viewBox="0 0 12 12"
                        width="11"
                        height="11"
                        aria-hidden="true"
                        focusable="false"
                      >
                        <path
                          d="M3.5 2H10v6.5M10 2 2 10"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="1.5"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                      </svg>
                    </a>
                  </template>
                </nav>
              </div>
              <div class="identity__title-row">
                <h1 data-testid="score-loading-name">{{ profile.displayName }}</h1>
                <span
                  v-if="displayedCharacterIsMain"
                  class="main-chip"
                  data-testid="displayed-main-chip"
                  >MAIN</span
                >
                <div class="meta">
                  <p class="meta__server" data-testid="score-loading-realm">
                    {{ profile.realmSlug }} · {{ profile.region }}
                  </p>
                  <p
                    v-if="classSpec"
                    class="meta__class"
                    data-testid="score-loading-class"
                    :style="{ color: classColor(profile.classSlug) }"
                  >
                    {{ classSpec }}
                  </p>
                  <p
                    v-if="roleLabel"
                    class="meta__role"
                    data-testid="score-loading-role"
                  >
                    {{ roleLabel }}
                  </p>
                </div>
              </div>
              <ActiveRerolls v-if="activeRerolls?.length" :characters="activeRerolls" />
            </div>

            <HeroInsightAccordion
              :profile="profile"
              :boost-assessment="profile.boostAssessment"
              :prefer-profile-panels="isScoreLoading"
              @open-boost-alert="emit('openBoostAlert')"
            />
          </div>

          <div
            v-if="profile.seasonSummary?.mythicRating != null"
            class="mythic-score-glass"
            data-testid="score-loading-mythic"
          >
            <span class="mythic-score-glass__label">Mythic+ score</span>
            <span class="mythic-score-glass__value mpts-data">{{
              formatScore(profile.seasonSummary.mythicRating, 2)
            }}</span>
          </div>
          <div
            v-else-if="isScoreLoading"
            class="mythic-score-glass mythic-score-glass--skeleton"
            data-testid="score-loading-mythic-skeleton"
            aria-hidden="true"
          >
            <span class="mythic-score-glass__label-skeleton" />
            <span class="mythic-score-glass__value-skeleton" />
          </div>
        </div>
      </div>
    </div>
  </header>
</template>

<style scoped>
.score-header {
  display: grid;
  gap: var(--space-2);
}

.hero-grid {
  position: relative;
  z-index: 1;
  display: grid;
  gap: var(--space-4);
  align-items: stretch;
  min-height: min(62dvh, 32rem);
}

.trust,
.hero-grid__main {
  position: relative;
  z-index: 1;
  min-width: 0;
}

.hero-grid__main {
  display: grid;
  align-self: stretch;
  min-height: 100%;
  height: 100%;
}

.hero-grid__content {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-5);
  align-items: start;
  align-self: stretch;
  width: 100%;
  height: 100%;
  min-height: 100%;
  min-width: 0;
  padding: 0 0 var(--space-5) 0;
  overflow: visible;
  background: transparent;
}

.hero-grid__body {
  display: grid;
  gap: var(--space-5);
  align-content: start;
  min-width: 0;
}

.mythic-score-glass {
  display: grid;
  gap: 0.1rem;
  justify-self: end;
  align-self: start;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-card);
  border: 1px solid rgb(255 255 255 / 12%);
  background: rgb(13 13 15 / 58%);
  backdrop-filter: blur(18px) saturate(145%);
  -webkit-backdrop-filter: blur(18px) saturate(145%);
  box-shadow:
    0 10px 28px rgb(0 0 0 / 32%),
    inset 0 1px 0 rgb(255 255 255 / 8%);
}

.mythic-score-glass__label {
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-gold-300);
}

.mythic-score-glass__value {
  font-weight: 600;
  font-size: clamp(1.35rem, 2.4vw, 1.75rem);
  color: var(--color-text);
  line-height: 1.15;
}

.identity {
  display: grid;
  gap: var(--space-3);
  align-content: start;
  max-width: 36rem;
}

.identity__eyebrow-row {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  column-gap: var(--space-10);
  width: max-content;
  max-width: min(52rem, calc(100vw - 3rem));
}

.external-links {
  display: inline-flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: var(--space-2);
}

.external-links__sep {
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  line-height: 1;
  user-select: none;
}

.external-links__item {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-family: var(--font-data);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--color-gold-300);
  text-decoration: none;
  white-space: nowrap;
}

.external-links__item:hover,
.external-links__item:focus-visible {
  color: var(--color-brand-hover);
  text-decoration: underline;
  text-underline-offset: 0.15em;
}

.external-links__arrow {
  flex-shrink: 0;
  opacity: 0.85;
}

.eyebrow {
  margin: 0;
  flex: 0 0 auto;
  white-space: nowrap;
  font-family: var(--font-data);
  font-size: var(--text-xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-gold-300);
}

.identity h1 {
  margin: 0;
  overflow-wrap: anywhere;
  font-size: clamp(2rem, 4vw, 3rem);
  text-shadow: 0 2px 18px rgb(0 0 0 / 55%);
}

.identity__title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.55rem 1.75rem;
  min-width: 0;
}

.main-chip {
  display: inline-flex;
  align-items: center;
  padding: 0.15rem 0.4rem;
  border: 1px solid color-mix(in srgb, var(--color-gold-300) 55%, var(--color-border));
  border-radius: var(--radius-control);
  background: color-mix(in srgb, var(--color-gold-300) 14%, transparent);
  color: var(--color-gold-300);
  font-family: var(--font-data);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  line-height: 1.2;
}

.meta {
  display: grid;
  gap: 0.15rem;
  margin: 0;
  min-width: 0;
}

.meta__server {
  margin: 0;
  font-family: var(--font-data);
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-gold-300);
  overflow-wrap: anywhere;
}

.meta__class {
  margin: 0;
  font-size: var(--text-sm);
  font-weight: 700;
  line-height: 1.2;
  overflow-wrap: anywhere;
}

.meta__role {
  margin: 0;
  font-family: var(--font-data);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.trust {
  display: grid;
  grid-template-rows: auto minmax(12rem, 1fr) auto;
  gap: var(--space-3);
  align-content: stretch;
  padding: var(--space-5) var(--space-4) var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-hero);
  background:
    linear-gradient(160deg, rgb(var(--color-rank-rgb) / 7%), transparent 45%), var(--color-surface);
  min-height: 100%;
}

.trust__heading {
  display: grid;
  gap: var(--space-4);
}

.trust__raw-collapse {
  display: grid;
  gap: var(--space-3);
  justify-items: start;
}

.trust__raw-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.trust__raw-actions :deep(.score-pop) {
  display: inline-flex;
  align-items: center;
  justify-self: auto;
}

.trust__raw-actions :deep(.score-pop__trigger) {
  display: inline-flex;
  align-items: center;
}

.trust__help {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: 1.25rem;
  border-radius: 999px;
  border: 1px solid rgb(255 255 255 / 28%);
  background: rgb(255 255 255 / 8%);
  color: var(--color-text);
  font-size: 0.7rem;
  font-weight: 700;
  line-height: 1;
}

.trust__raw-toggle {
  appearance: none;
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
  font-family: var(--font-data);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--color-gold-300);
  text-decoration: underline;
  text-underline-offset: 0.18em;
  text-align: left;
  line-height: 1.35;
}

.trust__raw-toggle:hover,
.trust__raw-toggle:focus-visible {
  color: var(--color-brand-hover);
}

.trust__raw-toggle:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
  border-radius: var(--radius-sm);
}

.trust__raw-bar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.trust__raw-bar-start {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.trust__raw-bar-score {
  margin-left: auto;
  flex-shrink: 0;
}

.trust__raw-value-row {
  display: inline-flex;
  align-items: baseline;
  gap: 0.15rem;
  line-height: 1;
  color: var(--color-text-muted);
}

.trust__raw-value {
  font-family: var(--font-data);
  font-size: var(--text-lg);
  font-weight: 600;
}

.trust__raw-scale {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

.trust__header {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: var(--space-3);
  align-items: center;
}

.trust__score-block {
  display: grid;
  justify-items: end;
  gap: 0.18rem;
  min-width: 0;
}

.trust__score-caption {
  font-family: var(--font-data);
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  line-height: 1.2;
}

.trust__meta {
  display: grid;
  gap: 0.15rem;
  min-width: 0;
}

.trust__meta-title {
  font-family: var(--font-data);
  font-size: var(--text-sm);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.trust__meta-label {
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--color-text);
  line-height: 1.35;
}

.trust__radar {
  min-height: 12rem;
  height: 100%;
  min-width: 0;
  align-self: stretch;
  margin-inline: calc(var(--space-2) * -1);
}

.trust__value-row {
  display: inline-flex;
  align-items: baseline;
  gap: 0.15rem;
  line-height: 1;
  justify-self: end;
}

.trust__value {
  font-size: clamp(2.5rem, 5vw, 3.75rem);
  font-weight: 600;
  line-height: 1;
  color: var(--color-gold-300);
}

.trust__scale {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.trust__context-chip {
  display: inline-flex;
  align-items: baseline;
  padding: 0.2rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: rgb(255 255 255 / 5%);
  font-size: var(--text-xs);
  font-weight: 700;
  white-space: nowrap;
}

.trust__context-chip[data-kind="bonus"] {
  color: var(--color-gold-300);
}

.trust__context-chip[data-kind="malus"] {
  color: #fca5a5;
}

.trust__context-chip[data-kind="neutral"] {
  color: var(--color-text-muted);
}

.trust__partial-note {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  line-height: 1.4;
}

.trust__load-status {
  display: grid;
  gap: var(--space-2);
}

.trust__load-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--color-text);
  line-height: 1.25;
}

.trust__load-message,
.trust__load-jobs {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.trust__load-bar {
  position: relative;
  height: 0.35rem;
  border-radius: 999px;
  overflow: hidden;
  background: var(--color-iron-800);
}

.trust__load-bar-fill {
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
  animation: score-header-indeterminate 1.4s ease-in-out infinite;
}

.trust__header--skeleton {
  align-items: center;
}

.trust__grade-skeleton,
.trust__score-skeleton,
.trust__meta-title-skeleton,
.trust__meta-label-skeleton,
.trust__radar-skeleton,
.mythic-score-glass__label-skeleton,
.mythic-score-glass__value-skeleton {
  border-radius: var(--radius-card);
  background: linear-gradient(
    90deg,
    var(--color-iron-850) 0%,
    var(--color-iron-800) 50%,
    var(--color-iron-850) 100%
  );
  background-size: 200% 100%;
  animation: score-header-shimmer 1.2s ease-in-out infinite;
}

.trust__grade-skeleton {
  width: 5.5rem;
  height: 5.5rem;
}

.trust__score-skeleton {
  width: 5.75rem;
  height: 2.75rem;
}

.trust__meta-title-skeleton {
  display: block;
  width: 5rem;
  height: 0.75rem;
}

.trust__meta-label-skeleton {
  display: block;
  width: 9rem;
  height: 1rem;
  margin-top: 0.35rem;
}

.trust__radar-skeleton {
  min-height: 12rem;
  height: 100%;
  width: 100%;
}

.trust__load-actions {
  display: flex;
  gap: var(--space-2);
}

.mythic-score-glass--skeleton {
  min-width: 7.5rem;
  min-height: 3.75rem;
}

.mythic-score-glass__label-skeleton {
  display: block;
  width: 5.5rem;
  height: 0.7rem;
}

.mythic-score-glass__value-skeleton {
  display: block;
  width: 4.5rem;
  height: 1.5rem;
  margin-top: 0.35rem;
}

@keyframes score-header-indeterminate {
  0% {
    transform: translateX(-120%);
  }
  100% {
    transform: translateX(320%);
  }
}

@keyframes score-header-shimmer {
  0% {
    background-position: 100% 0;
  }
  100% {
    background-position: -100% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .trust__load-bar-fill,
  .trust__grade-skeleton,
  .trust__score-skeleton,
  .trust__meta-title-skeleton,
  .trust__meta-label-skeleton,
  .trust__radar-skeleton,
  .mythic-score-glass__label-skeleton,
  .mythic-score-glass__value-skeleton {
    animation: none;
  }

  .trust__load-bar-fill {
    width: 100%;
    opacity: 0.55;
    transform: none;
  }
}

@media (min-width: 768px) {
  .hero-grid {
    grid-template-columns: minmax(14rem, 40%) minmax(0, 1fr);
    min-height: min(70dvh, 38rem);
  }
}

@media (min-width: 1100px) {
  .hero-grid {
    min-height: min(74dvh, 44rem);
  }
}
</style>
