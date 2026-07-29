<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { EquipmentSummary } from "../../api/types";
import {
  resolveItemWowheadData,
  resolveItemWowheadUrl,
  toHeroGearItems,
  type EquipmentItemViewModel,
} from "../../lib/equipmentViewModel";
import {
  loadWowheadTooltipScript,
  refreshWowheadTooltips,
} from "../../integrations/wowhead/tooltips";

const props = defineProps<{
  equipment: EquipmentSummary | null | undefined;
  locked?: boolean;
}>();

const items = computed(() => toHeroGearItems(props.equipment));
const highlights = computed(() => items.value.filter((item) => item.isHeroHighlight));
const rest = computed(() => items.value.filter((item) => !item.isHeroHighlight));
const iconFailed = ref<Record<string, boolean>>({});

watch(
  items,
  (next) => {
    const keep: Record<string, boolean> = {};
    for (const item of next) {
      if (iconFailed.value[item.id]) keep[item.id] = true;
    }
    iconFailed.value = keep;
    void loadWowheadTooltipScript()
      .then((status) => {
        if (status === "ready") refreshWowheadTooltips();
      })
      .catch(() => {
        /* degrade to plain links */
      });
  },
  { immediate: true },
);

function onIconError(item: EquipmentItemViewModel): void {
  iconFailed.value = { ...iconFailed.value, [item.id]: true };
}

function hrefFor(item: EquipmentItemViewModel): string | null {
  return resolveItemWowheadUrl(item);
}

function wowheadDataFor(item: EquipmentItemViewModel): string | undefined {
  return resolveItemWowheadData(item) ?? undefined;
}
</script>

<template>
  <div class="hero-gear" data-testid="hero-gear">
    <p v-if="locked" class="muted">Equipment details are locked by entitlement.</p>
    <p v-else-if="!items.length" class="muted">No equipped items in this snapshot.</p>
    <template v-else>
      <ul v-if="highlights.length" class="hero-gear__highlights" aria-label="Key equipped gear">
        <li
          v-for="item in highlights"
          :key="item.id"
          class="hero-gear__item"
          data-highlight="true"
          :data-embellished="item.isEmbellished ? 'true' : 'false'"
          :data-quality="item.quality ?? undefined"
        >
          <a
            v-if="hrefFor(item)"
            class="hero-gear__link"
            :href="hrefFor(item)!"
            target="_blank"
            rel="noopener noreferrer"
            :data-wowhead="wowheadDataFor(item)"
            :aria-label="`${item.name ?? item.slotLabel} on Wowhead`"
          >
            <span class="hero-gear__icon" aria-hidden="true">
              <img
                v-if="item.iconUrl && !iconFailed[item.id]"
                :src="item.iconUrl"
                alt=""
                loading="lazy"
                decoding="async"
                @error="onIconError(item)"
              />
            </span>
            <span class="hero-gear__meta">
              <span class="hero-gear__slot">{{ item.slotLabel }}</span>
              <span class="hero-gear__name">{{ item.name }}</span>
              <span v-if="item.itemLevel != null" class="hero-gear__ilvl mpts-data"
                >ilvl {{ item.itemLevel }}</span
              >
              <span v-if="item.isEmbellished" class="hero-gear__badge">Embellished</span>
            </span>
          </a>
          <div v-else class="hero-gear__link hero-gear__link--static">
            <span class="hero-gear__icon" aria-hidden="true">
              <img
                v-if="item.iconUrl && !iconFailed[item.id]"
                :src="item.iconUrl"
                alt=""
                loading="lazy"
                decoding="async"
                @error="onIconError(item)"
              />
            </span>
            <span class="hero-gear__meta">
              <span class="hero-gear__slot">{{ item.slotLabel }}</span>
              <span class="hero-gear__name">{{ item.name }}</span>
              <span v-if="item.itemLevel != null" class="hero-gear__ilvl mpts-data"
                >ilvl {{ item.itemLevel }}</span
              >
              <span v-if="item.isEmbellished" class="hero-gear__badge">Embellished</span>
            </span>
          </div>
        </li>
      </ul>

      <ul v-if="rest.length" class="hero-gear__rest" aria-label="Other equipped gear">
        <li
          v-for="item in rest"
          :key="item.id"
          class="hero-gear__item"
          data-highlight="false"
          :data-embellished="item.isEmbellished ? 'true' : 'false'"
          :data-quality="item.quality ?? undefined"
        >
          <a
            v-if="hrefFor(item)"
            class="hero-gear__link"
            :href="hrefFor(item)!"
            target="_blank"
            rel="noopener noreferrer"
            :data-wowhead="wowheadDataFor(item)"
            :aria-label="`${item.name ?? item.slotLabel} on Wowhead`"
          >
            <span class="hero-gear__icon" aria-hidden="true">
              <img
                v-if="item.iconUrl && !iconFailed[item.id]"
                :src="item.iconUrl"
                alt=""
                loading="lazy"
                decoding="async"
                @error="onIconError(item)"
              />
            </span>
            <span class="hero-gear__meta">
              <span class="hero-gear__slot">{{ item.slotLabel }}</span>
              <span class="hero-gear__name">{{ item.name }}</span>
              <span v-if="item.itemLevel != null" class="hero-gear__ilvl mpts-data"
                >ilvl {{ item.itemLevel }}</span
              >
            </span>
          </a>
          <div v-else class="hero-gear__link hero-gear__link--static">
            <span class="hero-gear__icon" aria-hidden="true">
              <img
                v-if="item.iconUrl && !iconFailed[item.id]"
                :src="item.iconUrl"
                alt=""
                loading="lazy"
                decoding="async"
                @error="onIconError(item)"
              />
            </span>
            <span class="hero-gear__meta">
              <span class="hero-gear__slot">{{ item.slotLabel }}</span>
              <span class="hero-gear__name">{{ item.name }}</span>
              <span v-if="item.itemLevel != null" class="hero-gear__ilvl mpts-data"
                >ilvl {{ item.itemLevel }}</span
              >
            </span>
          </div>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.hero-gear {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
}

.muted {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.hero-gear__highlights,
.hero-gear__rest {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-2);
}

.hero-gear__highlights {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.hero-gear__highlights > :last-child:nth-child(odd) {
  grid-column: 1 / -1;
}

.hero-gear__rest {
  grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
}

.hero-gear__link {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--space-3);
  align-items: center;
  padding: var(--space-2) var(--space-3);
  border: 1px solid rgb(255 255 255 / 12%);
  border-radius: var(--radius-card);
  background: rgb(13 13 15 / 52%);
  backdrop-filter: blur(16px) saturate(140%);
  -webkit-backdrop-filter: blur(16px) saturate(140%);
  box-shadow:
    0 8px 22px rgb(0 0 0 / 28%),
    inset 0 1px 0 rgb(255 255 255 / 8%);
  text-decoration: none;
  color: inherit;
  min-height: 100%;
  transition:
    border-color var(--duration-fast),
    background-color var(--duration-fast),
    box-shadow var(--duration-fast);
}

.hero-gear__link--static {
  cursor: default;
}

.hero-gear__link:hover,
.hero-gear__link:focus-visible {
  border-color: rgb(244 213 141 / 42%);
  background: rgb(18 18 22 / 62%);
  box-shadow:
    0 10px 26px rgb(0 0 0 / 34%),
    inset 0 1px 0 rgb(255 255 255 / 10%);
  outline: none;
}

.hero-gear__item[data-highlight="true"] .hero-gear__link {
  border-color: rgb(244 213 141 / 28%);
  background: rgb(18 16 12 / 55%);
}

.hero-gear__item[data-highlight="false"] .hero-gear__link {
  padding: var(--space-1) var(--space-2);
  gap: var(--space-2);
  box-shadow:
    0 4px 14px rgb(0 0 0 / 22%),
    inset 0 1px 0 rgb(255 255 255 / 6%);
}

.hero-gear__icon {
  display: block;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: var(--radius-control);
  border: 1px solid rgb(255 255 255 / 14%);
  background:
    linear-gradient(145deg, rgb(244 213 141 / 14%), transparent 55%),
    var(--color-iron-800);
  overflow: hidden;
  flex-shrink: 0;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 10%);
}

.hero-gear__item[data-highlight="true"] .hero-gear__icon {
  width: 3.25rem;
  height: 3.25rem;
}

.hero-gear__item[data-highlight="false"] .hero-gear__icon {
  width: 2rem;
  height: 2rem;
}

.hero-gear__icon img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.hero-gear__meta {
  display: grid;
  gap: 0.12rem;
  min-width: 0;
  align-content: center;
}

.hero-gear__slot {
  font-family: var(--font-data);
  font-size: 0.65rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.hero-gear__name {
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--color-text);
  overflow-wrap: anywhere;
  line-height: 1.3;
}

.hero-gear__item[data-highlight="true"] .hero-gear__name {
  font-size: var(--text-sm);
}

.hero-gear__item[data-quality="epic"] .hero-gear__name,
.hero-gear__item[data-quality="Epic"] .hero-gear__name {
  color: #a335ee;
}

.hero-gear__item[data-quality="legendary"] .hero-gear__name,
.hero-gear__item[data-quality="Legendary"] .hero-gear__name {
  color: #ff8000;
}

.hero-gear__item[data-quality="rare"] .hero-gear__name,
.hero-gear__item[data-quality="Rare"] .hero-gear__name {
  color: #0070dd;
}

.hero-gear__ilvl {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

.hero-gear__item[data-highlight="false"] .hero-gear__ilvl {
  display: none;
}

.hero-gear__badge {
  justify-self: start;
  margin-top: 0.15rem;
  font-family: var(--font-data);
  font-size: 0.6rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-gold-300);
}

@media (max-width: 479px) {
  .hero-gear__highlights {
    grid-template-columns: 1fr;
  }

  .hero-gear__highlights > :last-child:nth-child(odd) {
    grid-column: auto;
  }
}
</style>
