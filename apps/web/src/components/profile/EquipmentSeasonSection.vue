<script setup lang="ts">
import type { EquipmentSummary, TalentSummary, SeasonSummary } from "../../api/types";

defineProps<{
  equipment: EquipmentSummary | null;
  talents: TalentSummary | null;
  season: SeasonSummary | null;
  locked?: boolean;
}>();
</script>

<template>
  <div class="stack">
    <section aria-labelledby="gear-title">
      <h2 id="gear-title">Equipment & talents</h2>
      <p v-if="locked" class="muted">Locked by entitlement.</p>
      <template v-else>
        <p v-if="equipment">
          Equipped ilvl {{ equipment.equippedItemLevel ?? "—" }}
          <span v-if="equipment.averageItemLevel != null">
            (avg {{ equipment.averageItemLevel }})
          </span>
        </p>
        <ul v-if="equipment?.keyItems?.length">
          <li v-for="item in equipment.keyItems" :key="item.slot + item.name">
            {{ item.slot }}: {{ item.name }}
            <span v-if="item.itemLevel != null">({{ item.itemLevel }})</span>
          </li>
        </ul>
        <p v-if="talents">
          Spec {{ talents.specializationSlug ?? "—" }}
          <span v-if="talents.summary"> — {{ talents.summary }}</span>
        </p>
        <p v-if="talents?.loadoutCode" class="muted">Loadout: {{ talents.loadoutCode }}</p>
      </template>
    </section>

    <section aria-labelledby="season-title">
      <h2 id="season-title">Season summary</h2>
      <p v-if="!season" class="muted">No season summary.</p>
      <dl v-else class="season">
        <div>
          <dt>Season</dt>
          <dd>{{ season.seasonSlug }}</dd>
        </div>
        <div>
          <dt>Runs</dt>
          <dd>{{ season.runCount }}</dd>
        </div>
        <div>
          <dt>Mythic+ rating</dt>
          <dd>{{ season.mythicRating ?? "—" }}</dd>
        </div>
        <div>
          <dt>Prior season</dt>
          <dd>{{ season.priorSeasonRating ?? "—" }}</dd>
        </div>
      </dl>
    </section>
  </div>
</template>

<style scoped>
.stack {
  display: grid;
  gap: 1.25rem;
}

.season {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
  gap: 0.75rem;
  margin: 0;
}

dt {
  font-size: 0.7rem;
  text-transform: uppercase;
  color: var(--muted);
}

dd {
  margin: 0.15rem 0 0;
  font-weight: 600;
}

.muted {
  color: var(--muted);
}
</style>
