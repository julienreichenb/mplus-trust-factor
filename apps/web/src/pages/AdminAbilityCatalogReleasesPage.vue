<script setup lang="ts">
/**
 * Ability catalog release history — rollback only.
 * Normal publication uses POST /api/v1/admin/ability-catalog/publish.
 */
import { onMounted, ref } from "vue";
import { api } from "../api/client";
import StatusBanner from "../components/common/StatusBanner.vue";

type ReleaseRow = {
  id: string;
  releaseKey: string;
  contentDigest: string;
  status: string;
  publishedAt?: string | null;
};

const props = withDefaults(
  defineProps<{
    /** When true, hide page chrome (used inside Ability catalog console tabs). */
    embedded?: boolean;
  }>(),
  { embedded: false },
);

const loading = ref(true);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const success = ref<string | null>(null);
const active = ref<ReleaseRow | null>(null);
const releases = ref<ReleaseRow[]>([]);
const limitations = ref<{ racialReplayCoverage?: string; trustReplay?: string }>({});
const rollbackReason = ref("");
const busyId = ref<string | null>(null);

async function refresh(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const [activeRes, listRes] = await Promise.all([
      api.getAbilityCatalogActiveRelease(),
      api.listAbilityCatalogReleases(),
    ]);
    active.value = activeRes.active;
    limitations.value = activeRes.limitations ?? {};
    notice.value = activeRes.notice ?? null;
    releases.value = listRes.releases ?? [];
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function rollback(row: ReleaseRow): Promise<void> {
  if (!rollbackReason.value.trim()) {
    error.value = "Rollback requires a reason";
    return;
  }
  if (
    !confirm(
      `Rollback / re-activate ${row.releaseKey}?\nReason: ${rollbackReason.value}\n\nDigest: ${row.contentDigest}\n\nQueued jobs keep their existing pins.`,
    )
  ) {
    return;
  }
  busyId.value = row.id;
  error.value = null;
  success.value = null;
  try {
    await api.rollbackAbilityCatalogRelease(row.id, {
      confirmationDigest: row.contentDigest,
      confirm: true,
      reason: rollbackReason.value.trim(),
      expectedPreviousActiveId: active.value?.id ?? null,
    });
    rollbackReason.value = "";
    await refresh();
    success.value = `Rolled back to ${row.releaseKey}.`;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busyId.value = null;
  }
}

onMounted(() => {
  void refresh();
});
</script>

<template>
  <section
    class="releases-page"
    :class="{ 'releases-page--embedded': props.embedded }"
    data-testid="ability-catalog-releases-page"
  >
    <header v-if="!props.embedded" class="releases-page__header">
      <h1>Catalog history</h1>
      <p class="lede">
        Release history and emergency rollback. Normal publication happens from the Catalog tab via
        Publish changes.
      </p>
    </header>

    <StatusBanner v-if="error" tone="error" :message="error" />
    <StatusBanner v-if="success" tone="success" :message="success" />
    <StatusBanner v-if="notice" tone="info" :message="notice" />

    <section v-if="!loading" class="panel" data-testid="active-release-panel">
      <h2>Active release</h2>
      <p v-if="active">
        ACTIVE: <code>{{ active.releaseKey }}</code>
        <span class="muted"> ({{ active.id }})</span>
      </p>
      <p v-else class="muted">No ACTIVE release.</p>
      <p class="muted">
        Limitations retained: racial={{ limitations.racialReplayCoverage ?? "INCOMPLETE" }}; trust={{
          limitations.trustReplay ?? "TRUST_REPLAY_UNAVAILABLE"
        }}
      </p>
    </section>

    <section class="panel">
      <h2>Rollback</h2>
      <label>
        Rollback reason
        <input v-model="rollbackReason" class="admin-control" data-testid="rollback-reason" />
      </label>
    </section>

    <section class="panel">
      <h2>Releases</h2>
      <p v-if="loading" class="muted">Loading…</p>
      <ul v-else class="list">
        <li v-for="row in releases" :key="row.id" class="row">
          <div>
            <div>
              <strong>{{ row.releaseKey }}</strong>
              <span class="badge" :data-status="row.status">{{ row.status }}</span>
            </div>
            <div class="muted mono">{{ row.contentDigest }}</div>
          </div>
          <div class="actions">
            <button
              type="button"
              class="btn"
              data-testid="rollback-release"
              :disabled="busyId === row.id || row.status === 'ACTIVE'"
              @click="rollback(row)"
            >
              Rollback / re-activate
            </button>
          </div>
        </li>
      </ul>
    </section>
  </section>
</template>

<style scoped>
.releases-page {
  max-width: 56rem;
  margin: 0 auto;
  padding: 1.5rem 1rem 3rem;
  color: var(--color-text);
}
.releases-page--embedded {
  max-width: none;
  margin: 0;
  padding: 0;
}
.lede {
  color: var(--color-text-muted);
  max-width: 40rem;
}
.panel {
  margin-top: 1.5rem;
  padding-top: 1rem;
  border-top: 1px solid var(--color-border);
}
.releases-page--embedded .panel:first-of-type {
  margin-top: 0;
  padding-top: 0;
  border-top: none;
}
.panel h2 {
  margin: 0 0 0.65rem;
  font-size: var(--text-lg);
}
.panel label {
  display: grid;
  gap: 0.35rem;
  margin-bottom: 0.75rem;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}
.list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 0;
  border-bottom: 1px solid var(--color-border);
}
.actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.actions .btn {
  min-height: 2.5rem;
}
.mono {
  font-family: var(--font-data);
  word-break: break-all;
}
.badge {
  margin-left: 0.5rem;
  font-size: 0.75rem;
  padding: 0.1rem 0.4rem;
  border-radius: var(--radius-control);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text-muted);
}
.badge[data-status="ACTIVE"] {
  border-color: color-mix(in srgb, var(--color-gold-300) 50%, var(--color-border));
  background: color-mix(in srgb, var(--color-gold-300) 18%, var(--color-surface));
  color: var(--color-gold-300);
}
.muted {
  color: var(--color-text-muted);
  font-size: 0.9rem;
}
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: color-mix(in srgb, var(--color-bg) 40%, transparent);
  backdrop-filter: blur(2px);
}
.modal {
  width: min(32rem, 100%);
  padding: 1.25rem 1.35rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-surface);
  box-shadow: 0 12px 40px color-mix(in srgb, #000 35%, transparent);
}
.modal h2 {
  margin: 0 0 0.75rem;
  font-size: 1.15rem;
}
.modal__actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1.25rem;
}
</style>
