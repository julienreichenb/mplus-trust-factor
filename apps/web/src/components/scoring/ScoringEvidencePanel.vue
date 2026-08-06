<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import type {
  ScoringEvidenceExportDTO,
  ScoringEvidenceExportListDTO,
} from "@mplus/contracts";
import { ApiClientError } from "../../api/live-client";
import StatusBanner from "../common/StatusBanner.vue";

const router = useRouter();
const apiBase = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

const cohortId = ref("");
const cohortRevision = ref("");
const seasonId = ref("");
const busy = ref(false);
const error = ref<string | null>(null);
const success = ref<string | null>(null);
const current = ref<ScoringEvidenceExportDTO | null>(null);
const list = ref<ScoringEvidenceExportListDTO | null>(null);
const freezeConfirmOpen = ref(false);
const downloading = ref(false);
let pollTimer: ReturnType<typeof setInterval> | null = null;
let objectUrlToRevoke: string | null = null;

const freezeBlocked = computed(() => {
  if (!current.value) return true;
  if (current.value.status !== "COMPLETED") return true;
  return !current.value.freezeEligible || current.value.blockerCount > 0;
});

async function apiJson<T>(path: string, init?: Parameters<typeof fetch>[1]): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    credentials: "include",
    headers: { Accept: "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };
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
  return body;
}

async function refreshList(): Promise<void> {
  list.value = await apiJson<ScoringEvidenceExportListDTO>(
    "/api/v1/admin/scoring/evidence-exports?page=1&pageSize=10",
  );
}

async function loadExport(id: string): Promise<void> {
  current.value = await apiJson<ScoringEvidenceExportDTO>(
    `/api/v1/admin/scoring/evidence-exports/${encodeURIComponent(id)}`,
  );
  if (
    current.value.status === "QUEUED" ||
    current.value.status === "RUNNING" ||
    current.value.status === "RETRYABLE"
  ) {
    startPolling(id);
  } else {
    stopPolling();
  }
}

function startPolling(id: string): void {
  stopPolling();
  pollTimer = setInterval(() => {
    void loadExport(id).catch(() => undefined);
  }, 2500);
}

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function generatePreflight(): Promise<void> {
  busy.value = true;
  error.value = null;
  success.value = null;
  try {
    const body: Record<string, unknown> = { cohortId: cohortId.value.trim() };
    if (cohortRevision.value.trim()) body.cohortRevision = Number(cohortRevision.value.trim());
    if (seasonId.value.trim()) body.seasonId = seasonId.value.trim();
    const created = await apiJson<ScoringEvidenceExportDTO>(
      "/api/v1/admin/scoring/evidence-exports",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    current.value = created;
    success.value = "Evidence preflight queued.";
    startPolling(created.id);
    await refreshList();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to start evidence export";
  } finally {
    busy.value = false;
  }
}

async function downloadArchive(): Promise<void> {
  if (!current.value?.archiveContentHash || downloading.value) return;
  downloading.value = true;
  error.value = null;
  try {
    const response = await fetch(
      `${apiBase}/api/v1/admin/scoring/evidence-exports/${encodeURIComponent(current.value.id)}/download`,
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
    anchor.download = `evidence-export-${current.value.id}.zip`;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Revoke after the browser has a chance to start the download.
    window.setTimeout(() => {
      if (objectUrlToRevoke === objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrlToRevoke = null;
      }
    }, 1_000);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Download failed";
  } finally {
    downloading.value = false;
  }
}

async function freezeBundle(): Promise<void> {
  if (!current.value || freezeBlocked.value) return;
  busy.value = true;
  error.value = null;
  success.value = null;
  try {
    const result = await apiJson<{ export: ScoringEvidenceExportDTO }>(
      `/api/v1/admin/scoring/evidence-exports/${encodeURIComponent(current.value.id)}/freeze-bundle`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      },
    );
    current.value = result.export ?? (result as unknown as ScoringEvidenceExportDTO);
    success.value = "Calibration Input Bundle V2 frozen.";
    freezeConfirmOpen.value = false;
    await refreshList();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Freeze failed";
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  void refreshList().catch((err) => {
    error.value = err instanceof Error ? err.message : "Failed to load exports";
  });
});

onUnmounted(() => {
  stopPolling();
  if (objectUrlToRevoke) {
    URL.revokeObjectURL(objectUrlToRevoke);
    objectUrlToRevoke = null;
  }
});
</script>

<template>
  <div class="evidence">
    <StatusBanner v-if="error" tone="error" :message="error" />
    <StatusBanner v-if="success" tone="success" :message="success" />

    <section class="panel" aria-labelledby="preflight-title">
      <h2 id="preflight-title">Generate evidence preflight</h2>
      <p class="muted">
        Provider-free read of the selected cohort revision. Does not enqueue refreshes or freeze a
        bundle.
      </p>
      <form class="form" @submit.prevent="generatePreflight">
        <label>
          Cohort ID
          <input v-model="cohortId" required type="text" name="cohortId" autocomplete="off" />
        </label>
        <label>
          Cohort revision (optional)
          <input
            v-model="cohortRevision"
            type="number"
            min="1"
            name="cohortRevision"
            autocomplete="off"
          />
        </label>
        <label>
          Season ID (optional)
          <input v-model="seasonId" type="text" name="seasonId" autocomplete="off" />
        </label>
        <button type="submit" :disabled="busy || !cohortId.trim()">Generate evidence preflight</button>
      </form>
    </section>

    <section v-if="current" class="panel" aria-labelledby="status-title">
      <h2 id="status-title">Export status</h2>
      <p>
        <span class="chip">{{ current.status }}</span>
        · blockers {{ current.blockerCount }} · warnings {{ current.warningCount }}
      </p>
      <dl class="kv">
        <dt>Members</dt>
        <dd>
          scanned {{ current.progress.membersScanned }}/{{ current.progress.membersTotal }} · found
          {{ current.progress.identitiesFound }} · missing {{ current.progress.identitiesMissing }}
        </dd>
        <dt>Bootstrap</dt>
        <dd>
          complete {{ current.progress.bootstrapComplete }} · incomplete
          {{ current.progress.bootstrapIncomplete }}
        </dd>
        <dt>Manifests</dt>
        <dd>
          {{ current.progress.manifestsPresent }} · four dimensions
          {{ current.progress.fourDimensionComplete }}
        </dd>
        <dt>Snapshots</dt>
        <dd>
          compatible {{ current.progress.compatibleSnapshots }} · incompatible
          {{ current.progress.incompatibleSnapshots }}
        </dd>
        <dt>Archive hash</dt>
        <dd class="mono">{{ current.archiveContentHash ?? "—" }}</dd>
        <dt>Frozen bundle (logical)</dt>
        <dd class="mono">{{ current.frozenBundleContentHash ?? "—" }}</dd>
        <dt>Frozen bundle (CAS)</dt>
        <dd class="mono">{{ current.frozenBundleByteDigest ?? "—" }}</dd>
      </dl>

      <ul v-if="current.freezeBlockers.length" class="issues" aria-label="Freeze eligibility blockers">
        <li
          v-for="issue in current.freezeBlockers"
          :key="'freeze-' + issue.code + (issue.memberId ?? '') + issue.message"
        >
          <span class="chip" data-sev="blocker">blocker</span>
          <code>{{ issue.code }}</code> {{ issue.message }}
          <span v-if="issue.memberId" class="muted"> · member {{ issue.memberId }}</span>
        </li>
      </ul>

      <ul v-if="current.issues.length" class="issues">
        <li v-for="issue in current.issues" :key="issue.code + (issue.memberId ?? '') + issue.message">
          <span class="chip" :data-sev="issue.severity">{{ issue.severity }}</span>
          <code>{{ issue.code }}</code> {{ issue.message }}
        </li>
      </ul>

      <div class="actions">
        <button
          type="button"
          :disabled="!current.archiveContentHash || downloading"
          @click="downloadArchive"
        >
          Download archive
        </button>
        <button
          type="button"
          :disabled="busy || freezeBlocked"
          @click="freezeConfirmOpen = true"
        >
          Freeze calibration bundle
        </button>
      </div>
      <p v-if="freezeBlocked && current.status === 'COMPLETED'" class="muted">
        Freeze is blocked until every Calibration Input Bundle V2 artifact resolves. See freeze
        eligibility blockers above.
      </p>
      <p v-else-if="freezeBlocked" class="muted">
        Freeze is blocked until the export completes with no evidence blockers.
      </p>
    </section>

    <dialog v-if="freezeConfirmOpen" class="dialog" open>
      <form method="dialog" class="dialog__body" @submit.prevent="freezeBundle">
        <h3>Confirm bundle freeze</h3>
        <p>
          This writes an immutable Calibration Input Bundle V2. It does not activate models, start a
          calibration run, or publish scores.
        </p>
        <div class="actions">
          <button type="button" @click="freezeConfirmOpen = false">Cancel</button>
          <button type="submit" :disabled="busy">Confirm freeze</button>
        </div>
      </form>
    </dialog>

    <section class="panel" aria-labelledby="recent-title">
      <h2 id="recent-title">Recent exports</h2>
      <table v-if="list?.items.length">
        <thead>
          <tr>
            <th>Created</th>
            <th>Status</th>
            <th>Cohort</th>
            <th>Rev</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in list.items" :key="item.id">
            <td>{{ item.createdAt }}</td>
            <td><span class="chip">{{ item.status }}</span></td>
            <td class="mono">{{ item.cohortName ?? item.cohortId.slice(0, 8) }}</td>
            <td>{{ item.cohortRevision }}</td>
            <td>
              <button type="button" @click="loadExport(item.id)">Open</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="muted">No exports yet.</p>
    </section>
  </div>
</template>

<style scoped>
.evidence {
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

.form {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  align-items: end;
}

.form label {
  display: grid;
  gap: 0.25rem;
  font-size: 0.9rem;
}

.form input {
  padding: 0.4rem 0.5rem;
}

.kv {
  display: grid;
  grid-template-columns: minmax(7rem, 10rem) 1fr;
  gap: 0.35rem 0.75rem;
  margin: 0;
}

.kv dt {
  opacity: 0.8;
}

.kv dd {
  margin: 0;
}

.chip {
  display: inline-block;
  padding: 0.1rem 0.45rem;
  border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
  font-size: 0.8rem;
}

.chip[data-sev="blocker"] {
  border-color: color-mix(in srgb, #a33 50%, currentColor);
}

.chip[data-sev="warning"] {
  border-color: color-mix(in srgb, #9a6b16 50%, currentColor);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.issues {
  margin: 0;
  padding-left: 1.1rem;
}

.muted {
  opacity: 0.75;
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
}

.dialog {
  border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
  padding: 0;
  max-width: 28rem;
}

.dialog__body {
  display: grid;
  gap: 0.75rem;
  padding: 1rem;
}

.dialog__body h3 {
  margin: 0;
}
</style>
