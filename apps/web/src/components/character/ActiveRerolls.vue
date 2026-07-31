<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import type { ActiveRerollCharacterDTO, Grade } from "@mplus/contracts";
import TrustTierBadge from "../landing/TrustTierBadge.vue";
import CharacterIdentity from "./CharacterIdentity.vue";
import { presentGrade } from "../../lib/characterViewModel";
import { classColor, classIconUrl } from "../../lib/wowClass";
import { canonicalCharacterPath } from "../../lib/format";

const props = defineProps<{
  characters: ActiveRerollCharacterDTO[];
}>();

const open = ref(false);
const rootEl = ref<HTMLElement | null>(null);
const triggerEl = ref<HTMLButtonElement | null>(null);
const listEl = ref<HTMLUListElement | null>(null);
const activeIndex = ref(0);

const show = computed(() => props.characters.length > 0);

function nameColor(c: ActiveRerollCharacterDTO): string {
  return c.classColor ?? classColor(c.classSlug);
}

function formatScore(rating: number | null | undefined): string {
  if (rating == null || !Number.isFinite(rating)) return "—";
  return String(Math.round(rating));
}

function gradeAsTier(grade: ActiveRerollCharacterDTO["grade"]): Grade | null {
  return grade;
}

function gradeAccessibleLabel(grade: ActiveRerollCharacterDTO["grade"]): string {
  const presentation = presentGrade(grade);
  return presentation.letter
    ? `Grade ${presentation.letter}`
    : "Grade unavailable";
}

function characterRoute(c: ActiveRerollCharacterDTO) {
  const path = canonicalCharacterPath(c.region, c.realmSlug, c.name);
  return {
    name: "character" as const,
    params: {
      region: path.region.toLowerCase(),
      realm: path.realm,
      name: path.name,
    },
  };
}

function optionLabel(c: ActiveRerollCharacterDTO): string {
  const realm = c.realmName ?? c.realmSlug;
  const score = formatScore(c.mythicPlusScore);
  const gradeLabel = gradeAccessibleLabel(c.grade);
  const main = c.isMain ? " MAIN" : "";
  return `${c.name} – ${realm} (${c.region.toUpperCase()}) – ${score}${main} – ${gradeLabel}`;
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
  const len = props.characters.length;
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
      activeIndex.value = Math.max(0, props.characters.length - 1);
      break;
    case "Escape":
      event.preventDefault();
      close();
      triggerEl.value?.focus();
      break;
    case "Enter":
    case " ": {
      event.preventDefault();
      const target = props.characters[activeIndex.value];
      if (!target) return;
      const link = listEl.value?.querySelector<HTMLAnchorElement>(
        `[data-character-id="${target.characterId}"]`,
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
    v-if="show"
    ref="rootEl"
    class="active-rerolls"
    data-testid="active-rerolls"
  >
    <p id="active-rerolls-label" class="active-rerolls__label">Active rerolls</p>

    <div class="active-rerolls__control">
      <button
        ref="triggerEl"
        type="button"
        class="active-rerolls__trigger"
        data-testid="active-rerolls-trigger"
        :aria-expanded="open ? 'true' : 'false'"
        aria-haspopup="listbox"
        aria-controls="active-rerolls-list"
        aria-labelledby="active-rerolls-label"
        @click="toggle"
      >
        Switch character
        <span class="active-rerolls__chevron" aria-hidden="true" />
      </button>

      <ul
        v-show="open"
        id="active-rerolls-list"
        ref="listEl"
        class="active-rerolls__list"
        role="listbox"
        tabindex="-1"
        aria-labelledby="active-rerolls-label"
        @keydown="onListKeydown"
      >
        <li
          v-for="(c, index) in characters"
          :key="c.characterId"
          role="option"
          :aria-selected="index === activeIndex"
          :class="{ 'is-active': index === activeIndex }"
        >
          <RouterLink
            class="active-rerolls__option"
            :to="characterRoute(c)"
            :data-character-id="c.characterId"
            :aria-label="optionLabel(c)"
            @click="close"
            @mouseenter="activeIndex = index"
          >
            <CharacterIdentity
              compact
              :region="c.region"
              :name="c.name"
              :realm-slug="c.realmSlug"
              :realm-name="c.realmName"
              :class-slug="c.classSlug"
              :class-color="nameColor(c)"
              :portrait-url="c.portraitUrl"
              :class-icon-url="classIconUrl(c.classSlug)"
              :size="28"
            />
            <span class="active-rerolls__score-group">
              <span class="active-rerolls__score mpts-data">{{ formatScore(c.mythicPlusScore) }}</span>
              <span
                v-if="c.isMain"
                class="main-chip"
                data-testid="reroll-main-chip"
              >MAIN</span>
            </span>
            <span class="active-rerolls__grade" data-testid="reroll-grade">
              <TrustTierBadge
                v-if="c.grade"
                :tier="gradeAsTier(c.grade)"
                size="sm"
                letter-only
                flush
              />
              <span
                v-else
                class="active-rerolls__grade-missing mpts-data"
                role="img"
                :aria-label="gradeAccessibleLabel(null)"
              >—</span>
            </span>
          </RouterLink>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.active-rerolls {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
  max-width: 32rem;
}

.active-rerolls__label {
  margin: 0;
  font-family: var(--font-data);
  font-size: var(--text-xs);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.active-rerolls__control {
  position: relative;
  min-width: 0;
}

.active-rerolls__trigger {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  width: 100%;
  max-width: 100%;
  padding: 0.4rem 0.65rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: color-mix(in srgb, var(--color-surface) 70%, transparent);
  color: var(--color-text);
  font: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
  text-align: left;
}

.active-rerolls__trigger:hover,
.active-rerolls__trigger:focus-visible {
  border-color: color-mix(in srgb, var(--color-gold-300) 55%, var(--color-border));
  outline: none;
}

.active-rerolls__trigger:focus-visible {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-focus) 55%, transparent);
}

.active-rerolls__chevron {
  width: 0.4rem;
  height: 0.4rem;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: rotate(45deg);
  transition: transform var(--duration-fast);
  flex-shrink: 0;
}

.active-rerolls__trigger[aria-expanded="true"] .active-rerolls__chevron {
  transform: rotate(-135deg);
}

.active-rerolls__list {
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

.active-rerolls__list:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}

.active-rerolls__option {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr) auto auto;
  gap: var(--space-2);
  align-items: center;
  padding: 0.4rem 0.55rem;
  border-radius: var(--radius-control);
  text-decoration: none;
  color: inherit;
}

.active-rerolls__list li.is-active .active-rerolls__option,
.active-rerolls__option:hover,
.active-rerolls__option:focus-visible {
  background: color-mix(in srgb, var(--color-gold-300) 12%, transparent);
  outline: none;
}

.active-rerolls__portrait {
  width: 1.75rem;
  height: 1.75rem;
  border-radius: var(--radius-control);
  object-fit: cover;
  background: var(--color-iron-800);
}

.active-rerolls__region {
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--color-text-muted);
}

.active-rerolls__name {
  font-weight: 600;
  font-size: var(--text-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.active-rerolls__score-group {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.active-rerolls__score {
  font-weight: 700;
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
  color: var(--color-text);
}

.main-chip {
  display: inline-flex;
  align-items: center;
  padding: 0.1rem 0.35rem;
  border: 1px solid color-mix(in srgb, var(--color-gold-300) 55%, var(--color-border));
  border-radius: var(--radius-control);
  background: color-mix(in srgb, var(--color-gold-300) 14%, transparent);
  color: var(--color-gold-300);
  font-family: var(--font-data);
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  line-height: 1.2;
}

.active-rerolls__grade {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  min-width: 1.5rem;
  justify-self: end;
  text-align: right;
}

.active-rerolls__grade-missing {
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--color-text-muted);
}

@media (max-width: 40rem) {
  .active-rerolls {
    max-width: none;
  }
}
</style>
