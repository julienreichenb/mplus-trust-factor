<script setup lang="ts">
import { computed } from "vue";
import type { CharacterProfileView } from "../../api/types";
import { formatPercent, formatScore } from "../../lib/format";

const props = defineProps<{
  profile: CharacterProfileView;
  refreshing?: boolean;
}>();

const emit = defineEmits<{
  refresh: [];
}>();

const gradeLabel = computed(() => {
  const g = props.profile.score?.grade;
  const s = props.profile.score?.overallScore;
  if (!g) return "Grade unavailable";
  return `Grade ${g} (${formatScore(s, 0)} Trust Factor)`;
});
</script>

<template>
  <header class="profile-header" data-testid="score-header">
    <div class="identity">
      <h1>{{ profile.displayName }}</h1>
      <p class="meta">
        {{ profile.realmSlug }} · {{ profile.region }}
        <span v-if="profile.classSlug"> · {{ profile.classSlug }}</span>
        <span v-if="profile.specSlug"> / {{ profile.specSlug }}</span>
        <span v-if="profile.role"> · {{ profile.role }}</span>
        <span v-if="profile.itemLevel != null"> · ilvl {{ profile.itemLevel }}</span>
      </p>
    </div>

    <div class="score-block" aria-label="Trust Factor summary">
      <div class="trust">
        <span class="trust-label">Trust Factor</span>
        <span class="trust-value" data-testid="overall-score">{{
          formatScore(profile.score?.overallScore, 0)
        }}</span>
        <span class="trust-scale">/ 100</span>
      </div>
      <div class="grade" data-testid="grade" :aria-label="gradeLabel">
        <span class="grade-letter">{{ profile.score?.grade ?? "—" }}</span>
        <span class="grade-text">{{ gradeLabel }}</span>
      </div>
      <dl class="stats">
        <div>
          <dt>Confidence</dt>
          <dd data-testid="confidence">{{ formatPercent(profile.dataConfidence ?? (profile.score?.confidence != null ? profile.score.confidence * 100 : null), 0) }}</dd>
        </div>
        <div>
          <dt>Freshness</dt>
          <dd data-testid="freshness">{{ profile.refreshStatus }}</dd>
        </div>
        <div>
          <dt>Calculated</dt>
          <dd>{{ profile.score?.calculatedAt ? new Date(profile.score.calculatedAt).toLocaleString() : "—" }}</dd>
        </div>
      </dl>
      <button
        type="button"
        class="btn"
        data-testid="refresh-button"
        :disabled="refreshing || profile.refreshStatus === 'QUEUED'"
        @click="emit('refresh')"
      >
        {{ refreshing || profile.refreshStatus === "QUEUED" ? "Refreshing…" : "Refresh" }}
      </button>
    </div>
  </header>
</template>

<style scoped>
.profile-header {
  display: grid;
  gap: 1rem;
  grid-template-columns: 1fr;
}

@media (min-width: 800px) {
  .profile-header {
    grid-template-columns: 1.2fr 1fr;
    align-items: start;
  }
}

.identity h1 {
  margin: 0;
  font-size: clamp(1.6rem, 3vw, 2.2rem);
  font-family: var(--font-display);
}

.meta {
  color: var(--muted);
  margin: 0.35rem 0 0;
  text-transform: capitalize;
}

.score-block {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1rem;
  display: grid;
  gap: 0.75rem;
}

.trust-label {
  display: block;
  font-size: 0.8rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--muted);
}

.trust-value {
  font-size: 2.75rem;
  font-weight: 700;
  font-family: var(--font-display);
  line-height: 1;
  color: var(--accent);
}

.trust-scale {
  color: var(--muted);
  margin-left: 0.25rem;
}

.grade {
  display: flex;
  gap: 0.75rem;
  align-items: center;
}

.grade-letter {
  font-size: 1.75rem;
  font-weight: 700;
  min-width: 2.5rem;
  text-align: center;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.15rem 0.4rem;
  background: var(--panel-2);
}

.grade-text {
  font-size: 0.95rem;
}

.stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;
  margin: 0;
}

.stats dt {
  font-size: 0.7rem;
  text-transform: uppercase;
  color: var(--muted);
  margin: 0;
}

.stats dd {
  margin: 0.15rem 0 0;
  font-weight: 600;
}
</style>
