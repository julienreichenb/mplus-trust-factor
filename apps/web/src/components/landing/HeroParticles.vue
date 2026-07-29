<script setup lang="ts">
type ParticleTone = "gold" | "amber" | "mist" | "bokeh";

interface HeroParticle {
  id: number;
  x: number;
  y: number;
  size: number;
  duration: number;
  delay: number;
  opacity: number;
  drift: number;
  lift: number;
  tone: ParticleTone;
}

/** Deterministic PRNG — stable across SSR and hydration. */
function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function pickTone(rand: () => number): ParticleTone {
  const roll = rand();
  if (roll < 0.34) return "gold";
  if (roll < 0.62) return "amber";
  if (roll < 0.88) return "mist";
  return "bokeh";
}

function buildParticles(count: number): HeroParticle[] {
  const rand = createSeededRandom(0x6d70_34);

  return Array.from({ length: count }, (_, index) => {
    const id = index + 1;
    const xBias = Math.pow(rand(), 2.4);
    const x = Math.min(58, Math.round(2 + xBias * 54 + rand() * 4));
    const y = Math.round(2 + rand() * 94);
    const sizeRoll = rand();
    const size =
      sizeRoll < 0.42 ? 2 : sizeRoll < 0.78 ? 3 : sizeRoll < 0.93 ? 4 : rand() < 0.55 ? 5 : 6;
    const duration = Math.round(13 + rand() * 12);
    const delay = Math.round(rand() * 60) / 10;
    const opacity = Math.round((0.1 + rand() * 0.24) * 100) / 100;
    const drift = Math.round((rand() - 0.5) * 30);
    const lift = Math.round(14 + rand() * 24);

    return {
      id,
      x,
      y,
      size,
      duration,
      delay,
      opacity,
      drift,
      lift,
      tone: pickTone(rand),
    };
  });
}

/** 5× original count, weighted toward the left content column. */
const PARTICLES = buildParticles(120);
</script>

<template>
  <div class="hero-particles" aria-hidden="true">
    <span
      v-for="particle in PARTICLES"
      :key="particle.id"
      class="hero-particles__dot"
      :class="`hero-particles__dot--${particle.tone}`"
      :style="{
        left: `${particle.x}%`,
        top: `${particle.y}%`,
        width: `${particle.size}px`,
        height: `${particle.size}px`,
        '--particle-duration': `${particle.duration}s`,
        '--particle-delay': `${particle.delay}s`,
        '--particle-opacity': particle.opacity,
        '--particle-drift': `${particle.drift}px`,
        '--particle-lift': `${particle.lift}px`,
      }"
    />
  </div>
</template>

<style scoped>
.hero-particles {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
  border-radius: inherit;
}

.hero-particles__dot {
  position: absolute;
  border-radius: 50%;
  opacity: var(--particle-opacity);
  animation: hero-particle-float var(--particle-duration) ease-in-out infinite;
  animation-delay: var(--particle-delay);
  will-change: transform, opacity;
}

.hero-particles__dot--gold {
  background: var(--color-gold-300);
  box-shadow: 0 0 6px rgb(244 213 141 / 45%);
}

.hero-particles__dot--amber {
  background: var(--color-amber-400);
  box-shadow: 0 0 8px rgb(251 191 36 / 40%);
}

.hero-particles__dot--mist {
  background: rgb(255 255 255 / 60%);
  box-shadow: 0 0 4px rgb(255 255 255 / 30%);
}

.hero-particles__dot--bokeh {
  background: rgb(244 213 141 / 35%);
  filter: blur(2px);
  box-shadow: 0 0 14px rgb(244 213 141 / 25%);
}

@keyframes hero-particle-float {
  0%,
  100% {
    transform: translate3d(0, 0, 0) scale(1);
    opacity: var(--particle-opacity);
  }

  50% {
    transform: translate3d(var(--particle-drift), calc(var(--particle-lift) * -1), 0) scale(1.08);
    opacity: calc(var(--particle-opacity) + 0.12);
  }
}

@media (prefers-reduced-motion: reduce) {
  .hero-particles {
    display: none;
  }
}
</style>
