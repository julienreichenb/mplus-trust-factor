<script setup lang="ts">
import { RouterLink, useRoute } from "vue-router";
import { resolveApiMode } from "../../api/client";
import BrandMark from "../brand/BrandMark.vue";

const apiMode = resolveApiMode();
const route = useRoute();

function hashHref(hash: string): string {
  return route.name === "home" ? hash : `/${hash}`;
}
</script>

<template>
  <header class="app-header" data-testid="app-header">
    <div class="app-header__inner">
      <RouterLink class="brand" to="/" aria-label="M+ Trust Factor home">
        <BrandMark decorative size="md" />
        <span class="brand__text">
          <span class="brand__short">M+TS</span>
          <span class="brand__full">M+ Trust Factor</span>
        </span>
      </RouterLink>

      <nav class="nav" aria-label="Primary">
        <RouterLink to="/">Home</RouterLink>
        <a :href="hashHref('#comparison')">Why Trust</a>
        <a :href="hashHref('#methodology')">Methodology</a>
        <RouterLink to="/compare">Compare</RouterLink>
      </nav>

      <div class="actions">
        <a class="btn secondary search-cta" :href="hashHref('#character-search')">Search</a>
        <span class="mode-pill" data-testid="api-mode">API: {{ apiMode }}</span>
      </div>
    </div>
  </header>
</template>

<style scoped>
.app-header {
  position: sticky;
  top: 0;
  z-index: 40;
  margin: calc(-1 * var(--space-5)) calc(-1 * var(--space-5)) var(--space-8);
  padding: var(--space-3) var(--space-5);
  border-bottom: 1px solid var(--color-border);
  background: rgb(7 7 7 / 88%);
  backdrop-filter: blur(12px);
}

.app-header__inner {
  max-width: var(--container-page);
  margin: 0 auto;
  display: grid;
  grid-template-columns: 1fr auto;
  gap: var(--space-3);
  align-items: center;
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
}

.search-cta {
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding-inline: var(--space-4);
  border-color: rgb(244 213 141 / 45%);
  color: var(--color-gold-300);
  background: transparent;
  box-shadow: none;
  min-height: 2.5rem;
  font-size: var(--text-sm);
}

.search-cta:hover,
.search-cta:focus-visible {
  text-decoration: none;
  border-color: var(--color-gold-300);
  color: var(--color-text);
  background: var(--color-surface-hover);
}

@media (min-width: 768px) {
  .app-header {
    margin: calc(-1 * var(--space-6)) calc(-1 * var(--space-8)) var(--space-8);
    padding: var(--space-3) var(--space-8);
  }

  .app-header__inner {
    grid-template-columns: auto 1fr auto;
  }

  .nav {
    grid-column: auto;
    order: unset;
    gap: var(--space-5);
    justify-content: center;
  }
}

@media (min-width: 1024px) {
  .app-header {
    margin: calc(-1 * var(--space-6)) calc(-1 * var(--space-12)) var(--space-8);
    padding: var(--space-3) var(--space-12);
  }
}

@media (max-width: 479px) {
  .search-cta {
    padding-inline: var(--space-3);
  }

  .brand__full {
    display: none;
  }
}
</style>
