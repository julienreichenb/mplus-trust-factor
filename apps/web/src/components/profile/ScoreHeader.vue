<script setup lang="ts">
import { computed } from "vue";
import type { CharacterProfileView } from "../../api/types";
import { humanizeSlug, presentGrade, resolveDataConfidence } from "../../lib/characterViewModel";
import { filterDimensionsForModel, formatPercent, formatScore } from "../../lib/format";
import { resolveExternalProfileLinks } from "../../lib/externalProfileLinks";
import { gradeThemeCssVars } from "../../lib/gradeTheme";
import { classColor } from "../../lib/wowClass";
import TierGradeLetter from "../brand/TierGradeLetter.vue";
import MetaChip from "../common/MetaChip.vue";
import TrustRadarChart from "../charts/TrustRadarChart.vue";
import HeroInsightAccordion from "./HeroInsightAccordion.vue";
import ActiveRerolls from "../character/ActiveRerolls.vue";
import type { ActiveRerollCharacterDTO } from "@mplus/contracts";

const props = defineProps<{
  profile: CharacterProfileView;
  activeRerolls?: ActiveRerollCharacterDTO[];
  displayedCharacterIsMain?: boolean;
}>();

const grade = computed(() => presentGrade(props.profile.score?.grade));
const confidence = computed(() => resolveDataConfidence(props.profile));
const externalLinks = computed(() => resolveExternalProfileLinks(props.profile));
const visibleDimensions = computed(() =>
  filterDimensionsForModel(
    props.profile.score?.dimensions ?? [],
    props.profile.score?.modelVersion,
  ),
);
const detailsLocked = computed(() => !(props.profile.entitlements?.detailsUnlocked ?? true));
const accentColor = computed(() => gradeThemeCssVars(props.profile.score?.grade)["--color-brand"]);

const calculatedLabel = computed(() => {
  const at = props.profile.score?.calculatedAt;
  return at ? new Date(at).toLocaleString() : "Unavailable";
});

const modelLabel = computed(() => {
  const key = props.profile.score?.modelKey ?? "—";
  const version = props.profile.score?.modelVersion ?? "—";
  return `${key} v${version}`;
});

const confidenceLabel = computed(() =>
  confidence.value == null ? "Unavailable" : formatPercent(confidence.value, 0),
);

const classSpec = computed(() => {
  const parts = [
    humanizeSlug(props.profile.specSlug),
    humanizeSlug(props.profile.classSlug),
  ].filter(Boolean);
  return parts.join(" ");
});
</script>

<template>
  <header class="score-header" data-testid="score-header">
    <div class="hero-grid">
      <div class="trust" aria-label="Trust Factor summary">
        <div
          class="trust__header"
          role="img"
          :aria-label="`${grade.title}: ${grade.interpretation}`"
        >
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
          <div v-if="!grade.isUnrated" class="trust__value-row">
            <span class="trust__value mpts-data" data-testid="overall-score">{{
              formatScore(profile.score?.overallScore, 0)
            }}</span>
            <span class="trust__scale">/ 100</span>
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

        <div class="trust__stats" role="list" aria-label="Score metadata">
          <MetaChip
            role="listitem"
            label="Confidence"
            :value="confidenceLabel"
            data-testid="confidence"
          />
          <MetaChip role="listitem" label="Model" :value="modelLabel" value-class="mpts-data" />
          <MetaChip role="listitem" label="Calculated" :value="calculatedLabel" />
        </div>
      </div>

      <div class="hero-grid__main">
        <div class="hero-grid__content">
          <div class="hero-grid__body">
            <div class="identity">
              <div class="identity__eyebrow-row">
                <p class="eyebrow">Character profile</p>
                <nav class="external-links" aria-label="External character profiles">
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
                <h1>{{ profile.displayName }}</h1>
                <span
                  v-if="displayedCharacterIsMain"
                  class="main-chip"
                  data-testid="displayed-main-chip"
                >MAIN</span>
                <div class="meta">
                  <p class="meta__server">{{ profile.realmSlug }} · {{ profile.region }}</p>
                  <p
                    v-if="classSpec"
                    class="meta__class"
                    :style="{ color: classColor(profile.classSlug) }"
                  >
                    {{ classSpec }}
                  </p>
                </div>
              </div>
              <ActiveRerolls
                v-if="activeRerolls?.length"
                :characters="activeRerolls"
              />
            </div>

            <HeroInsightAccordion :profile="profile" />
          </div>

          <div v-if="profile.seasonSummary?.mythicRating != null" class="mythic-score-glass">
            <span class="mythic-score-glass__label">Mythic+ score</span>
            <span class="mythic-score-glass__value mpts-data">{{
              formatScore(profile.seasonSummary.mythicRating, 2)
            }}</span>
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

.trust__header {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: var(--space-3);
  align-items: center;
}

.trust__grade {
  grid-row: 1 / span 1;
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
  color: var(--color-text-muted);
  font-size: var(--text-base);
  font-weight: 600;
}

.trust__stats {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: 0;
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
