<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";
import BrandMark from "../brand/BrandMark.vue";
import NavDropdown from "../common/NavDropdown.vue";
import CharacterRealmSearch from "../search/CharacterRealmSearch.vue";
import { useAuthSession } from "../../composables/useAuthSession";
import { accountCharacterPortraitSrc } from "../../lib/accountCharacters";
import { isAdminRoutePath, visibleAdminNavDestinations } from "../../lib/adminNav";
import { useAccountCharactersStore } from "../../stores/accountCharacters";

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

const route = useRoute();
const { authenticated, permissions, fetchAuthMe } = useAuthSession();
const accountStore = useAccountCharactersStore();

const adminNavItems = computed(() =>
  visibleAdminNavDestinations(permissions.value).map(({ path, label }) => ({ to: path, label })),
);
const showAdminNav = computed(() => adminNavItems.value.length > 0);
const adminNavActive = computed(() => isAdminRoutePath(route.path));

const primaryCharacter = computed(
  () => accountStore.characters.find((c) => c.isPrimary) ?? null,
);
const primaryPortraitSrc = computed(() =>
  primaryCharacter.value ? accountCharacterPortraitSrc(primaryCharacter.value) : null,
);

const searchOpen = ref(false);
const searchRootEl = ref<HTMLElement | null>(null);
const searchTriggerEl = ref<HTMLButtonElement | null>(null);

async function loadAccountRoster(): Promise<void> {
  if (!authenticated.value) {
    accountStore.reset();
    return;
  }
  await accountStore.ensureLoaded({ force: true });
}

onMounted(async () => {
  await fetchAuthMe(true);
  await loadAccountRoster();
});

watch(authenticated, () => {
  void loadAccountRoster();
});

function startBattlenetOAuth(): void {
  const returnTo = encodeURIComponent("/account");
  window.location.href = `${apiBase}/api/v1/auth/battlenet/start?returnTo=${returnTo}`;
}

function closeSearch(): void {
  if (!searchOpen.value) return;
  searchOpen.value = false;
  removeSearchListeners();
}

function openSearch(): void {
  searchOpen.value = true;
  addSearchListeners();
  void nextTick(() => {
    const input = searchRootEl.value?.querySelector<HTMLInputElement>("input");
    input?.focus();
  });
}

function toggleSearch(): void {
  if (searchOpen.value) closeSearch();
  else openSearch();
}

function addSearchListeners(): void {
  document.addEventListener("pointerdown", onSearchPointerDown);
  document.addEventListener("keydown", onSearchKeydown);
}

function removeSearchListeners(): void {
  document.removeEventListener("pointerdown", onSearchPointerDown);
  document.removeEventListener("keydown", onSearchKeydown);
}

function onSearchPointerDown(event: PointerEvent): void {
  if (!searchOpen.value || !searchRootEl.value) return;
  if (!searchRootEl.value.contains(event.target as Node)) closeSearch();
}

function onSearchKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && searchOpen.value) {
    event.preventDefault();
    closeSearch();
    searchTriggerEl.value?.focus();
  }
}

watch(
  () => route.fullPath,
  () => {
    closeSearch();
  },
);

onBeforeUnmount(() => {
  removeSearchListeners();
});
</script>

<template>
  <header class="app-header">
    <RouterLink class="brand" to="/" aria-label="M+ Trust Factor home">
      <BrandMark decorative size="md" />
      <span class="brand__short">M+TS</span>
    </RouterLink>

    <nav class="nav" aria-label="Primary">
      <RouterLink to="/">Home</RouterLink>
      <RouterLink to="/compare">Compare</RouterLink>
      <NavDropdown
        v-if="showAdminNav"
        label="Admin"
        panel-id="admin-nav-menu"
        :items="adminNavItems"
        :active="adminNavActive"
        data-testid="admin-nav-dropdown"
      />
    </nav>

    <div class="actions">
      <div ref="searchRootEl" class="search-disclosure">
        <button
          ref="searchTriggerEl"
          type="button"
          class="btn primary search-disclosure__trigger"
          :class="{ 'is-open': searchOpen }"
          :aria-expanded="searchOpen ? 'true' : 'false'"
          aria-controls="navbar-search-panel"
          data-testid="navbar-search-trigger"
          @click="toggleSearch"
        >
          Search
        </button>
        <div
          v-show="searchOpen"
          id="navbar-search-panel"
          class="search-disclosure__panel"
          data-testid="navbar-search-panel"
        >
          <CharacterRealmSearch
            compact
            :show-recent="false"
            data-testid="navbar-search"
          />
        </div>
      </div>

      <RouterLink
        v-if="authenticated"
        to="/account"
        class="account-nav"
        data-testid="navbar-account"
      >
        <span class="account-nav__label">Account</span>
        <img
          v-if="primaryPortraitSrc"
          class="account-nav__portrait"
          :src="primaryPortraitSrc"
          alt=""
          width="28"
          height="28"
          decoding="async"
        />
        <span
          v-else
          class="account-nav__portrait account-nav__portrait--empty"
          aria-hidden="true"
        />
      </RouterLink>

      <button
        v-else
        type="button"
        class="bnet-sync"
        data-testid="navbar-battlenet-sync"
        @click="startBattlenetOAuth"
      >
        <img
          class="bnet-sync__icon"
          src="/logos/blizzard.svg"
          alt=""
          width="72"
          height="18"
          decoding="async"
        />
        <span>Sync with Battle.net</span>
      </button>
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
  overflow: visible;
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

.brand__short {
  font-family: var(--font-body);
  font-weight: 700;
  font-size: var(--text-lg);
  letter-spacing: 0.02em;
  color: var(--color-text);
  line-height: 1.1;
}

.nav {
  display: flex;
  gap: var(--space-4);
  flex-wrap: wrap;
  align-items: center;
  grid-column: 1 / -1;
  order: 3;
  overflow: visible;
  min-width: 0;
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

.search-disclosure {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.search-disclosure__trigger {
  min-height: 2.5rem;
  padding: 0.4rem 0.95rem;
  white-space: nowrap;
}

.search-disclosure__panel {
  position: absolute;
  z-index: 60;
  top: calc(100% + 0.45rem);
  right: 0;
  width: min(28rem, calc(100vw - 2 * var(--gutter-mobile)));
  margin: 0;
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-surface-hover);
  box-shadow: 0 12px 32px rgb(0 0 0 / 45%);
}

.account-nav {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  min-height: 2.5rem;
  padding: 0.25rem 0.35rem 0.25rem 0.85rem;
  border-radius: var(--radius-control);
  border: 1px solid var(--color-border);
  background: var(--color-surface-hover);
  color: var(--color-text);
  font-weight: 600;
  font-size: var(--text-sm);
  text-decoration: none;
  white-space: nowrap;
}

.account-nav:hover,
.account-nav:focus-visible {
  color: var(--color-text);
  text-decoration: none;
  border-color: var(--color-gold-300);
}

.account-nav.router-link-active {
  border-color: var(--color-brand);
}

.account-nav__portrait {
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 999px;
  object-fit: cover;
  background: rgb(0 0 0 / 35%);
  flex-shrink: 0;
}

.account-nav__portrait--empty {
  display: inline-block;
  background: rgb(255 255 255 / 10%);
  border: 1px solid rgb(255 255 255 / 12%);
}

.bnet-sync {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  min-height: 2.5rem;
  padding: 0.4rem 0.95rem;
  border-radius: var(--radius-control);
  border: 1px solid #0b6fc4;
  background: #148eff;
  color: #fff;
  font: inherit;
  font-weight: 700;
  font-size: var(--text-sm);
  cursor: pointer;
  white-space: nowrap;
  box-shadow: 0 0 0 1px rgb(20 142 255 / 25%);
}

.bnet-sync:hover,
.bnet-sync:focus-visible {
  background: #3a9fff;
}

.bnet-sync:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}

.bnet-sync__icon {
  height: 0.95rem;
  width: auto;
  display: block;
  flex-shrink: 0;
  filter: brightness(0) invert(1);
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
  .bnet-sync span {
    display: none;
  }

  .bnet-sync {
    padding-inline: 0.7rem;
  }
}
</style>
