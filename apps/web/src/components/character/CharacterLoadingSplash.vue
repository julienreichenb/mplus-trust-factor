<script setup lang="ts">
defineProps<{
  name: string;
  realm: string;
  region: string;
  hint?: string;
}>();
</script>

<template>
  <div class="splash" role="status" aria-live="polite" aria-busy="true" data-testid="character-loading-splash">
    <div class="splash__glass" aria-hidden="true" />
    <div class="splash__panel">
      <img
        class="splash__logo"
        src="/logos/mplus-trust-factor.png"
        alt=""
        width="96"
        height="96"
        decoding="async"
      />
      <p class="splash__eyebrow">Loading profile</p>
      <h2 class="splash__title">{{ name }}</h2>
      <p class="splash__meta">{{ realm }} · {{ region.toUpperCase() }}</p>
      <div class="splash__progress" aria-hidden="true">
        <span class="splash__bar" />
      </div>
      <p class="splash__hint">{{ hint || "Gathering public signals…" }}</p>
    </div>
  </div>
</template>

<style scoped>
.splash {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: var(--space-6) var(--space-4);
  pointer-events: auto;
}

.splash__glass {
  position: absolute;
  inset: 0;
  background: rgb(7 7 7 / 72%);
  backdrop-filter: blur(18px) saturate(140%);
  -webkit-backdrop-filter: blur(18px) saturate(140%);
}

.splash__panel {
  position: relative;
  z-index: 1;
  display: grid;
  justify-items: center;
  gap: var(--space-3);
  width: min(100%, 26rem);
  padding: var(--space-8) var(--space-6);
  border-radius: var(--radius-hero);
  border: 1px solid rgb(255 255 255 / 12%);
  background: rgb(13 13 15 / 72%);
  backdrop-filter: blur(20px) saturate(150%);
  -webkit-backdrop-filter: blur(20px) saturate(150%);
  box-shadow:
    0 16px 48px rgb(0 0 0 / 45%),
    inset 0 1px 0 rgb(255 255 255 / 8%);
  text-align: center;
}

.splash__logo {
  width: 5.5rem;
  height: 5.5rem;
  object-fit: contain;
  filter: drop-shadow(0 0 18px rgb(var(--color-rank-rgb) / 28%));
  animation: splash-pulse 1.6s ease-in-out infinite;
}

.splash__eyebrow {
  margin: var(--space-2) 0 0;
  font-family: var(--font-data);
  font-size: var(--text-xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-gold-300);
}

.splash__title {
  margin: 0;
  font-size: clamp(1.5rem, 3vw, 2rem);
  line-height: 1.1;
  overflow-wrap: anywhere;
}

.splash__meta {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  text-transform: capitalize;
}

.splash__progress {
  width: min(100%, 14rem);
  height: 0.35rem;
  margin-top: var(--space-2);
  border-radius: 999px;
  background: var(--color-iron-800);
  overflow: hidden;
}

.splash__bar {
  display: block;
  height: 100%;
  width: 40%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--color-brand), var(--color-gold-300));
  animation: splash-bar 1.1s ease-in-out infinite;
}

.splash__hint {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

@keyframes splash-pulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.04);
    opacity: 0.88;
  }
}

@keyframes splash-bar {
  0% {
    transform: translateX(-120%);
  }
  100% {
    transform: translateX(320%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .splash__logo,
  .splash__bar {
    animation: none;
  }

  .splash__bar {
    width: 100%;
    opacity: 0.7;
  }
}
</style>
