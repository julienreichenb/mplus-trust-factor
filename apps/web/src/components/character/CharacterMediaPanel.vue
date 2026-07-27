<script setup lang="ts">
import { computed } from "vue";
import { humanizeSlug } from "../../lib/characterViewModel";

const props = defineProps<{
  classSlug?: string | null;
  specSlug?: string | null;
  role?: string | null;
  displayName?: string | null;
}>();

const caption = computed(() => {
  const parts = [
    humanizeSlug(props.specSlug),
    humanizeSlug(props.classSlug),
    props.role ? props.role.toUpperCase() : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Character media unavailable";
});
</script>

<template>
  <div class="media-panel" data-testid="character-media">
    <div class="media-panel__frame" aria-hidden="true">
      <div class="media-panel__glow" />
      <div class="media-panel__silhouette" :data-role="role ?? 'unknown'" />
      <span class="media-panel__mark">M+TS</span>
    </div>
    <p class="media-panel__caption">
      <span class="media-panel__status">Media placeholder</span>
      <span>{{ caption }}</span>
    </p>
    <p class="sr-only">
      Character render is not available in this phase. Placeholder shown for
      {{ displayName ?? "this character" }}.
    </p>
  </div>
</template>

<style scoped>
.media-panel {
  display: grid;
  gap: var(--space-3);
}

.media-panel__frame {
  position: relative;
  aspect-ratio: 3 / 4;
  min-height: 14rem;
  border-radius: var(--radius-hero);
  border: 1px solid var(--color-border);
  overflow: hidden;
  background:
    radial-gradient(circle at 50% 18%, rgb(245 158 11 / 16%), transparent 42%),
    linear-gradient(165deg, var(--color-iron-800), var(--color-obsidian-950) 58%);
}

.media-panel__glow {
  position: absolute;
  inset: auto 18% 12% 18%;
  height: 28%;
  border-radius: 50%;
  background: rgb(245 158 11 / 18%);
  filter: blur(18px);
}

.media-panel__silhouette {
  position: absolute;
  inset: 18% 28% 16% 28%;
  background: rgb(241 233 219 / 18%);
  clip-path: polygon(50% 0%, 78% 14%, 72% 38%, 88% 100%, 12% 100%, 28% 38%, 22% 14%);
}

.media-panel__silhouette[data-role="TANK"] {
  background: rgb(56 189 248 / 22%);
}

.media-panel__silhouette[data-role="HEALER"] {
  background: rgb(163 230 53 / 20%);
}

.media-panel__mark {
  position: absolute;
  left: var(--space-3);
  bottom: var(--space-3);
  font-family: var(--font-data);
  font-size: var(--text-xs);
  letter-spacing: 0.08em;
  color: rgb(244 213 141 / 70%);
}

.media-panel__caption {
  margin: 0;
  display: grid;
  gap: var(--space-1);
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.media-panel__status {
  font-family: var(--font-data);
  font-size: var(--text-xs);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-gold-300);
}

@media (prefers-reduced-motion: reduce) {
  .media-panel__glow {
    filter: none;
  }
}
</style>
