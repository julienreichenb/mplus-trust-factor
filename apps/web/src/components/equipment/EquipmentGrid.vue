<script setup lang="ts">
import { computed } from "vue";
import type { EquipmentSummary } from "../../api/types";
import { toEquipmentViewModel } from "../../lib/equipmentViewModel";
import EquipmentSlot from "./EquipmentSlot.vue";

const props = defineProps<{
  equipment: EquipmentSummary | null | undefined;
  locked?: boolean;
}>();

const view = computed(() => toEquipmentViewModel(props.equipment));
</script>

<template>
  <section class="equipment" aria-labelledby="equipment-title" data-testid="equipment-grid">
    <header class="equipment__head">
      <h2 id="equipment-title">Equipped inventory</h2>
      <p v-if="locked" class="muted">Equipment details are locked by entitlement.</p>
      <p v-else-if="!view" class="muted">No equipment snapshot is available for this character.</p>
      <p v-else class="meta">
        Equipped ilvl
        <span class="mpts-data">{{ view.equippedItemLevel ?? "—" }}</span>
        <template v-if="view.averageItemLevel != null">
          · avg <span class="mpts-data">{{ view.averageItemLevel }}</span>
        </template>
        · {{ view.filledCount }} keyed item{{ view.filledCount === 1 ? "" : "s" }} in snapshot
      </p>
    </header>

    <template v-if="!locked && view">
      <ul class="equipment__grid">
        <EquipmentSlot v-for="item in view.items" :key="item.id" :item="item" />
      </ul>
      <p class="note">
        Only items present in the current API snapshot are named. Empty slots are unavailable, not
        missing gear accusations. Icons and Wowhead links appear only when the payload provides trusted
        media URLs or item IDs.
      </p>
    </template>
  </section>
</template>

<style scoped>
.equipment {
  display: grid;
  gap: var(--space-4);
}

.equipment__head h2 {
  margin: 0 0 var(--space-2);
}

.meta,
.muted,
.note {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.equipment__grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-2);
  grid-template-columns: 1fr;
}

@media (min-width: 640px) {
  .equipment__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (min-width: 1100px) {
  .equipment__grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
</style>
