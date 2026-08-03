<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import type { ScoringV2ConcurrencyDTO } from "@mplus/contracts";
import { ApiClientError } from "../../api/live-client";
import StatusBanner from "../common/StatusBanner.vue";

const router = useRouter();
const apiBase = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

const busy = ref(false);
const error = ref<string | null>(null);
const success = ref<string | null>(null);
const data = ref<ScoringV2ConcurrencyDTO | null>(null);
const calibration = ref(4);
const operation = ref(2);

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
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

async function load(): Promise<void> {
  busy.value = true;
  error.value = null;
  try {
    data.value = await apiJson<ScoringV2ConcurrencyDTO>("/api/v1/admin/scoring-v2/concurrency");
    calibration.value = data.value.calibration.configured;
    operation.value = data.value.operation.configured;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to load concurrency";
  } finally {
    busy.value = false;
  }
}

async function save(): Promise<void> {
  if (!data.value) return;
  busy.value = true;
  error.value = null;
  success.value = null;
  try {
    data.value = await apiJson<ScoringV2ConcurrencyDTO>("/api/v1/admin/scoring-v2/concurrency", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        concurrencyCalibration: calibration.value,
        concurrencyOperation: operation.value,
        expectedVersion: data.value.settingsVersion,
      }),
    });
    calibration.value = data.value.calibration.configured;
    operation.value = data.value.operation.configured;
    success.value = "Concurrency settings updated. New claims use the new limits.";
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to update concurrency";
    await load().catch(() => undefined);
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  void load();
});
</script>

<template>
  <div class="concurrency">
    <StatusBanner v-if="error" tone="error" :message="error" />
    <StatusBanner v-if="success" tone="success" :message="success" />

    <section class="panel" aria-labelledby="lanes-title">
      <h2 id="lanes-title">Refresh workload lanes</h2>
      <p class="muted">
        Calibration and operation lanes cannot starve each other. Limits apply to new claims only
        (range 1–8). Provider/WCL admission remains global.
      </p>

      <form v-if="data" class="form" @submit.prevent="save">
        <label>
          concurrency_calibration
          <input v-model.number="calibration" type="number" min="1" max="8" required />
        </label>
        <label>
          concurrency_operation
          <input v-model.number="operation" type="number" min="1" max="8" required />
        </label>
        <button type="submit" :disabled="busy">Save</button>
      </form>
    </section>

    <section v-if="data" class="panel" aria-labelledby="observed-title">
      <h2 id="observed-title">Observed values</h2>
      <table>
        <thead>
          <tr>
            <th>Lane</th>
            <th>Configured</th>
            <th>Effective</th>
            <th>Active</th>
            <th>Queued</th>
            <th>Updated</th>
            <th>By</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>CALIBRATION</td>
            <td>{{ data.calibration.configured }}</td>
            <td>{{ data.calibration.effective }}</td>
            <td>{{ data.calibration.active }}</td>
            <td>{{ data.calibration.queued }}</td>
            <td>{{ data.calibration.updatedAt ?? "—" }}</td>
            <td class="mono">{{ data.calibration.updatedByUserId?.slice(0, 8) ?? "—" }}</td>
          </tr>
          <tr>
            <td>OPERATION</td>
            <td>{{ data.operation.configured }}</td>
            <td>{{ data.operation.effective }}</td>
            <td>{{ data.operation.active }}</td>
            <td>{{ data.operation.queued }}</td>
            <td>{{ data.operation.updatedAt ?? "—" }}</td>
            <td class="mono">{{ data.operation.updatedByUserId?.slice(0, 8) ?? "—" }}</td>
          </tr>
        </tbody>
      </table>
      <p>
        Worker claim hard max {{ data.workerClaimHardMax }} · settings version
        {{ data.settingsVersion }} · synchronized
        <span class="chip">{{ data.synchronized ? "yes" : "no" }}</span>
      </p>
    </section>
  </div>
</template>

<style scoped>
.concurrency {
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
}
</style>
