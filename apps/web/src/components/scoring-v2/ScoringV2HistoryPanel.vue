<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import type { ScoringV2HistoryListDTO } from "@mplus/contracts";
import { ApiClientError } from "../../api/live-client";
import StatusBanner from "../common/StatusBanner.vue";

const router = useRouter();
const apiBase = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

const busy = ref(false);
const downloadingId = ref<string | null>(null);
const error = ref<string | null>(null);
const page = ref(1);
const pageSize = 20;
const history = ref<ScoringV2HistoryListDTO | null>(null);
let objectUrlToRevoke: string | null = null;

async function load(): Promise<void> {
  busy.value = true;
  error.value = null;
  try {
    const response = await fetch(
      `${apiBase}/api/v1/admin/scoring-v2/history?page=${page.value}&pageSize=${pageSize}`,
      { credentials: "include", headers: { Accept: "application/json" } },
    );
    const body = (await response.json().catch(() => ({}))) as ScoringV2HistoryListDTO & {
      error?: { message?: string };
    };
    if (response.status === 401 || response.status === 403) {
      void router.replace(response.status === 401 ? "/auth/signin" : "/access-denied");
      throw new ApiClientError(body.error?.message ?? "Unauthorized", response.status, "UNAUTHORIZED");
    }
    if (!response.ok) {
      throw new ApiClientError(
        body.error?.message ?? `Request failed (${response.status})`,
        response.status,
        "REQUEST_FAILED",
      );
    }
    history.value = body;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to load history";
  } finally {
    busy.value = false;
  }
}

async function download(exportId: string): Promise<void> {
  if (downloadingId.value) return;
  downloadingId.value = exportId;
  error.value = null;
  try {
    const response = await fetch(
      `${apiBase}/api/v1/admin/scoring-v2/evidence-exports/${encodeURIComponent(exportId)}/download`,
      { credentials: "include" },
    );
    if (response.status === 401 || response.status === 403) {
      void router.replace(response.status === 401 ? "/auth/signin" : "/access-denied");
      throw new ApiClientError("Unauthorized", response.status, "UNAUTHORIZED");
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new ApiClientError(
        body.error?.message ?? `Download failed (${response.status})`,
        response.status,
        "REQUEST_FAILED",
      );
    }
    const blob = await response.blob();
    if (objectUrlToRevoke) {
      URL.revokeObjectURL(objectUrlToRevoke);
      objectUrlToRevoke = null;
    }
    const objectUrl = URL.createObjectURL(blob);
    objectUrlToRevoke = objectUrl;
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `evidence-export-${exportId}.zip`;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => {
      if (objectUrlToRevoke === objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrlToRevoke = null;
      }
    }, 1_000);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Download failed";
  } finally {
    downloadingId.value = null;
  }
}

function nextPage(): void {
  if (!history.value) return;
  const maxPage = Math.max(1, Math.ceil(history.value.total / history.value.pageSize));
  if (page.value < maxPage) {
    page.value += 1;
    void load();
  }
}

function prevPage(): void {
  if (page.value > 1) {
    page.value -= 1;
    void load();
  }
}

onMounted(() => {
  void load();
});

onUnmounted(() => {
  if (objectUrlToRevoke) {
    URL.revokeObjectURL(objectUrlToRevoke);
    objectUrlToRevoke = null;
  }
});
</script>

<template>
  <div class="history">
    <StatusBanner v-if="error" tone="error" :message="error" />
    <p v-if="busy && !history" class="muted">Loading history…</p>

    <section class="panel" aria-labelledby="history-title">
      <h2 id="history-title">Export and bundle history</h2>
      <p class="muted">Artifact bodies are not loaded in list responses.</p>
      <table v-if="history?.items.length">
        <thead>
          <tr>
            <th>Kind</th>
            <th>Status</th>
            <th>Cohort</th>
            <th>Rev</th>
            <th>Root hash</th>
            <th>Blockers</th>
            <th>Warnings</th>
            <th>Created</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in history.items" :key="`${item.kind}-${item.id}`">
            <td>{{ item.kind }}</td>
            <td><span class="chip">{{ item.status }}</span></td>
            <td>{{ item.cohortName ?? item.cohortId.slice(0, 8) }}</td>
            <td>{{ item.cohortRevision }}</td>
            <td class="mono">{{ item.rootHash ? `${item.rootHash.slice(0, 12)}…` : "—" }}</td>
            <td>{{ item.blockerCount }}</td>
            <td>{{ item.warningCount }}</td>
            <td>{{ item.createdAt }}</td>
            <td>
              <button
                v-if="item.downloadAvailable"
                type="button"
                :disabled="downloadingId !== null"
                @click="download(item.exportId)"
              >
                Download
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else-if="history" class="muted">No history items.</p>

      <div v-if="history" class="pager">
        <button type="button" :disabled="page <= 1 || busy" @click="prevPage">Previous</button>
        <span>Page {{ history.page }} · {{ history.total }} total</span>
        <button
          type="button"
          :disabled="busy || page * history.pageSize >= history.total"
          @click="nextPage"
        >
          Next
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.history {
  display: grid;
  gap: 1rem;
}

.panel {
  display: grid;
  gap: 0.5rem;
  padding: 0.75rem 0;
  border-top: 1px solid color-mix(in srgb, currentColor 18%, transparent);
}

.panel h2 {
  margin: 0;
  font-size: 1.05rem;
}

.muted {
  opacity: 0.75;
}

.chip {
  display: inline-block;
  padding: 0.1rem 0.45rem;
  border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
  font-size: 0.8rem;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.85em;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}

th,
td {
  text-align: left;
  padding: 0.35rem 0.4rem;
  border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
  vertical-align: top;
}

.pager {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
}

@media (max-width: 800px) {
  table {
    display: block;
    overflow-x: auto;
  }
}
</style>
