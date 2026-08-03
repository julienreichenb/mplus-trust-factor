<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ApiClientError } from "../../api/live-client";
import StatusBanner from "../common/StatusBanner.vue";

interface CanaryRow {
  id: string;
  characterId: string;
  regionCode: string;
  realmSlug: string;
  characterName: string;
  status: string;
  lifecycle: string;
  classSlug: string | null;
  specSlug: string | null;
  role: string | null;
  catalogVersion: string | null;
  analysisBatchId?: string | null;
  bullmqJobId?: string | null;
  progress?: Record<string, unknown> | null;
  diagnostics?: Record<string, unknown> | null;
  batchDiagnostics?: {
    finalizationStatus?: string;
    expectedSlotCount?: number;
    slots?: Array<{
      slotId: string;
      dungeonSlug: string;
      slotIndex: number;
      status: string;
      keyLevel: number | null;
      timed: boolean | null;
      rejectionReason: string | null;
      reportCode: string | null;
      fightId: number | null;
    }>;
    dimensions?: Array<{
      dimension: string;
      state: string;
      score: number | null;
      confidence: number;
      blocker: string | null;
    }>;
  } | null;
  createdAt: string;
  completedAt: string | null;
  errorCode: string | null;
  reused?: boolean;
}

const router = useRouter();
const apiBase = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

const region = ref("EU");
const realmSlug = ref("archimonde");
const characterName = ref("Wallidrixe");
const launching = ref(false);
const error = ref<string | null>(null);
const latest = ref<CanaryRow | null>(null);
const history = ref<CanaryRow[]>([]);

async function adminFetch<T>(path: string, init?: globalThis.RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  const body = (await response.json().catch(() => ({}))) as T & {
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
  return body;
}

async function refreshList(): Promise<void> {
  const res = await adminFetch<{ items: CanaryRow[] }>(
    "/api/v1/admin/scoring-v2/shadow-canaries",
  );
  history.value = res.items;
}

async function launch(): Promise<void> {
  launching.value = true;
  error.value = null;
  try {
    latest.value = await adminFetch<CanaryRow>("/api/v1/admin/scoring-v2/shadow-canaries", {
      method: "POST",
      body: JSON.stringify({
        region: region.value,
        realmSlug: realmSlug.value.trim(),
        characterName: characterName.value.trim(),
      }),
    });
    await refreshList();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    launching.value = false;
  }
}

async function pollSelected(id: string): Promise<void> {
  latest.value = await adminFetch<CanaryRow>(`/api/v1/admin/scoring-v2/shadow-canaries/${id}`);
}

onMounted(() => {
  void refreshList().catch((err) => {
    error.value = err instanceof Error ? err.message : String(err);
  });
});
</script>

<template>
  <section class="canary" aria-labelledby="shadow-canary-title">
    <h2 id="shadow-canary-title">Shadow Canary</h2>
    <p>
      Launch a persisted SHADOW Scoring V2 run for one public character. Uses production acquisition
      and calculators. Publication and V2 flags stay disabled.
    </p>

    <StatusBanner v-if="error" tone="error" :message="error" />

    <form class="canary__form" @submit.prevent="launch">
      <label>
        Region
        <select v-model="region">
          <option>EU</option>
          <option>US</option>
          <option>KR</option>
          <option>TW</option>
        </select>
      </label>
      <label>
        Realm slug
        <input v-model="realmSlug" required autocomplete="off" />
      </label>
      <label>
        Character
        <input v-model="characterName" required autocomplete="off" />
      </label>
      <button type="submit" :disabled="launching">
        {{ launching ? "Launching…" : "Launch Shadow Canary" }}
      </button>
    </form>

    <div v-if="latest" class="canary__latest">
      <h3>Latest</h3>
      <dl>
        <dt>Status</dt>
        <dd>{{ latest.status }} / {{ latest.lifecycle }}</dd>
        <dt>Identity</dt>
        <dd>
          {{ latest.regionCode }}/{{ latest.realmSlug }}/{{ latest.characterName }} —
          {{ latest.classSlug }}/{{ latest.specSlug }} ({{ latest.role }})
        </dd>
        <dt>Catalog</dt>
        <dd>{{ latest.catalogVersion ?? "—" }}</dd>
        <dt>Job</dt>
        <dd>{{ latest.bullmqJobId ?? "—" }}</dd>
        <dt>Batch</dt>
        <dd>{{ latest.analysisBatchId ?? "pending" }}</dd>
        <dt>Progress</dt>
        <dd>
          <pre class="canary__json">{{ JSON.stringify(latest.progress ?? {}, null, 2) }}</pre>
        </dd>
        <dt>Discovery</dt>
        <dd>
          <pre class="canary__json">{{ JSON.stringify(latest.diagnostics ?? {}, null, 2) }}</pre>
        </dd>
      </dl>

      <div v-if="latest.batchDiagnostics?.slots?.length" class="canary__matrix">
        <h4>Slot matrix</h4>
        <table>
          <thead>
            <tr>
              <th>Dungeon</th>
              <th>Slot</th>
              <th>Status</th>
              <th>Key</th>
              <th>Timed</th>
              <th>Run</th>
              <th>Rejection</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in latest.batchDiagnostics.slots" :key="s.slotId">
              <td>{{ s.dungeonSlug }}</td>
              <td>{{ s.slotIndex }}</td>
              <td>{{ s.status }}</td>
              <td>{{ s.keyLevel ?? "—" }}</td>
              <td>{{ s.timed == null ? "—" : String(s.timed) }}</td>
              <td>
                <span v-if="s.reportCode">{{ s.reportCode }}#{{ s.fightId }}</span>
                <span v-else>—</span>
              </td>
              <td>{{ s.rejectionReason ?? "—" }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="latest.batchDiagnostics?.dimensions?.length">
        <h4>Dimensions</h4>
        <table>
          <thead>
            <tr>
              <th>Dimension</th>
              <th>State</th>
              <th>Score</th>
              <th>Confidence</th>
              <th>Blocker</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in latest.batchDiagnostics.dimensions" :key="d.dimension">
              <td>{{ d.dimension }}</td>
              <td>{{ d.state }}</td>
              <td>{{ d.score ?? "—" }}</td>
              <td>{{ d.confidence }}</td>
              <td>{{ d.blocker ?? "—" }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <button type="button" @click="pollSelected(latest.id)">Refresh status</button>
      <a
        class="canary__export"
        :href="`data:application/json,${encodeURIComponent(JSON.stringify(latest, null, 2))}`"
        :download="`shadow-canary-${latest.id}.json`"
      >
        Download diagnostics
      </a>
    </div>

    <div class="canary__history">
      <h3>Recent canaries</h3>
      <table v-if="history.length">
        <thead>
          <tr>
            <th>Character</th>
            <th>Spec</th>
            <th>Status</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in history" :key="row.id">
            <td>{{ row.regionCode }}/{{ row.realmSlug }}/{{ row.characterName }}</td>
            <td>{{ row.classSlug }}/{{ row.specSlug }}</td>
            <td>{{ row.status }}</td>
            <td>{{ row.createdAt }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else>No canaries yet.</p>
    </div>
  </section>
</template>

<style scoped>
.canary {
  display: grid;
  gap: 1rem;
}
.canary__form {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: end;
}
.canary__form label {
  display: grid;
  gap: 0.25rem;
  font-size: 0.9rem;
}
.canary__latest dl {
  display: grid;
  grid-template-columns: 8rem 1fr;
  gap: 0.35rem 0.75rem;
}
.canary__json {
  margin: 0;
  max-height: 12rem;
  overflow: auto;
  font-size: 0.8rem;
  white-space: pre-wrap;
}
.canary__export {
  display: inline-block;
  margin-left: 0.75rem;
}
table {
  width: 100%;
  border-collapse: collapse;
}
th,
td {
  text-align: left;
  padding: 0.35rem 0.5rem;
  border-bottom: 1px solid #ddd;
}
</style>
