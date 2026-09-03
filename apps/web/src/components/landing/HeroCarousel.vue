<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { api } from "../../api/client";
import type { CharacterProfileView } from "../../api/types";
import CharacterMediaPanel from "../character/CharacterMediaPanel.vue";
import HeroTrustSummary, { type HeroTrustPreview } from "./HeroTrustSummary.vue";

const INTERVAL_MS = 2500;

interface HeroSlideConfig {
  identity: { region: string; realmSlug: string; name: string };
  trust: HeroTrustPreview;
}

/** P = Performance, S = Survival, U = Utility, E = Experience */
const SLIDE_CONFIGS: HeroSlideConfig[] = [
  {
    identity: { region: "EU", realmSlug: "archimonde", name: "Wallidrixe" },
    trust: {
      grade: "S",
      dimensions: [
        { short: "P", value: 98 },
        { short: "S", value: 94 },
        { short: "U", value: 91 },
        { short: "E", value: 97 },
      ],
    },
  },
  {
    identity: { region: "EU", realmSlug: "hyjal", name: "Zam" },
    trust: {
      grade: "D",
      dimensions: [
        { short: "P", value: 58 },
        { short: "S", value: 14 },
        { short: "U", value: 42 },
        { short: "E", value: 36 },
      ],
    },
  },
  {
    identity: { region: "EU", realmSlug: "sylvanas", name: "Serahz" },
    trust: {
      grade: "A",
      dimensions: [
        { short: "P", value: 92 },
        { short: "S", value: 58 },
        { short: "U", value: 86 },
        { short: "E", value: 84 },
      ],
    },
  },
  {
    identity: { region: "EU", realmSlug: "twisting-nether", name: "Makmakmak" },
    trust: {
      grade: "B",
      dimensions: [
        { short: "P", value: 78 },
        { short: "S", value: 38 },
        { short: "U", value: 72 },
        { short: "E", value: 65 },
      ],
    },
  },
];

interface HeroSlide extends HeroSlideConfig {
  profile: CharacterProfileView | null;
}

const slides = ref<HeroSlide[]>(SLIDE_CONFIGS.map((config) => ({ ...config, profile: null })));
const carouselRef = ref<HTMLElement | null>(null);
const viewportRef = ref<HTMLElement | null>(null);
const trackRef = ref<HTMLElement | null>(null);
const trackIndex = ref(0);
const carouselWidth = ref(0);
const isResetting = ref(false);
const prefersReducedMotion = ref(false);

let timer: ReturnType<typeof setInterval> | null = null;
let resizeObserver: ResizeObserver | null = null;

const displaySlides = computed(() => {
  const items = slides.value;
  if (items.length <= 1) return items;
  if (prefersReducedMotion.value) return items;
  return [...items, items[0]!];
});

const logicalIndex = computed(() => {
  const count = slides.value.length;
  if (count === 0) return 0;
  return trackIndex.value % count;
});

const activeSlide = computed(() => slides.value[logicalIndex.value] ?? slides.value[0]);

const trackStyle = computed(() => {
  const width = carouselWidth.value;
  if (width <= 0) {
    return { transform: "translate3d(0, 0, 0)" };
  }
  return { transform: `translate3d(-${trackIndex.value * width}px, 0, 0)` };
});

const slideStyle = computed(() => {
  const width = carouselWidth.value;
  if (width <= 0) return undefined;
  return {
    flex: `0 0 ${width}px`,
    width: `${width}px`,
  };
});

function updateCarouselWidth(): void {
  const width = viewportRef.value?.getBoundingClientRect().width ?? 0;
  const rounded = Math.round(width);
  if (rounded <= 0 || rounded > 8192) return;
  if (rounded === carouselWidth.value) return;
  carouselWidth.value = rounded;
}

function setTrackTransition(enabled: boolean): void {
  const track = trackRef.value;
  if (!track) return;
  track.style.transition = enabled ? "" : "none";
}

function next(): void {
  const count = slides.value.length;
  if (count <= 1 || isResetting.value) return;

  if (prefersReducedMotion.value) {
    trackIndex.value = (trackIndex.value + 1) % count;
    return;
  }

  setTrackTransition(true);
  trackIndex.value += 1;
}

async function resetToStart(): Promise<void> {
  isResetting.value = true;
  setTrackTransition(false);
  trackIndex.value = 0;
  await nextTick();
  void trackRef.value?.offsetHeight;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      setTrackTransition(true);
      isResetting.value = false;
    });
  });
}

function onTrackTransitionEnd(event: TransitionEvent): void {
  if (isResetting.value) return;
  if (event.target !== trackRef.value) return;
  if (event.propertyName !== "transform") return;

  const count = slides.value.length;
  if (count <= 1 || trackIndex.value !== count) return;

  void resetToStart();
}

function startTimer(): void {
  if (timer) clearInterval(timer);
  timer = setInterval(next, INTERVAL_MS);
}

function stopTimer(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

onMounted(async () => {
  prefersReducedMotion.value = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  updateCarouselWidth();
  resizeObserver = new ResizeObserver(() => updateCarouselWidth());
  if (viewportRef.value) resizeObserver.observe(viewportRef.value);

  slides.value = await Promise.all(
    SLIDE_CONFIGS.map(async (config) => {
      try {
        const profile = await api.getCharacterProfile(config.identity);
        return { ...config, profile };
      } catch {
        return { ...config, profile: null };
      }
    }),
  );

  updateCarouselWidth();

  if (!prefersReducedMotion.value) startTimer();
});

onBeforeUnmount(() => {
  stopTimer();
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<template>
  <div ref="carouselRef" class="hero-carousel" data-testid="hero-carousel">
    <div ref="viewportRef" class="hero-carousel__viewport">
      <div
        ref="trackRef"
        class="hero-carousel__track"
        :style="trackStyle"
        @transitionend="onTrackTransitionEnd"
      >
        <article
          v-for="(slide, index) in displaySlides"
          :key="
            index === slides.length
              ? `${slide.identity.region}-${slide.identity.realmSlug}-${slide.identity.name}-clone`
              : `${slide.identity.region}-${slide.identity.realmSlug}-${slide.identity.name}`
          "
          class="hero-carousel__slide"
          :style="slideStyle"
          :data-tier="slide.trust.grade"
          :aria-hidden="index !== trackIndex"
        >
          <CharacterMediaPanel
            v-if="slide.profile"
            class="hero-carousel__media"
            :profile="slide.profile"
            :priority="index === trackIndex || index === trackIndex + 1"
          />
          <div
            v-else
            class="hero-carousel__placeholder"
            aria-hidden="true"
            data-testid="hero-carousel-placeholder"
          >
            <div class="hero-carousel__glow" />
            <p class="hero-carousel__placeholder-name">{{ slide.identity.name }}</p>
          </div>

          <div class="hero-carousel__trust-zone">
            <HeroTrustSummary class="hero-carousel__trust" :preview="slide.trust" />
          </div>
        </article>
      </div>
    </div>

    <p class="sr-only" aria-live="polite">
      Showing {{ activeSlide?.identity.name }} — grade {{ activeSlide?.trust.grade }} preview
    </p>
  </div>
</template>

<style scoped>
.hero-carousel {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  height: 100%;
  min-height: 20rem;
  margin: 0;
}

.hero-carousel__viewport {
  overflow: hidden;
  width: 100%;
  height: 100%;
  min-height: inherit;
}

.hero-carousel__track {
  display: flex;
  transition: transform 520ms ease;
  height: 100%;
  min-height: inherit;
  will-change: transform;
}

@media (prefers-reduced-motion: reduce) {
  .hero-carousel__track {
    transition: none;
  }
}

.hero-carousel__slide {
  flex: 0 0 100%;
  width: 100%;
  min-width: 0;
  position: relative;
  min-height: 20rem;
  height: 100%;
}

.hero-carousel__media,
.hero-carousel__placeholder {
  min-height: 0;
  height: 100%;
  min-height: 18rem;
}

.hero-carousel__media :deep(.media-panel) {
  height: 100%;
  grid-template-rows: 1fr;
}

.hero-carousel__media :deep(.media-panel__frame) {
  height: 100%;
  min-height: 0;
  max-height: none;
  aspect-ratio: auto;
  border: none;
  border-radius: var(--radius-hero);
  background: transparent;
  overflow: hidden;
}

.hero-carousel__slide[data-tier="S"] .hero-carousel__media :deep(.media-panel__frame),
.hero-carousel__slide[data-tier="S"] .hero-carousel__placeholder {
  background: radial-gradient(circle at 88% 48%, rgb(56 189 248 / 22%), transparent 58%);
}

.hero-carousel__slide[data-tier="A"] .hero-carousel__media :deep(.media-panel__frame),
.hero-carousel__slide[data-tier="A"] .hero-carousel__placeholder {
  background: radial-gradient(circle at 88% 48%, rgb(163 230 53 / 20%), transparent 58%);
}

.hero-carousel__slide[data-tier="B"] .hero-carousel__media :deep(.media-panel__frame),
.hero-carousel__slide[data-tier="B"] .hero-carousel__placeholder {
  background: radial-gradient(circle at 88% 48%, rgb(45 212 191 / 18%), transparent 58%);
}

.hero-carousel__slide[data-tier="D"] .hero-carousel__media :deep(.media-panel__frame),
.hero-carousel__slide[data-tier="D"] .hero-carousel__placeholder {
  background: radial-gradient(circle at 88% 48%, rgb(251 113 133 / 18%), transparent 58%);
}

.hero-carousel__media :deep(.media-panel__image) {
  object-position: center 38%;
  object-fit: contain;
  transform: scale(1.58);
  transform-origin: center 42%;
}

.hero-carousel__trust-zone {
  position: absolute;
  top: 10%;
  right: 0;
  bottom: 10%;
  z-index: 3;
  display: flex;
  flex-direction: column;
  width: min(62%, 16.5rem);
  padding: var(--space-3) var(--space-2) var(--space-3) var(--space-5);
  background: transparent;
}

.hero-carousel__trust {
  flex: 1;
  min-height: 0;
  height: 100%;
}

.hero-carousel__media :deep(.media-panel__caption) {
  display: none;
}

.hero-carousel__placeholder {
  position: relative;
  border-radius: var(--radius-hero);
  overflow: hidden;
}

.hero-carousel__glow {
  position: absolute;
  inset: 24% 4% 20% 38%;
  border-radius: 50%;
  filter: blur(22px);
}

.hero-carousel__slide[data-tier="S"] .hero-carousel__glow {
  background: rgb(56 189 248 / 22%);
}

.hero-carousel__slide[data-tier="A"] .hero-carousel__glow {
  background: rgb(163 230 53 / 20%);
}

.hero-carousel__slide[data-tier="B"] .hero-carousel__glow {
  background: rgb(45 212 191 / 18%);
}

.hero-carousel__slide[data-tier="D"] .hero-carousel__glow {
  background: rgb(251 113 133 / 18%);
}

.hero-carousel__placeholder-name {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  margin: 0;
  padding: var(--space-4);
  font-family: var(--font-display);
  font-size: var(--text-xl);
  font-weight: 600;
  color: rgb(241 233 219 / 72%);
  text-align: center;
}
</style>
