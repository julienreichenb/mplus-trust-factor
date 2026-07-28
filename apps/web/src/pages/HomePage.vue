<script setup lang="ts">
import CharacterSearchAutocomplete from "../components/search/CharacterSearchAutocomplete.vue";
import HeroProductPreview from "../components/landing/HeroProductPreview.vue";
import FeatureGrid from "../components/landing/FeatureGrid.vue";
import MethodologySummary from "../components/landing/MethodologySummary.vue";
</script>

<template>
  <div class="landing">
    <section class="hero" aria-labelledby="hero-title">
      <div class="hero__copy">
        <p class="eyebrow">Explainable Mythic+ player intelligence</p>
        <h1 id="hero-title">Know who you run with.</h1>
        <p class="lede">
          An explainable Mythic+ trust score built from performance, consistency, progression and
          public player data.
        </p>

        <CharacterSearchAutocomplete />

        <p class="trust-line">
          Transparent model. Public data. Versioned scoring.
          <a class="trust-line__link" href="#methodology">See how scoring works</a>
        </p>
      </div>

      <div class="hero__preview">
        <HeroProductPreview />
      </div>
    </section>

    <section class="strip" aria-label="Product principles">
      <ul>
        <li>
          <strong>Explainable</strong>
          <span>Every tier links to dimensions, weights and sources.</span>
        </li>
        <li>
          <strong>Current</strong>
          <span>Freshness and confidence stay visible on results.</span>
        </li>
        <li>
          <strong>Built for high keys</strong>
          <span>Optimized for expert screening, not casual browsing.</span>
        </li>
      </ul>
    </section>

    <FeatureGrid />
    <MethodologySummary />

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
  gap: var(--space-8);
  align-items: center;
}

.hero__copy {
  display: grid;
  gap: var(--space-4);
  align-content: start;
}

.hero h1 {
  margin: 0;
  font-size: clamp(2rem, 4.5vw, 3.25rem);
  line-height: 1.05;
  background: linear-gradient(180deg, var(--color-gold-300) 0%, var(--color-stone-100) 72%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.lede {
  margin: 0;
  max-width: 34rem;
  font-size: var(--text-base);
  color: var(--color-text-muted);
}

.eyebrow {
  margin: 0;
  font-family: var(--font-data);
  font-size: var(--text-xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-gold-300);
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

.strip ul {
  list-style: none;
  margin: 0;
  padding: var(--space-5);
  display: grid;
  gap: var(--space-5);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: rgb(23 23 25 / 72%);
}

.strip li {
  display: grid;
  gap: var(--space-1);
}

.strip strong {
  color: var(--color-text);
  font-size: var(--text-sm);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.strip span {
  color: var(--color-text-muted);
  font-size: var(--text-sm);
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

  .strip ul {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-6);
    padding: var(--space-6);
  }
}

@media (min-width: 1024px) {
  .landing {
    gap: var(--section-gap-desktop);
  }

  .hero {
    grid-template-columns: minmax(0, 1.05fr) minmax(16rem, 0.95fr);
    gap: var(--space-8);
    align-items: center;
    min-height: min(34rem, calc(100vh - 10rem));
  }

  .hero__preview {
    align-self: center;
  }
}
</style>
