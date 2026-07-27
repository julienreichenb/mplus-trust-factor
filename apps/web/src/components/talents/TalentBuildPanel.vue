<script setup lang="ts">
import type { TalentSummary } from "../../api/types";
import { humanizeSlug } from "../../lib/characterViewModel";

defineProps<{
  talents: TalentSummary | null | undefined;
  locked?: boolean;
}>();
</script>

<template>
  <section class="talents" aria-labelledby="talents-title" data-testid="talent-build">
    <h2 id="talents-title">Talent build</h2>

    <p v-if="locked" class="muted">Talent details are locked by entitlement.</p>
    <template v-else-if="!talents">
      <p class="muted">No talent snapshot is available for this character.</p>
    </template>
    <template v-else>
      <dl class="facts">
        <div>
          <dt>Specialization</dt>
          <dd>{{ humanizeSlug(talents.specializationSlug) ?? "Unavailable" }}</dd>
        </div>
        <div>
          <dt>Summary</dt>
          <dd>{{ talents.summary?.trim() || "Unavailable" }}</dd>
        </div>
      </dl>

      <div v-if="talents.loadoutCode" class="loadout">
        <h3>Loadout code</h3>
        <p class="loadout__code mpts-data">{{ talents.loadoutCode }}</p>
      </div>
      <p v-else class="muted">No import/loadout string is present in this snapshot.</p>

      <p class="note">
        A full talent-tree visualization is not available from the current frontend contract. Selected
        nodes and Wowhead talent links are deferred.
      </p>
    </template>
  </section>
</template>

<style scoped>
.talents {
  display: grid;
  gap: var(--space-4);
}

.talents h2,
.talents h3 {
  margin: 0;
}

.facts {
  display: grid;
  gap: var(--space-3);
  margin: 0;
}

.facts dt {
  font-size: var(--text-xs);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.facts dd {
  margin: var(--space-1) 0 0;
  color: var(--color-text);
}

.loadout {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-surface);
}

.loadout__code {
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--color-gold-300);
  font-size: var(--text-sm);
}

.muted,
.note {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}
</style>
