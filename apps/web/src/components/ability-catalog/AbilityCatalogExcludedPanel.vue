<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../../api/client";

const emit = defineEmits<{
  changed: [];
}>();

const loading = ref(false);
const error = ref<string | null>(null);
const exclusions = ref<
  Array<{
    id: string;
    stableAbilityIdentity: string;
    canonicalKey: string | null;
    primarySpellId: number | null;
    updatedAt: string;
  }>
>([]);

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const result = await api.listAbilityCatalogExclusions();
    exclusions.value = result.exclusions ?? [];
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to load exclusions";
  } finally {
    loading.value = false;
  }
}

async function restore(exclusion: (typeof exclusions.value)[number]): Promise<void> {
  if (
    !window.confirm(
      "Clear this exclusion? The ability becomes unclassified unless it is still in the active catalog.",
    )
  ) {
    return;
  }
  try {
    await api.clearAbilityCatalogExclusion({
      canonicalKey: exclusion.canonicalKey ?? undefined,
      primarySpellId: exclusion.primarySpellId ?? undefined,
    });
    emit("changed");
    await load();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to clear exclusion";
  }
}

onMounted(() => {
  void load();
});

defineExpose({ reload: load });
</script>

<template>
  <section class="excluded-panel" data-testid="catalog-excluded-panel">
    <p v-if="loading" class="muted">Loading exclusions…</p>
    <p v-else-if="exclusions.length === 0" class="muted">No durable M+ exclusions.</p>
    <ul v-else class="excluded-list">
      <li v-for="row in exclusions" :key="row.id" class="excluded-row">
        <div>
          <strong>{{ row.canonicalKey ?? `spell:${row.primarySpellId}` }}</strong>
          <p class="muted">{{ row.stableAbilityIdentity }}</p>
        </div>
        <button type="button" class="btn secondary" @click="restore(row)">Restore</button>
      </li>
    </ul>
    <p v-if="error" class="error">{{ error }}</p>
  </section>
</template>

<style scoped>
.excluded-panel {
  display: grid;
  gap: 0.65rem;
}

.excluded-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.45rem;
}

.excluded-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  padding: 0.55rem 0.7rem;
  background: var(--color-surface);
}

.muted {
  margin: 0.15rem 0 0;
  color: var(--color-text-muted, var(--muted));
  font-size: 0.85rem;
}

.error {
  color: var(--color-danger, #c44);
  margin: 0;
}
</style>
