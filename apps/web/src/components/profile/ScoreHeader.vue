<script setup lang="ts">
import { computed } from "vue";
import type { CharacterProfileView } from "../../api/types";
import {
  humanizeSlug,
  presentGrade,
  resolveDataConfidence,
  topSignals,
  parseContributorSignals,
} from "../../lib/characterViewModel";
import { filterDimensionsForModel, formatPercent, formatScore } from "../../lib/format";
import { resolveExternalProfileLinks } from "../../lib/externalProfileLinks";
import { gradeThemeCssVars } from "../../lib/gradeTheme";
import TrustTierBadge from "../landing/TrustTierBadge.vue";
import TrustRadarChart from "../charts/TrustRadarChart.vue";

const props = defineProps<{
  profile: CharacterProfileView;
}>();

const grade = computed(() => presentGrade(props.profile.score?.grade));
const confidence = computed(() => resolveDataConfidence(props.profile));
const signals = computed(() =>
  props.profile.score?.dimensions ? parseContributorSignals(props.profile.score.dimensions) : [],
);
const positives = computed(() => topSignals(signals.value, "positive", 2));
const risks = computed(() => topSignals(signals.value, "risk", 2));
const externalLinks = computed(() => resolveExternalProfileLinks(props.profile));
const visibleDimensions = computed(() =>
  filterDimensionsForModel(props.profile.score?.dimensions ?? [], props.profile.score?.modelVersion),
);
const detailsLocked = computed(() => !(props.profile.entitlements?.detailsUnlocked ?? true));
const accentColor = computed(() => gradeThemeCssVars(props.profile.score?.grade)["--color-brand"]);

const gradeLabel = computed(() => {
  const g = props.profile.score?.grade;
  const s = props.profile.score?.overallScore;
  if (!g) return "Grade unavailable";
  if (g === "U") return "Grade U (unrated)";
  return `Grade ${g} (${formatScore(s, 0)} Trust Factor)`;
});

const classSpec = computed(() => {
  const parts = [humanizeSlug(props.profile.specSlug), humanizeSlug(props.profile.classSlug)].filter(
    Boolean,
  );
  return parts.join(" ");
});
</script>

<template>
  <header class="score-header" data-testid="score-header">
    <div class="hero-grid">
      <div class="trust" aria-label="Trust Factor summary">
        <TrustTierBadge
          :tier="profile.score?.grade ?? null"
          :label="grade.interpretation"
          size="lg"
        />

        <div class="trust__score">
          <span class="trust__label">Trust Factor</span>
          <div class="trust__value-row">
            <span class="trust__value mpts-data" data-testid="overall-score">{{
              formatScore(profile.score?.overallScore, 0)
            }}</span>
            <span class="trust__scale">/ 100</span>
          </div>
        </div>

        <div class="grade" data-testid="grade" :aria-label="gradeLabel">
          <span class="grade-letter">{{ profile.score?.grade ?? "—" }}</span>
          <span class="grade-text">{{ gradeLabel }}</span>
        </div>

        <dl class="stats">
          <div>
            <dt>Confidence</dt>
            <dd data-testid="confidence">
              {{ confidence == null ? "Unavailable" : formatPercent(confidence, 0) }}
            </dd>
          </div>
          <div>
            <dt>Freshness</dt>
            <dd data-testid="freshness">{{ profile.refreshStatus }}</dd>
          </div>
          <div>
            <dt>Model</dt>
            <dd class="mpts-data">
              {{ profile.score?.modelKey ?? "—" }} v{{ profile.score?.modelVersion ?? "—" }}
            </dd>
          </div>
          <div>
            <dt>Calculated</dt>
            <dd>
              {{
                profile.score?.calculatedAt
                  ? new Date(profile.score.calculatedAt).toLocaleString()
                  : "Unavailable"
              }}
            </dd>
          </div>
        </dl>

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
      </div>

      <div class="hero-grid__main">
        <div class="hero-grid__content">
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
            <h1>{{ profile.displayName }}</h1>
            <p class="meta">
              <span>{{ profile.realmSlug }} · {{ profile.region }}</span>
              <span v-if="classSpec"> · {{ classSpec }}</span>
              <span v-if="profile.role"> · {{ profile.role }}</span>
            </p>
            <dl class="facts">
              <div v-if="profile.itemLevel != null">
                <dt>Item level</dt>
                <dd class="mpts-data">{{ profile.itemLevel }}</dd>
              </div>
              <div v-if="profile.seasonSummary?.mythicRating != null">
                <dt>Mythic+ rating</dt>
                <dd class="mpts-data">{{ profile.seasonSummary.mythicRating }}</dd>
              </div>
              <div v-if="profile.seasonSummary">
                <dt>Season runs</dt>
                <dd class="mpts-data">{{ profile.seasonSummary.runCount }}</dd>
              </div>
              <div>
                <dt>Refresh</dt>
                <dd>{{ profile.refreshStatus }}</dd>
              </div>
            </dl>
          </div>

          <div class="key-signals" aria-label="Top signals">
            <div>
              <h2 class="key-signals__title">Top positives</h2>
              <ul v-if="positives.length">
                <li v-for="(item, index) in positives" :key="`p-${index}`">{{ item.label }}</li>
              </ul>
              <p v-else class="empty">Unavailable in this snapshot</p>
            </div>
            <div>
              <h2 class="key-signals__title">Top risks</h2>
              <ul v-if="risks.length">
                <li v-for="(item, index) in risks" :key="`r-${index}`">{{ item.label }}</li>
              </ul>
              <p v-else class="empty">Unavailable in this snapshot</p>
            </div>
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
  gap: var(--space-5);
  align-content: start;
  align-self: stretch;
  width: 100%;
  height: 100%;
  min-height: 100%;
  min-width: 0;
  padding: var(--space-5) var(--space-5) var(--space-5) 0;
  overflow: visible;
  background: linear-gradient(
    90deg,
    rgb(7 7 7 / 55%) 0%,
    rgb(7 7 7 / 28%) 55%,
    transparent 100%
  );
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

.meta {
  margin: 0;
  color: var(--color-text-muted);
  text-transform: capitalize;
  overflow-wrap: anywhere;
}

.facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
  margin: var(--space-2) 0 0;
}

.facts dt {
  font-size: var(--text-xs);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.facts dd {
  margin: var(--space-1) 0 0;
  font-weight: 600;
}

.trust {
  display: grid;
  grid-template-rows: auto auto auto auto minmax(12rem, 1fr);
  gap: var(--space-3);
  align-content: stretch;
  padding: var(--space-5) var(--space-4) var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-hero);
  background:
    linear-gradient(160deg, rgb(var(--color-rank-rgb) / 7%), transparent 45%),
    var(--color-surface);
  min-height: 100%;
}

.trust__radar {
  min-height: 12rem;
  height: 100%;
  min-width: 0;
  align-self: stretch;
  margin-inline: calc(var(--space-2) * -1);
}

.trust__label {
  display: block;
  font-size: var(--text-xs);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.trust__value {
  font-size: clamp(2.5rem, 5vw, 3.75rem);
  font-weight: 600;
  line-height: 1;
  color: var(--color-gold-300);
}

.trust__scale {
  color: var(--color-text-muted);
  margin-left: var(--space-1);
}

.grade {
  display: flex;
  gap: var(--space-3);
  align-items: center;
}

.grade-letter {
  min-width: 2.5rem;
  text-align: center;
  font-family: var(--font-display);
  font-size: var(--text-xl);
  font-weight: 700;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  padding: 0.2rem 0.45rem;
  background: var(--color-obsidian-900);
  color: var(--color-gold-300);
}

.grade-text {
  font-size: var(--text-sm);
  color: var(--color-text);
}

.stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
  margin: 0;
}

.stats dt {
  font-size: var(--text-xs);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.stats dd {
  margin: var(--space-1) 0 0;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.key-signals {
  display: grid;
  gap: var(--space-4);
  max-width: 36rem;
  padding-top: var(--space-3);
  border-top: 1px solid rgb(255 255 255 / 12%);
}

.key-signals__title {
  margin: 0 0 var(--space-2);
  font-family: var(--font-body);
  font-size: var(--text-sm);
  font-weight: 700;
}

.key-signals ul {
  margin: 0;
  padding-left: 1.1rem;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  display: grid;
  gap: var(--space-1);
}

.empty {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

@media (min-width: 768px) {
  .hero-grid {
    grid-template-columns: minmax(14rem, 33%) minmax(0, 1fr);
    min-height: min(70dvh, 38rem);
  }

  .key-signals {
    grid-template-columns: 1fr 1fr;
  }
}

@media (min-width: 1100px) {
  .hero-grid {
    min-height: min(74dvh, 44rem);
  }

  .facts {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
</style>
