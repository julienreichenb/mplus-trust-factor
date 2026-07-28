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
import { formatPercent, formatScore } from "../../lib/format";
import { resolveExternalProfileLinks } from "../../lib/externalProfileLinks";
import TrustTierBadge from "../landing/TrustTierBadge.vue";
import CharacterMediaPanel from "../character/CharacterMediaPanel.vue";

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
      <div class="hero-grid__stage" aria-hidden="true">
        <div class="hero-grid__glow" />
        <CharacterMediaPanel class="media" :profile="profile" variant="bare" />
      </div>

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
      </div>

      <div class="hero-grid__main">
        <div class="hero-grid__content">
          <div class="identity">
            <p class="eyebrow">Character profile</p>
            <div class="identity__title-row">
              <h1>{{ profile.displayName }}</h1>
              <nav class="external-links" aria-label="External character profiles">
                <a
                  v-for="link in externalLinks"
                  :key="link.id"
                  class="external-links__item"
                  :href="link.href"
                  :title="link.label"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <img :src="link.logo" :alt="link.logoAlt" width="20" height="20" />
                  <span class="sr-only">{{ link.label }}</span>
                </a>
              </nav>
            </div>
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
  overflow: visible;
}

.hero-grid {
  position: relative;
  display: grid;
  gap: var(--space-4);
  align-items: stretch;
  isolation: isolate;
  min-height: min(62dvh, 32rem);
  overflow: visible;
}

/* Right-hand portrait column — glow + model share the same center. */
.hero-grid__stage {
  position: absolute;
  z-index: 0;
  top: 0;
  right: 0;
  bottom: 0;
  left: 58%;
  pointer-events: none;
  display: grid;
  place-items: center;
}

.hero-grid__glow {
  position: absolute;
  z-index: 0;
  inset: 8% 4% 4% 8%;
  border-radius: 50%;
  background: radial-gradient(
    circle at 50% 52%,
    rgb(var(--color-rank-rgb) / 52%) 0%,
    rgb(var(--color-rank-rgb) / 22%) 38%,
    transparent 70%
  );
  filter: blur(34px);
}

.media {
  position: relative;
  z-index: 1;
  width: min(100%, 28rem);
  height: 100%;
  max-height: 100%;
  justify-self: center;
}

.hero-grid__stage :deep(.media-panel--bare),
.hero-grid__stage :deep(.media-panel--bare .media-panel__frame) {
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: visible;
}

.hero-grid__stage :deep(.media-panel--bare .media-panel__image) {
  width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: center bottom;
  transform: scale(1.45);
  transform-origin: center bottom;
}

.hero-grid__stage :deep(.media-panel--bare .media-panel__silhouette) {
  inset: 8% 22% 2% 22%;
}

.hero-grid__stage :deep(.media-panel--bare .media-panel__glow) {
  inset: auto 18% 2% 18%;
  height: 32%;
}

.trust,
.hero-grid__main {
  position: relative;
  z-index: 1;
  min-width: 0;
}

.hero-grid__main {
  min-height: 100%;
  display: grid;
}

.hero-grid__content {
  display: grid;
  gap: var(--space-5);
  align-content: start;
  height: 100%;
  padding: var(--space-5) var(--space-5) var(--space-5) 0;
  max-width: min(100%, 28rem);
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
}

.identity__title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}

.external-links {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.external-links__item {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border-radius: var(--radius-control);
  border: 1px solid var(--color-border);
  background: rgb(13 13 15 / 72%);
  transition:
    border-color var(--duration-fast) ease,
    background-color var(--duration-fast) ease;
}

.external-links__item:hover,
.external-links__item:focus-visible {
  border-color: var(--color-gold-300);
  background: var(--color-surface-hover);
}

.external-links__item img {
  width: 1.15rem;
  height: 1.15rem;
  object-fit: contain;
}

.eyebrow {
  margin: 0;
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
  gap: var(--space-4);
  align-content: start;
  padding: var(--space-5);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-hero);
  background:
    linear-gradient(160deg, rgb(var(--color-rank-rgb) / 7%), transparent 45%),
    var(--color-surface);
  min-height: 100%;
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

  .hero-grid__stage {
    left: 52%;
  }

  .hero-grid__stage :deep(.media-panel--bare .media-panel__image) {
    transform: scale(1.65);
  }

  .media {
    width: min(100%, 34rem);
  }

  .key-signals {
    grid-template-columns: 1fr 1fr;
  }
}

@media (min-width: 1100px) {
  .hero-grid {
    min-height: min(74dvh, 44rem);
  }

  .hero-grid__stage {
    left: 50%;
  }

  .hero-grid__stage :deep(.media-panel--bare .media-panel__image) {
    transform: scale(1.85);
  }

  .media {
    width: min(100%, 40rem);
  }

  .facts {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@media (prefers-reduced-motion: reduce) {
  .hero-grid__glow {
    filter: blur(14px);
  }

  .hero-grid__stage :deep(.media-panel--bare .media-panel__image) {
    transform: scale(1.25);
  }
}
</style>
