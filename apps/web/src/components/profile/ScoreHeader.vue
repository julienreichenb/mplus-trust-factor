<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import type { CharacterProfileView } from "../../api/types";
import {
  humanizeSlug,
  presentGrade,
  resolveDataConfidence,
  topSignals,
  parseContributorSignals,
} from "../../lib/characterViewModel";
import { formatPercent, formatScore } from "../../lib/format";
import TrustTierBadge from "../landing/TrustTierBadge.vue";
import CharacterMediaPanel from "../character/CharacterMediaPanel.vue";

const props = defineProps<{
  profile: CharacterProfileView;
  refreshing?: boolean;
}>();

const emit = defineEmits<{
  refresh: [];
}>();

const grade = computed(() => presentGrade(props.profile.score?.grade));
const confidence = computed(() => resolveDataConfidence(props.profile));
const signals = computed(() =>
  props.profile.score?.dimensions ? parseContributorSignals(props.profile.score.dimensions) : [],
);
const positives = computed(() => topSignals(signals.value, "positive", 2));
const risks = computed(() => topSignals(signals.value, "risk", 2));

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
    <div class="toolbar">
      <RouterLink class="back" to="/#character-search">← Back to character search</RouterLink>
      <div class="toolbar__actions">
        <span class="refresh-state mpts-data">{{ profile.refreshStatus }}</span>
        <button
          type="button"
          class="btn secondary"
          data-testid="refresh-button"
          :disabled="refreshing || profile.refreshStatus === 'QUEUED'"
          @click="emit('refresh')"
        >
          {{ refreshing || profile.refreshStatus === "QUEUED" ? "Refreshing…" : "Refresh data" }}
        </button>
      </div>
    </div>

    <div class="hero-grid">
      <CharacterMediaPanel
        class="media"
        :class-slug="profile.classSlug"
        :spec-slug="profile.specSlug"
        :role="profile.role"
        :display-name="profile.displayName"
      />

      <div class="identity">
        <p class="eyebrow">Character profile</p>
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
  </header>
</template>

<style scoped>
.score-header {
  display: grid;
  gap: var(--space-5);
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  justify-content: space-between;
  align-items: center;
}

.back {
  font-weight: 600;
  text-decoration: none;
  color: var(--color-gold-300);
}

.back:hover,
.back:focus-visible {
  color: var(--color-brand-hover);
  text-decoration: underline;
}

.toolbar__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: center;
}

.refresh-state {
  font-size: var(--text-xs);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  padding: 0.25rem 0.5rem;
}

.hero-grid {
  display: grid;
  gap: var(--space-5);
}

.identity {
  display: grid;
  gap: var(--space-3);
  align-content: start;
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
  padding: var(--space-5);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-hero);
  background:
    linear-gradient(160deg, rgb(245 158 11 / 7%), transparent 45%),
    var(--color-surface);
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
  border-top: 1px solid var(--color-border);
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
    grid-template-columns: 11rem 1fr;
    align-items: start;
  }

  .media {
    grid-row: span 1;
  }

  .trust {
    grid-column: 1 / -1;
  }

  .key-signals {
    grid-template-columns: 1fr 1fr;
  }

  .stats {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@media (min-width: 1100px) {
  .hero-grid {
    grid-template-columns: 14rem minmax(0, 1.1fr) minmax(18rem, 0.95fr);
  }

  .trust {
    grid-column: auto;
  }
}
</style>
