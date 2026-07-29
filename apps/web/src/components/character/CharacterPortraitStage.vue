<script setup lang="ts">
import type { CharacterProfileView } from "../../api/types";
import CharacterMediaPanel from "./CharacterMediaPanel.vue";

defineProps<{
  profile: CharacterProfileView;
}>();
</script>

<template>
  <div class="portrait-stage" aria-hidden="true">
    <div class="portrait-stage__glow" />
    <CharacterMediaPanel class="portrait-stage__media" :profile="profile" variant="bare" />
  </div>
</template>

<style scoped>
/* Sibling of ScoreHeader — absolute over hero, never clipped by score-header.
   Height is fixed so accordion open/close does not reflow the model.
   Top offset clears the Mythic+ score glass so the head sits well below it. */
.portrait-stage {
  position: absolute;
  z-index: 0;
  top: 15rem;
  right: 0;
  bottom: auto;
  left: auto;
  width: min(48%, 36rem);
  height: min(62dvh, 32rem);
  pointer-events: none;
  display: grid;
  align-items: end;
  justify-items: end;
  overflow: visible;
}

.portrait-stage__glow {
  position: absolute;
  z-index: 0;
  top: -8%;
  right: -22%;
  bottom: -18%;
  left: -18%;
  border-radius: 50%;
  background: radial-gradient(
    circle at 55% 52%,
    rgb(var(--color-rank-rgb) / 58%) 0%,
    rgb(var(--color-rank-rgb) / 32%) 28%,
    rgb(var(--color-rank-rgb) / 14%) 52%,
    transparent 78%
  );
  filter: blur(56px);
}

.portrait-stage__media {
  position: relative;
  z-index: 1;
  width: min(100%, 30rem);
  height: 100%;
  max-height: 100%;
  justify-self: end;
  margin-right: -1rem;
  margin-bottom: -1.25rem;
  transform: translate(4%, 4%);
  overflow: visible;
}

.portrait-stage :deep(.media-panel--bare),
.portrait-stage :deep(.media-panel--bare .media-panel__frame) {
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: visible;
}

.portrait-stage :deep(.media-panel--bare .media-panel__image) {
  width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: center bottom;
  transform: scale(2.35) translate(8%, 3%);
  transform-origin: center bottom;
}

.portrait-stage :deep(.media-panel--bare .media-panel__silhouette) {
  inset: 4% 6% 0 22%;
}

.portrait-stage :deep(.media-panel--bare .media-panel__glow) {
  inset: auto 4% 0 28%;
  height: 34%;
}

@media (min-width: 768px) {
  .portrait-stage {
    width: min(42%, 34rem);
  }

  .portrait-stage__media {
    width: min(100%, 32rem);
    margin-right: -1.5rem;
    margin-bottom: -1.5rem;
    transform: translate(6%, 5%);
  }

  .portrait-stage :deep(.media-panel--bare .media-panel__image) {
    transform: scale(2.6) translate(10%, 3%);
  }
}

@media (min-width: 1100px) {
  .portrait-stage {
    width: min(40%, 38rem);
  }

  .portrait-stage__media {
    width: min(100%, 36rem);
    margin-right: -2rem;
    margin-bottom: -1.75rem;
    transform: translate(8%, 6%);
  }

  .portrait-stage :deep(.media-panel--bare .media-panel__image) {
    transform: scale(2.85) translate(12%, 4%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .portrait-stage__glow {
    filter: blur(28px);
  }

  .portrait-stage__media {
    transform: translate(4%, 3%);
  }

  .portrait-stage :deep(.media-panel--bare .media-panel__image) {
    transform: scale(1.9) translate(6%, 2%);
  }
}
</style>
