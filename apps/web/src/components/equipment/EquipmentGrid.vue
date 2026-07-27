<script setup lang="ts">
import { computed } from "vue";
import type { EquipmentSummary } from "../../api/types";
import { mapEquipmentSlots } from "../../lib/characterViewModel";
import EquipmentSlot from "./EquipmentSlot.vue";

const props = defineProps<{
  equipment: EquipmentSummary | null | undefined;
  locked?: boolean;
}>();

const slots = computed(() => mapEquipmentSlots(props.equipment));
const filledCount = computed(() => slots.value.filter((s) => s.filled).length);
</script>

<template>
  <section class="equipment" aria-labelledby="equipment-title" data-testid="equipment-grid">
    <header class="equipment__head">
      <h2 id="equipment-title">Equipped inventory</h2>
      <p v-if="locked" class="muted">Equipment details are locked by entitlement.</p>
      <p v-else-if="!equipment" class="muted">No equipment snapshot is available for this character.</p>
      <p v-else class="meta">
        Equipped ilvl
        <span class="mpts-data">{{ equipment.equippedItemLevel ?? "—" }}</span>
        <template v-if="equipment.averageItemLevel != null">
          · avg <span class="mpts-data">{{ equipment.averageItemLevel }}</span>
        </template>
        · {{ filledCount }} keyed item{{ filledCount === 1 ? "" : "s" }} in snapshot
      </p>
    </header>

    <template v-if="!locked && equipment">
      <ul class="equipment__grid">
        <EquipmentSlot v-for="slot in slots" :key="slot.id" :slot-view="slot" />
      </ul>
      <p class="note">
        Only items present in the current API snapshot are named. Empty slots are unavailable, not
        missing gear accusations. Icons and Wowhead enrichment are not enabled in this phase.
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
