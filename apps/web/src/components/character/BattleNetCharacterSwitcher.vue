<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import type { AccountOwnedCharacterDTO } from "@mplus/contracts";
import {
  accountCharacterClassColor,
  accountCharacterPortraitSrc,
  accountCharacterRoute,
  formatAccountMythicScore,
  isOwnedAccountCharacter,
  switcherCharactersExcludingCurrent,
} from "../../lib/accountCharacters";

const props = defineProps<{
  characters: AccountOwnedCharacterDTO[];
  region: string;
  realm: string;
  name: string;
}>();

const open = ref(false);
const rootEl = ref<HTMLElement | null>(null);
const triggerEl = ref<HTMLButtonElement | null>(null);
const listEl = ref<HTMLUListElement | null>(null);
const activeIndex = ref(0);

const currentIdentity = computed(() => ({
  region: props.region,
  realmSlug: props.realm,
  name: props.name,
}));

const ownedCurrent = computed(() =>
  isOwnedAccountCharacter(props.characters, currentIdentity.value),
);

const options = computed(() =>
  switcherCharactersExcludingCurrent(props.characters, currentIdentity.value),
);

const showSwitcher = computed(() => props.characters.length > 0);

function optionLabel(c: AccountOwnedCharacterDTO): string {
  const realm = c.realmName ?? c.realmSlug;
  const score = formatAccountMythicScore(c.currentSeasonMythic.rating);
  return `${c.name} – ${realm} (${c.region.toUpperCase()}) – ${score}`;
}

function close(): void {
  open.value = false;
}

function toggle(): void {
  open.value = !open.value;
  if (open.value) {
    activeIndex.value = 0;
    void nextTick(() => {
      listEl.value?.focus();
    });
  }
}

function onDocumentPointerDown(event: MouseEvent): void {
  if (!open.value || !rootEl.value) return;
  if (!rootEl.value.contains(event.target as Node)) close();
}

function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && open.value) {
    event.preventDefault();
    close();
    triggerEl.value?.focus();
  }
}

function moveActive(delta: number): void {
  const len = options.value.length;
  if (len === 0) return;
  activeIndex.value = (activeIndex.value + delta + len) % len;
}

function onListKeydown(event: KeyboardEvent): void {
  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      moveActive(1);
      break;
    case "ArrowUp":
      event.preventDefault();
      moveActive(-1);
      break;
    case "Home":
      event.preventDefault();
      activeIndex.value = 0;
      break;
    case "End":
      event.preventDefault();
      activeIndex.value = Math.max(0, options.value.length - 1);
      break;
    case "Escape":
      event.preventDefault();
      close();
      triggerEl.value?.focus();
      break;
    case "Enter":
    case " ": {
      event.preventDefault();
      const target = options.value[activeIndex.value];
      if (!target) return;
      const link = listEl.value?.querySelector<HTMLAnchorElement>(
        `[data-ownership-id="${target.ownershipId}"]`,
      );
      link?.click();
      break;
    }
    default:
      break;
  }
}

watch(open, (isOpen) => {
  if (isOpen) {
    document.addEventListener("pointerdown", onDocumentPointerDown);
    document.addEventListener("keydown", onDocumentKeydown);
  } else {
    document.removeEventListener("pointerdown", onDocumentPointerDown);
    document.removeEventListener("keydown", onDocumentKeydown);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocumentPointerDown);
  document.removeEventListener("keydown", onDocumentKeydown);
});
</script>

<template>
  <div
    v-if="showSwitcher"
    ref="rootEl"
    class="bnet-switcher"
    data-testid="battlenet-character-switcher"
  >
    <div class="bnet-switcher__header">
      <p id="bnet-switcher-label" class="bnet-switcher__label">Mes personnages Battle.net</p>
      <span
        v-if="ownedCurrent"
        class="bnet-badge"
        data-testid="battlenet-owned-badge"
        title="Personnage associé à votre compte Battle.net"
      >
        <svg
          class="bnet-badge__icon"
          viewBox="0 0 24 24"
          width="14"
          height="14"
          aria-hidden="true"
          focusable="false"
        >
          <path
            fill="currentColor"
            d="M17 7h-1V5a4 4 0 0 0-8 0v2H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2Zm-7-2a2 2 0 1 1 4 0v2h-4V5Zm3 10.7a1.8 1.8 0 1 1 0-3.6 1.8 1.8 0 0 1 0 3.6Z"
          />
        </svg>
        <span class="bnet-badge__text">Battle.net</span>
        <span class="sr-only">Personnage associé à votre compte Battle.net</span>
      </span>
    </div>

    <div class="bnet-switcher__control">
      <button
        ref="triggerEl"
        type="button"
        class="bnet-switcher__trigger"
        data-testid="battlenet-switcher-trigger"
        :aria-expanded="open ? 'true' : 'false'"
        aria-haspopup="listbox"
        aria-controls="bnet-switcher-list"
        aria-labelledby="bnet-switcher-label"
        @click="toggle"
      >
        Changer de personnage
        <span class="bnet-switcher__chevron" aria-hidden="true" />
      </button>

      <ul
        v-show="open"
        id="bnet-switcher-list"
        ref="listEl"
        class="bnet-switcher__list"
        role="listbox"
        tabindex="-1"
        aria-labelledby="bnet-switcher-label"
        @keydown="onListKeydown"
      >
        <li
          v-for="(c, index) in options"
          :key="c.ownershipId"
          role="option"
          :aria-selected="index === activeIndex"
          :class="{ 'is-active': index === activeIndex }"
        >
          <RouterLink
            class="bnet-switcher__option"
            :to="accountCharacterRoute(c)"
            :data-ownership-id="c.ownershipId"
            :aria-label="optionLabel(c)"
            @click="close"
            @mouseenter="activeIndex = index"
          >
            <img
              class="bnet-switcher__portrait"
              :src="accountCharacterPortraitSrc(c) ?? undefined"
              alt=""
              width="32"
              height="32"
            />
            <span class="bnet-switcher__meta">
              <span
                class="bnet-switcher__name"
                :style="{ color: accountCharacterClassColor(c) }"
              >{{ c.name }}</span>
              <span class="bnet-switcher__detail mpts-data">
                {{ c.realmName ?? c.realmSlug }} ({{ c.region.toUpperCase() }}) –
                {{ formatAccountMythicScore(c.currentSeasonMythic.rating) }}
              </span>
            </span>
          </RouterLink>
        </li>
        <li v-if="options.length === 0" class="bnet-switcher__empty" role="presentation">
          Aucun autre personnage lié
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.bnet-switcher {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}

.bnet-switcher__header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
}

.bnet-switcher__label {
  margin: 0;
  font-family: var(--font-data);
  font-size: var(--text-xs);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.bnet-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.2rem 0.5rem;
  border: 1px solid color-mix(in srgb, var(--color-info-500) 45%, var(--color-border));
  border-radius: var(--radius-control);
  background: color-mix(in srgb, var(--color-info-500) 12%, transparent);
  color: var(--color-info-500);
  font-size: var(--text-xs);
  font-weight: 600;
}

.bnet-badge__icon {
  flex-shrink: 0;
}

.bnet-switcher__control {
  position: relative;
  max-width: 28rem;
}

.bnet-switcher__trigger {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  width: 100%;
  max-width: 100%;
  padding: 0.55rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  cursor: pointer;
  text-align: left;
}

.bnet-switcher__trigger:hover,
.bnet-switcher__trigger:focus-visible {
  border-color: color-mix(in srgb, var(--color-gold-300) 55%, var(--color-border));
}

.bnet-switcher__chevron {
  width: 0.45rem;
  height: 0.45rem;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: rotate(45deg);
  transition: transform var(--duration-fast);
  flex-shrink: 0;
}

.bnet-switcher__trigger[aria-expanded="true"] .bnet-switcher__chevron {
  transform: rotate(-135deg);
}

.bnet-switcher__list {
  position: absolute;
  z-index: 30;
  top: calc(100% + 0.35rem);
  left: 0;
  right: 0;
  margin: 0;
  padding: var(--space-1);
  list-style: none;
  max-height: min(18rem, 50dvh);
  overflow: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-surface-hover);
  box-shadow: 0 12px 32px rgb(0 0 0 / 40%);
}

.bnet-switcher__list:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}

.bnet-switcher__option {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--space-3);
  align-items: center;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-control);
  text-decoration: none;
  color: inherit;
}

.bnet-switcher__list li.is-active .bnet-switcher__option,
.bnet-switcher__option:hover,
.bnet-switcher__option:focus-visible {
  background: color-mix(in srgb, var(--color-gold-300) 12%, transparent);
}

.bnet-switcher__portrait {
  width: 2rem;
  height: 2rem;
  border-radius: var(--radius-control);
  object-fit: cover;
  background: var(--color-iron-800);
}

.bnet-switcher__meta {
  display: grid;
  gap: 0.15rem;
  min-width: 0;
}

.bnet-switcher__name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bnet-switcher__detail {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bnet-switcher__empty {
  padding: var(--space-3);
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

@media (max-width: 40rem) {
  .bnet-switcher__control {
    max-width: none;
  }
}
</style>
