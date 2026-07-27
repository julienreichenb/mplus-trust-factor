<script setup lang="ts">
import CharacterSearchForm from "../components/search/CharacterSearchForm.vue";
import HeroProductPreview from "../components/landing/HeroProductPreview.vue";
import RatingComparison from "../components/landing/RatingComparison.vue";
import EightRunExplainer from "../components/landing/EightRunExplainer.vue";
import MethodologySummary from "../components/landing/MethodologySummary.vue";
import FinalSearchCta from "../components/landing/FinalSearchCta.vue";
</script>

<template>
  <div class="landing">
    <section class="hero" aria-labelledby="hero-title">
      <div class="hero__copy">
        <p class="eyebrow">Explainable Mythic+ trust intelligence</p>
        <h1 id="hero-title">Rating shows completion. Trust Factor explains execution.</h1>
        <p class="lede">
          Screen teammates with a dark, evidence-first Trust Score — four dimensions, eight selected
          runs, confidence and provenance. Not another completion leaderboard.
        </p>

        <CharacterSearchForm />

        <p class="trust-line">
          Transparent model. Public data. Versioned scoring.
          <a class="trust-line__link" href="#methodology">See how scoring works</a>
        </p>
      </div>

      <div class="hero__preview">
        <HeroProductPreview />
      </div>
    </section>

    <RatingComparison />
    <EightRunExplainer />
    <MethodologySummary />
    <FinalSearchCta />

    <footer class="landing-footer">
      <p>
        World of Warcraft and Blizzard Entertainment are trademarks or registered trademarks of
        Blizzard Entertainment, Inc. M+ Trust Factor is an independent community project and is not
        affiliated with or endorsed by Blizzard Entertainment or Wowhead.
      </p>
    </footer>
  </div>
</template>

<style scoped>
.landing {
  display: grid;
  gap: var(--section-gap-mobile);
}

.hero {
  display: grid;
  gap: var(--space-10);
  align-items: start;
}

.eyebrow {
  margin: 0 0 var(--space-3);
  font-family: var(--font-data);
  font-size: var(--text-xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-gold-300);
}

.hero h1 {
  margin: 0 0 var(--space-4);
  font-size: clamp(1.85rem, 4.8vw, 3.35rem);
  line-height: 1.15;
  color: var(--color-text);
}

.lede {
  margin: 0 0 var(--space-6);
  max-width: 38rem;
  font-size: var(--text-lg);
  color: var(--color-text-muted);
}

.trust-line {
  margin: var(--space-5) 0 0;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  align-items: center;
}

.trust-line__link {
  font-weight: 600;
}

.landing-footer {
  padding-top: var(--space-6);
  border-top: 1px solid var(--color-border);
}

.landing-footer p {
  margin: 0;
  max-width: 48rem;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

@media (min-width: 768px) {
  .landing {
    gap: var(--space-16);
  }
}

@media (min-width: 1024px) {
  .landing {
    gap: var(--section-gap-desktop);
  }

  .hero {
    grid-template-columns: minmax(0, 1.1fr) minmax(18rem, 0.9fr);
    gap: var(--space-10);
    align-items: start;
  }

  .hero__preview {
    position: sticky;
    top: calc(4.5rem + var(--space-6));
  }
}
</style>
