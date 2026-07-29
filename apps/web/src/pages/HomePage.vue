<script setup lang="ts">
import CharacterRealmSearch from "../components/search/CharacterRealmSearch.vue";
import HeroCarousel from "../components/landing/HeroCarousel.vue";
import HeroParticles from "../components/landing/HeroParticles.vue";
import FeatureGrid from "../components/landing/FeatureGrid.vue";
import RanksSection from "../components/landing/RanksSection.vue";
import MethodologySummary from "../components/landing/MethodologySummary.vue";
</script>

<template>
  <div class="landing">
    <section class="hero-stage" aria-labelledby="hero-title">
      <div class="hero-panel">
        <HeroParticles />
        <div class="hero-panel__layout">
          <div class="hero-panel__content">
            <div class="hero__intro">
              <p class="eyebrow">Explainable Mythic+ player intelligence</p>
              <h1 id="hero-title">Know who you run with.</h1>
              <p class="lede">
                An explainable Mythic+ trust score built from performance, consistency, progression and
                public player data.
              </p>
            </div>

            <div class="hero__search">
              <CharacterRealmSearch icon-submit />

              <p class="trust-line">
                Transparent model. Public data. Versioned scoring.
                <a class="trust-line__link" href="#methodology">See how scoring works</a>
              </p>
            </div>
          </div>

          <div class="hero-panel__art">
            <HeroCarousel />
          </div>
        </div>
      </div>
    </section>

    <RanksSection />
    <FeatureGrid />
    <MethodologySummary />

    <footer class="landing-footer">
      <div class="landing-footer__col landing-footer__brand">
        <img
          class="landing-footer__logo"
          src="/logos/mplus-trust-factor.png"
          alt="M+ Trust Factor"
          width="120"
          height="120"
          loading="lazy"
          decoding="async"
        />
        <p class="landing-footer__brand-name">M+ Trust Factor</p>
      </div>

      <div class="landing-footer__col landing-footer__contact">
        <h2 class="landing-footer__heading">Get in touch</h2>
        <p class="landing-footer__lead">
          Feedback, bugs, or ideas welcome — reach out anytime.
        </p>
        <ul class="landing-footer__contacts">
          <li>
            <span class="landing-footer__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9z" />
                <path d="M12 12 4 7.5M12 12l8-4.5M12 12v9" />
              </svg>
            </span>
            <span>
              <span class="landing-footer__label">Battle.net</span>
              <span class="landing-footer__value mpts-data">fisherman#2917</span>
            </span>
          </li>
          <li>
            <span class="landing-footer__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M19.27 5.33A16.7 16.7 0 0 0 14.9 4.2a.1.1 0 0 0-.1.05 11.6 11.6 0 0 0-.51 1.05 15.4 15.4 0 0 0-4.58 0 12 12 0 0 0-.52-1.05.11.11 0 0 0-.1-.05 16.65 16.65 0 0 0-4.37 1.13.1.1 0 0 0-.04.03C2.05 9.2 1.35 13 1.7 16.72a.12.12 0 0 0 .04.08 16.84 16.84 0 0 0 5.08 2.57.11.11 0 0 0 .12-.04 12.1 12.1 0 0 0 1.04-1.7.11.11 0 0 0-.06-.15 11.1 11.1 0 0 1-1.58-.76.11.11 0 0 1-.01-.18c.11-.08.21-.16.31-.25a.1.1 0 0 1 .11-.01 12.3 12.3 0 0 0 10.05 0 .1.1 0 0 1 .11.01c.1.09.2.17.31.25a.11.11 0 0 1-.01.18 10.4 10.4 0 0 1-1.58.76.11.11 0 0 0-.06.15 13.5 13.5 0 0 0 1.04 1.7.11.11 0 0 0 .12.04 16.78 16.78 0 0 0 5.09-2.57.11.11 0 0 0 .04-.08c.4-4.3-.67-8.07-2.83-11.39a.08.08 0 0 0-.04-.03ZM8.68 14.68c-1.03 0-1.89-.95-1.89-2.12s.84-2.12 1.89-2.12 1.91.95 1.89 2.12c0 1.17-.84 2.12-1.89 2.12Zm6.65 0c-1.03 0-1.89-.95-1.89-2.12s.84-2.12 1.89-2.12 1.91.95 1.89 2.12c0 1.17-.86 2.12-1.89 2.12Z" />
              </svg>
            </span>
            <span>
              <span class="landing-footer__label">Discord</span>
              <span class="landing-footer__value mpts-data">@fishermanyo</span>
            </span>
          </li>
        </ul>
      </div>

      <div class="landing-footer__col landing-footer__legal">
        <h2 class="landing-footer__heading">About this project</h2>
        <p>
          M+ Trust Factor is a free, independent project built by one person for the Mythic+
          community. It is not affiliated with, endorsed by, or sponsored by Blizzard Entertainment,
          Raider.IO, Warcraft Logs, or Wowhead.
        </p>
        <p>
          World of Warcraft and Blizzard Entertainment are trademarks or registered trademarks of
          Blizzard Entertainment, Inc. All other trademarks belong to their respective owners.
        </p>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.landing {
  display: grid;
  gap: var(--section-gap-mobile);
}

.hero-stage {
  margin: 0;
}

.hero-panel {
  position: relative;
  border-radius: var(--radius-hero);
  border: 1px solid rgb(255 255 255 / 8%);
  background: rgb(13 13 15 / 55%);
  backdrop-filter: blur(16px) saturate(140%);
  -webkit-backdrop-filter: blur(16px) saturate(140%);
  box-shadow:
    0 8px 32px rgb(0 0 0 / 28%),
    inset 0 1px 0 rgb(255 255 255 / 6%);
  padding: var(--space-5) 0 var(--space-5) var(--space-5);
  overflow: visible;
}

.hero-panel__layout {
  position: relative;
  z-index: 1;
  display: grid;
  gap: var(--space-8);
  align-items: center;
  min-width: 0;
}

.hero-panel__content {
  display: grid;
  gap: var(--space-8);
  min-width: 0;
}

.hero-panel__art {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  margin: 0 auto;
}

.hero__intro {
  display: grid;
  gap: var(--space-4);
}

.hero__search {
  display: grid;
  gap: var(--space-4);
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
  margin: 0;
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
  display: grid;
  gap: var(--space-6);
  padding-top: var(--space-5);
  border-top: 1px solid var(--color-border);
}

.landing-footer__col {
  min-width: 0;
}

.landing-footer__brand {
  display: grid;
  gap: var(--space-3);
  justify-items: start;
  align-content: start;
}

.landing-footer__logo {
  display: block;
  width: 5.5rem;
  height: 5.5rem;
  object-fit: contain;
}

.landing-footer__brand-name {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-sm);
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--color-gold-300);
}

.landing-footer__heading {
  margin: 0 0 var(--space-2);
  font-size: var(--text-sm);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text);
}

.landing-footer__lead,
.landing-footer__legal p {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  line-height: 1.45;
}

.landing-footer__legal {
  display: grid;
  gap: var(--space-3);
  align-content: start;
}

.landing-footer__contacts {
  list-style: none;
  margin: var(--space-4) 0 0;
  padding: 0;
  display: grid;
  gap: var(--space-3);
}

.landing-footer__contacts li {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.landing-footer__icon {
  flex: 0 0 2rem;
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  color: var(--color-gold-300);
}

.landing-footer__icon svg {
  width: 1.25rem;
  height: 1.25rem;
}

.landing-footer__contacts span:last-child {
  display: grid;
  gap: 0.1rem;
}

.landing-footer__label {
  font-family: var(--font-data);
  font-size: var(--text-xs);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.landing-footer__value {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text);
}

@media (min-width: 768px) {
  .landing-footer {
    grid-template-columns: minmax(7rem, 10rem) minmax(0, 1fr) minmax(0, 1.2fr);
    gap: var(--space-8);
    align-items: start;
  }
}

@media (min-width: 1024px) {
  .landing {
    gap: var(--section-gap-desktop);
  }

  .hero-stage {
    min-height: calc(88dvh - 5.5rem);
  }

  .hero-panel {
    padding: var(--space-6) 0 var(--space-6) var(--space-6);
    min-height: calc(88dvh - 7rem);
    display: flex;
    align-items: center;
  }

  .hero-panel__layout {
    position: relative;
    width: 100%;
    height: calc(88dvh - 10rem);
    min-height: calc(88dvh - 10rem);
    display: block;
  }

  .hero-panel__content {
    position: relative;
    z-index: 2;
    width: 75%;
    max-width: none;
  }

  .hero-panel__art {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 50%;
    max-width: none;
    margin: 0;
    z-index: 1;
  }
}
</style>
