<script setup lang="ts">
import { RouterLink, useRoute } from "vue-router";
import BrandMark from "../brand/BrandMark.vue";
import CharacterRealmSearch from "../search/CharacterRealmSearch.vue";

const route = useRoute();

function hashHref(hash: string): string {
  return route.name === "home" ? hash : `/${hash}`;
}
</script>

<template>
  <header class="app-header">
    <RouterLink class="brand" to="/" aria-label="M+ Trust Factor home">
      <BrandMark decorative size="md" />
      <span class="brand__text">
        <span class="brand__short">M+TS</span>
        <span class="brand__full">M+ Trust Factor</span>
      </span>
    </RouterLink>

    <nav class="nav" aria-label="Primary">
      <RouterLink to="/">Home</RouterLink>
      <a :href="hashHref('#features')">Features</a>
      <a :href="hashHref('#methodology')">Methodology</a>
      <RouterLink to="/compare">Compare</RouterLink>
    </nav>

    <div class="actions">
      <CharacterRealmSearch
        compact
        :show-recent="false"
        data-testid="navbar-search"
      />
    </div>
  </header>
</template>

<style scoped>
.app-header {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: var(--space-4);
  align-items: center;
  margin-bottom: var(--space-6);
  padding: var(--space-3) var(--space-5);
  position: sticky;
  top: var(--space-3);
  z-index: 40;
  border-radius: var(--radius-hero);
  border: 1px solid rgb(255 255 255 / 8%);
  background: rgb(13 13 15 / 55%);
  backdrop-filter: blur(16px) saturate(140%);
  -webkit-backdrop-filter: blur(16px) saturate(140%);
  box-shadow:
    0 4px 24px rgb(0 0 0 / 25%),
    inset 0 1px 0 rgb(255 255 255 / 6%);
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  text-decoration: none;
  color: inherit;
  min-width: 0;
}

.brand:hover,
.brand:focus-visible {
  text-decoration: none;
  color: inherit;
}

.brand__text {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}

.brand__short {
  font-family: var(--font-body);
  font-weight: 700;
  font-size: var(--text-lg);
  letter-spacing: 0.02em;
  color: var(--color-text);
  line-height: 1.1;
}

.brand__full {
  font-family: var(--font-body);
  font-size: var(--text-xs);
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-gold-300);
  line-height: 1.2;
}

.nav {
  display: flex;
  gap: var(--space-4);
  flex-wrap: wrap;
  align-items: center;
  grid-column: 1 / -1;
  order: 3;
}

.nav a {
  text-decoration: none;
  color: var(--color-text);
  font-weight: 600;
  font-size: var(--text-sm);
}

.nav a:hover,
.nav a:focus-visible {
  color: var(--color-brand-hover);
  text-decoration: underline;
  text-underline-offset: 0.3em;
}

.nav a.router-link-active {
  color: var(--color-brand);
  text-decoration: underline;
  text-underline-offset: 0.3em;
}

.actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-3);
  flex-wrap: wrap;
  min-width: 0;
}

@media (min-width: 768px) {
  .app-header {
    grid-template-columns: auto 1fr auto;
    margin-bottom: var(--space-8);
  }

  .nav {
    grid-column: auto;
    order: unset;
    gap: var(--space-5);
    justify-content: center;
  }
}

@media (max-width: 479px) {
  .brand__full {
    display: none;
  }
}
</style>
