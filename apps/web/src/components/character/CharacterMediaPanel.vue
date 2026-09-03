<script setup lang="ts">
import { computed } from "vue";
import type { CharacterProfileView } from "../../api/types";
import { toCharacterMediaLadder } from "../../lib/characterMediaViewModel";
import { useCharacterMediaLadder } from "../../composables/useCharacterMediaLadder";

const props = withDefaults(
  defineProps<{
    profile: CharacterProfileView;
    /** Framed card (default) or borderless full-bleed model for the profile hero. */
    variant?: "default" | "bare";
    /**
     * When true, load the image eagerly (CharacterPage hero / active carousel slide).
     * Inactive home slides may omit this so the browser can defer them.
     */
    priority?: boolean;
  }>(),
  { variant: "default", priority: false },
);

const ladder = computed(() => toCharacterMediaLadder(props.profile));
const identityKey = computed(
  () =>
    props.profile.characterId ||
    `${props.profile.region}:${props.profile.realmSlug}:${props.profile.displayName}`,
);

const {
  requestUrl,
  activeKind,
  activeType,
  showRemoteImage,
  exhausted,
  loadGeneration,
  onImageError,
} = useCharacterMediaLadder(() => ladder.value.candidates, { identityKey });

const fallback = computed(() => ladder.value.fallback);
const showFallback = computed(() => !showRemoteImage.value);
const loadingAttr = computed(() => (props.priority || props.variant === "bare" ? "eager" : "lazy"));

const statusLabel = computed(() => {
  if (showRemoteImage.value) {
    return activeType.value === "avatar" || activeKind.value === "avatar" || activeKind.value === "inset"
      ? "Character avatar"
      : "Character render";
  }
  return "Character identity";
});

const mediaAlt = computed(() => {
  if (showRemoteImage.value && activeType.value === "avatar") {
    return `Avatar for ${fallback.value.displayName}`;
  }
  if (showRemoteImage.value) {
    return `Character render for ${fallback.value.displayName}`;
  }
  return fallback.value.alt;
});

const mediaTypeAttr = computed(() => {
  if (showRemoteImage.value) return activeType.value ?? "render";
  return "placeholder";
});
</script>

<template>
  <div
    class="media-panel"
    :class="{ 'media-panel--bare': variant === 'bare' }"
    data-testid="character-media"
    :data-media-type="mediaTypeAttr"
    :data-media-kind="activeKind ?? 'fallback'"
    :data-media-exhausted="exhausted ? 'true' : 'false'"
  >
    <div class="media-panel__frame" :aria-hidden="showRemoteImage ? undefined : 'true'">
      <img
        v-if="showRemoteImage && requestUrl"
        :key="`${loadGeneration}:${requestUrl}`"
        class="media-panel__image"
        :src="requestUrl"
        :alt="mediaAlt"
        width="320"
        height="427"
        :loading="loadingAttr"
        decoding="async"
        @error="onImageError"
      />
      <div
        v-else
        class="media-panel__identity"
        :style="{ '--media-class-color': fallback.classColor }"
        data-testid="character-media-fallback"
        :data-role="fallback.role ?? 'unknown'"
        :data-class="fallback.classSlug ?? 'unknown'"
      >
        <div class="media-panel__identity-glow" />
        <div class="media-panel__identity-plate">
          <div class="media-panel__identity-badge" aria-hidden="true">
            <span class="media-panel__identity-initials">{{ fallback.initials }}</span>
          </div>
          <p class="media-panel__identity-name">{{ fallback.displayName }}</p>
          <p class="media-panel__identity-meta">{{ fallback.caption }}</p>
          <p v-if="fallback.role" class="media-panel__identity-role">{{ fallback.role }}</p>
        </div>
      </div>
    </div>
    <p v-if="variant !== 'bare'" class="media-panel__caption">
      <span class="media-panel__status">{{ statusLabel }}</span>
      <span>{{ fallback.caption }}</span>
    </p>
    <p v-if="showFallback || variant === 'bare'" class="sr-only">{{ mediaAlt }}</p>
  </div>
</template>

<style scoped>
.media-panel {
  display: grid;
  gap: var(--space-3);
}

.media-panel--bare {
  height: 100%;
  min-height: 0;
  gap: 0;
  grid-template-rows: 1fr;
}

.media-panel__frame {
  position: relative;
  aspect-ratio: 3 / 4;
  min-height: 14rem;
  border-radius: var(--radius-hero);
  border: 1px solid var(--color-border);
  overflow: hidden;
  background:
    radial-gradient(circle at 50% 18%, rgb(var(--color-rank-rgb) / 16%), transparent 42%),
    linear-gradient(165deg, var(--color-iron-800), var(--color-obsidian-950) 58%);
}

.media-panel--bare .media-panel__frame {
  aspect-ratio: auto;
  height: 100%;
  min-height: 16rem;
  border: none;
  border-radius: 0;
  background: transparent;
  overflow: visible;
}

.media-panel__image {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.media-panel--bare .media-panel__image {
  object-fit: contain;
  object-position: center bottom;
}

.media-panel__identity {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: var(--space-4);
  overflow: hidden;
  background:
    radial-gradient(
      circle at 50% 42%,
      color-mix(in srgb, var(--media-class-color, var(--color-gold-400)) 28%, transparent),
      transparent 62%
    ),
    linear-gradient(165deg, var(--color-iron-800), var(--color-obsidian-950) 62%);
}

.media-panel--bare .media-panel__identity {
  background:
    radial-gradient(
      circle at 58% 48%,
      color-mix(in srgb, var(--media-class-color, var(--color-gold-400)) 34%, transparent),
      transparent 68%
    ),
    transparent;
}

.media-panel__identity-glow {
  position: absolute;
  inset: auto 18% 18% 18%;
  height: 28%;
  border-radius: 50%;
  background: color-mix(in srgb, var(--media-class-color, var(--color-gold-400)) 22%, transparent);
  filter: blur(18px);
  pointer-events: none;
}

.media-panel__identity-plate {
  position: relative;
  z-index: 1;
  display: grid;
  justify-items: center;
  gap: var(--space-2);
  text-align: center;
  max-width: 14rem;
}

.media-panel__identity-badge {
  position: relative;
  display: grid;
  place-items: center;
  width: 4.5rem;
  height: 4.5rem;
}

.media-panel__identity-initials {
  display: grid;
  place-items: center;
  width: 4.5rem;
  height: 4.5rem;
  border-radius: var(--radius-control);
  border: 1px solid color-mix(in srgb, var(--media-class-color, var(--color-gold-400)) 55%, transparent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--media-class-color, var(--color-gold-400)) 18%, transparent);
  font-family: var(--font-display);
  font-size: var(--text-xl);
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--color-text);
  background:
    linear-gradient(
      145deg,
      color-mix(in srgb, var(--media-class-color, var(--color-gold-400)) 34%, var(--color-obsidian-950)),
      var(--color-obsidian-950)
    );
}

.media-panel__identity-name {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--color-text);
  line-height: 1.2;
  overflow-wrap: anywhere;
}

.media-panel__identity-meta {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.media-panel__identity-role {
  margin: 0;
  font-family: var(--font-data);
  font-size: var(--text-xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--media-class-color, var(--color-gold-300)) 80%, var(--color-text-muted));
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
  .media-panel__identity-glow {
    filter: none;
  }
}
</style>
