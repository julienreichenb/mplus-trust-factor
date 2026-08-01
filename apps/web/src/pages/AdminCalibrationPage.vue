<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type {
  CalibrationCohortDTO,
  CalibrationCohortMemberDTO,
  CalibrationExpectedLabel,
  CalibrationPreflightResultDTO,
  CalibrationRunDTO,
} from "@mplus/contracts";
import StatusBanner from "../components/common/StatusBanner.vue";

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";
const route = useRoute();
const router = useRouter();

const error = ref<string | null>(null);
const message = ref<string | null>(null);
const busy = ref(false);
const cohorts = ref<CalibrationCohortDTO[]>([]);
const cohort = ref<CalibrationCohortDTO | null>(null);
const preflight = ref<CalibrationPreflightResultDTO | null>(null);
const runs = ref<CalibrationRunDTO[]>([]);
const pollTimer = ref<ReturnType<typeof setInterval> | null>(null);

const newName = ref("");
const newSeasonId = ref("");
const bulkJson = ref("");
const memberForm = ref({
  region: "EU",
  realmSlug: "",
  characterName: "",
  expectedLabel: "GOOD" as CalibrationExpectedLabel,
  providedRole: "" as "" | "DPS" | "TANK" | "HEALER",
  rationale: "Admin-selected calibration member",
});

const selectedCohortId = computed(() => {
  const id = route.params.cohortId;
  return typeof id === "string" && id.length > 0 ? id : null;
});

async function apiJson<T>(
  path: string,
  init?: {
    method?: string;
    body?: string;
    headers?: Record<string, string>;
  },
): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    credentials: "include",
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = body?.error;
    throw new Error(err?.message ?? `HTTP ${response.status}`);
  }
  return body as T;
}

async function refreshList() {
  const data = await apiJson<{ cohorts: CalibrationCohortDTO[] }>("/api/v1/admin/calibration/cohorts");
  cohorts.value = data.cohorts;
}

async function loadCohort(id: string) {
  cohort.value = await apiJson<CalibrationCohortDTO>(`/api/v1/admin/calibration/cohorts/${id}`);
  const runData = await apiJson<{ runs: CalibrationRunDTO[] }>(
    `/api/v1/admin/calibration/runs?cohortId=${encodeURIComponent(id)}`,
  );
  runs.value = runData.runs;
}

async function bootstrap() {
  busy.value = true;
  error.value = null;
  try {
    await refreshList();
    if (selectedCohortId.value) await loadCohort(selectedCohortId.value);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

async function createCohort() {
  busy.value = true;
  error.value = null;
  try {
    const created = await apiJson<CalibrationCohortDTO>("/api/v1/admin/calibration/cohorts", {
      method: "POST",
      body: JSON.stringify({
        name: newName.value,
        seasonId: newSeasonId.value,
        description: "",
      }),
    });
    message.value = `Created cohort ${created.name}`;
    newName.value = "";
    await router.push({ name: "admin-calibration", params: { cohortId: created.id } });
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

async function addMember() {
  if (!cohort.value) return;
  busy.value = true;
  error.value = null;
  try {
    await apiJson(`/api/v1/admin/calibration/cohorts/${cohort.value.id}/members`, {
      method: "POST",
      body: JSON.stringify({
        ...memberForm.value,
        providedRole: memberForm.value.providedRole || null,
      }),
    });
    message.value = "Member added (revision incremented)";
    await loadCohort(cohort.value.id);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

async function bulkImport() {
  if (!cohort.value) return;
  busy.value = true;
  error.value = null;
  try {
    const members = JSON.parse(bulkJson.value) as unknown[];
    const result = await apiJson<{ failed: unknown[] }>(
      `/api/v1/admin/calibration/cohorts/${cohort.value.id}/members/bulk`,
      {
        method: "POST",
        body: JSON.stringify({ members, replaceAll: false }),
      },
    );
    message.value = `Bulk import done (${result.failed.length} row failures)`;
    await loadCohort(cohort.value.id);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

async function runPreflight() {
  if (!cohort.value) return;
  busy.value = true;
  error.value = null;
  try {
    preflight.value = await apiJson<CalibrationPreflightResultDTO>(
      `/api/v1/admin/calibration/cohorts/${cohort.value.id}/preflight`,
      { method: "POST", body: JSON.stringify({ mode: "PERSISTED_SNAPSHOT_ONLY" }) },
    );
    message.value = `Preflight: ${preflight.value.blockingCount} blocking, ${preflight.value.warningCount} warnings`;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

async function startRun() {
  if (!cohort.value) return;
  busy.value = true;
  error.value = null;
  try {
    const run = await apiJson<CalibrationRunDTO>(
      `/api/v1/admin/calibration/cohorts/${cohort.value.id}/runs`,
      {
        method: "POST",
        body: JSON.stringify({
          mode: "PERSISTED_SNAPSHOT_ONLY",
          expectedCohortRevision: cohort.value.revision,
        }),
      },
    );
    message.value = `Run ${run.id} queued (frozen revision ${run.cohortRevision})`;
    await loadCohort(cohort.value.id);
    startPolling();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

async function cancelRun(runId: string) {
  await apiJson(`/api/v1/admin/calibration/runs/${runId}/cancel`, { method: "POST", body: "{}" });
  if (cohort.value) await loadCohort(cohort.value.id);
}

function startPolling() {
  stopPolling();
  pollTimer.value = setInterval(async () => {
    if (!cohort.value) return;
    await loadCohort(cohort.value.id);
    const active = runs.value.some((r) => r.status === "QUEUED" || r.status === "RUNNING");
    if (!active) stopPolling();
  }, 2500);
}

function stopPolling() {
  if (pollTimer.value) {
    clearInterval(pollTimer.value);
    pollTimer.value = null;
  }
}

function memberLabel(m: CalibrationCohortMemberDTO): string {
  const excl = m.included ? "" : ` [excluded: ${m.exclusionCode ?? "n/a"}]`;
  return `${m.region}/${m.realmSlug}/${m.characterName} — expert ${m.expectedLabel}${excl}`;
}

watch(selectedCohortId, async (id) => {
  preflight.value = null;
  if (id) await loadCohort(id);
  else cohort.value = null;
});

onMounted(bootstrap);
onUnmounted(stopPolling);
</script>

<template>
  <main class="admin-page">
    <header class="admin-page__header">
      <h1>Calibration</h1>
      <p>
        Expert labels are authoritative. Observed grades/scores come only from frozen snapshots.
        Preflight never calls providers or enqueues refreshes.
      </p>
    </header>

    <StatusBanner v-if="error" tone="error" :message="error" />
    <StatusBanner v-if="message" tone="success" :message="message" />

    <section class="panel">
      <h2>Cohorts</h2>
      <ul class="list">
        <li v-for="c in cohorts" :key="c.id">
          <RouterLink :to="{ name: 'admin-calibration', params: { cohortId: c.id } }">
            {{ c.name }}
          </RouterLink>
          — {{ c.status }} · rev {{ c.revision }} · {{ c.includedMemberCount }}/{{ c.memberCount }} included
        </li>
      </ul>
      <div class="form-row">
        <input v-model="newName" placeholder="Cohort name" />
        <input v-model="newSeasonId" placeholder="Season UUID" />
        <button type="button" :disabled="busy || !newName || !newSeasonId" @click="createCohort">
          Create cohort
        </button>
      </div>
    </section>

    <template v-if="cohort">
      <section class="panel">
        <h2>{{ cohort.name }}</h2>
        <p>
          Status {{ cohort.status }} · revision {{ cohort.revision }} · season
          <code>{{ cohort.seasonId }}</code>
        </p>
        <h3>Members</h3>
        <ul class="list">
          <li v-for="m in cohort.members ?? []" :key="m.id">
            {{ memberLabel(m) }}
            <span v-if="m.characterId" class="muted"> · character {{ m.characterId }}</span>
          </li>
        </ul>
        <div class="form-row">
          <input v-model="memberForm.region" placeholder="Region" />
          <input v-model="memberForm.realmSlug" placeholder="Realm slug" />
          <input v-model="memberForm.characterName" placeholder="Character" />
          <select v-model="memberForm.expectedLabel">
            <option value="EXCELLENT">EXCELLENT (expert)</option>
            <option value="GOOD">GOOD (expert)</option>
            <option value="AVERAGE">AVERAGE (expert)</option>
            <option value="WEAK">WEAK (expert)</option>
            <option value="OVERRATED">OVERRATED (expert)</option>
          </select>
          <select v-model="memberForm.providedRole">
            <option value="">Role (optional)</option>
            <option value="DPS">DPS</option>
            <option value="TANK">TANK</option>
            <option value="HEALER">HEALER</option>
          </select>
          <button type="button" :disabled="busy" @click="addMember">Add member</button>
        </div>
        <h3>Bulk import JSON</h3>
        <textarea v-model="bulkJson" rows="6" placeholder='[{"region":"EU","realmSlug":"...","characterName":"...","expectedLabel":"GOOD","rationale":"..."}]' />
        <button type="button" :disabled="busy || !bulkJson" @click="bulkImport">Import members</button>
      </section>

      <section class="panel">
        <h2>Preflight (DB-only)</h2>
        <button type="button" :disabled="busy" @click="runPreflight">Run preflight</button>
        <table v-if="preflight" class="table">
          <thead>
            <tr>
              <th>Member</th>
              <th>Expert label</th>
              <th>Bootstrap</th>
              <th>Snapshot</th>
              <th>Replayable</th>
              <th>Missing evidence</th>
              <th>Included</th>
              <th>Issues</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in preflight.members" :key="m.memberId">
              <td>{{ m.region }}/{{ m.realmSlug }}/{{ m.characterName }}</td>
              <td>{{ m.expectedLabel }}</td>
              <td>{{ m.bootstrapComplete ? "complete" : "incomplete" }}</td>
              <td>{{ m.selectedSnapshotId ?? "—" }}</td>
              <td>{{ m.replayable ? "yes" : "snapshot-only / no" }}</td>
              <td>{{ m.missingEvidence ? "yes" : "no" }}</td>
              <td>{{ m.included ? "yes" : m.exclusionCode }}</td>
              <td>{{ m.issues.map((i) => i.code).join(", ") || "—" }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="panel">
        <h2>Runs</h2>
        <button type="button" :disabled="busy" @click="startRun">
          Start PERSISTED_SNAPSHOT_ONLY run
        </button>
        <ul class="list">
          <li v-for="r in runs" :key="r.id">
            <RouterLink :to="{ name: 'admin-calibration-report', params: { runId: r.id } }">
              {{ r.id.slice(0, 8) }}
            </RouterLink>
            — {{ r.status }} · frozen rev {{ r.cohortRevision }}
            <button
              v-if="r.status === 'QUEUED' || r.status === 'RUNNING'"
              type="button"
              @click="cancelRun(r.id)"
            >
              Cancel
            </button>
          </li>
        </ul>
      </section>
    </template>
  </main>
</template>

<style scoped>
.admin-page {
  max-width: 1100px;
  margin: 0 auto;
  padding: 1.5rem;
  display: grid;
  gap: 1.25rem;
}
.admin-page__header h1 {
  margin: 0 0 0.35rem;
}
.panel {
  border-top: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
  padding-top: 1rem;
  display: grid;
  gap: 0.75rem;
}
.list {
  margin: 0;
  padding-left: 1.2rem;
}
.form-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}
.table th,
.table td {
  border-bottom: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
  text-align: left;
  padding: 0.35rem 0.4rem;
  vertical-align: top;
}
.muted {
  opacity: 0.7;
}
textarea,
input,
select,
button {
  font: inherit;
}
textarea {
  width: 100%;
}
</style>
