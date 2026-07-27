<script setup lang="ts">
import { ref, watch } from "vue";
import type { EquipmentItemViewModel } from "../../lib/equipmentViewModel";
import WowheadLink from "../integrations/WowheadLink.vue";

const props = defineProps<{
  item: EquipmentItemViewModel;
}>();

const iconFailed = ref(false);

watch(
  () => props.item.iconUrl,
  () => {
    iconFailed.value = false;
  },
);

function onIconError(): void {
  iconFailed.value = true;
}
</script>

<template>
  <li
    class="slot"
    :data-filled="item.isAvailable ? 'true' : 'false'"
    :data-slot="item.id"
    :data-quality="item.quality ?? undefined"
  >
    <div class="slot__icon" aria-hidden="true">
      <img
        v-if="item.iconUrl && !iconFailed"
        class="slot__icon-img"
        :src="item.iconUrl"
        :alt="item.name ? `${item.name} icon` : `${item.slotLabel} icon`"
        width="40"
        height="40"
        loading="lazy"
        decoding="async"
        @error="onIconError"
      />
    </div>

    <div class="slot__body">
      <span class="slot__label">{{ item.slotLabel }}</span>

      <template v-if="item.isAvailable">
        <span class="slot__name">{{ item.name }}</span>
        <span v-if="item.quality" class="slot__quality">
          Quality: <span class="slot__quality-value">{{ item.quality }}</span>
        </span>
        <span v-if="item.itemLevel != null" class="slot__ilvl mpts-data">ilvl {{ item.itemLevel }}</span>
        <span v-if="item.enchantment" class="slot__meta">Enchant: {{ item.enchantment }}</span>
        <span v-if="item.gems.length" class="slot__meta">
          Gems: {{ item.gems.map((g) => g.name).join(", ") }}
        </span>
        <WowheadLink
          v-if="item.externalUrl"
          class="slot__link"
          :href="item.externalUrl"
          :item-id="item.itemId"
          :label="`Open ${item.name ?? item.slotLabel} on Wowhead`"
        />
      </template>
      <span v-else class="slot__empty">Unavailable</span>
    </div>
  </li>
</template>

<style scoped>
.slot {
  display: grid;
  grid-template-columns: 2.5rem 1fr;
  gap: var(--space-3);
  align-items: start;
  min-height: 3.25rem;
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-obsidian-900);
}

.slot[data-filled="false"] {
  border-style: dashed;
  background: transparent;
  align-items: center;
}

.slot__icon {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: var(--radius-control);
  border: 1px solid var(--color-border);
  background:
    linear-gradient(145deg, rgb(244 213 141 / 12%), transparent 55%),
    var(--color-iron-800);
  overflow: hidden;
  flex-shrink: 0;
}

.slot[data-filled="false"] .slot__icon {
  border-style: dashed;
  background: var(--color-iron-850);
}

.slot__icon-img {
  display: block;
  width: 2.5rem;
  height: 2.5rem;
  object-fit: cover;
}

.slot__body {
  display: grid;
  gap: 0.15rem;
  min-width: 0;
}

.slot__label {
  font-family: var(--font-data);
  font-size: var(--text-xs);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.slot__name {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text);
  overflow-wrap: anywhere;
}

.slot[data-quality="epic"] .slot__name,
.slot[data-quality="Epic"] .slot__name {
  color: #a335ee;
}

.slot[data-quality="legendary"] .slot__name,
.slot[data-quality="Legendary"] .slot__name {
  color: #ff8000;
}

.slot[data-quality="rare"] .slot__name,
.slot[data-quality="Rare"] .slot__name {
  color: #0070dd;
}

.slot__quality,
.slot__empty,
.slot__ilvl,
.slot__meta {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.slot__quality-value {
  color: var(--color-text);
  font-weight: 600;
}

.slot__link {
  margin-top: var(--space-1);
  justify-self: start;
  min-height: 2.5rem;
  display: inline-flex;
  align-items: center;
}
</style>
