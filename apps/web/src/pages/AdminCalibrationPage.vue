<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  CALIBRATION_RANK_ORDINAL,
  type CalibrationCohortDTO,
  type CalibrationCohortMemberDTO,
  type CalibrationExpectedRank,
  type CalibrationReportDTO,
  type CalibrationRunDTO,
} from "@mplus/contracts";
import { api } from "../api/client";
import type { AdminScoreModelDTO, RealmOption } from "../api/types";
import StatusBanner from "../components/common/StatusBanner.vue";
import SkeletonBlock from "../components/common/SkeletonBlock.vue";
import FieldTooltip from "../components/common/FieldTooltip.vue";
import ModelStatusBadge from "../components/admin/ModelStatusBadge.vue";
import AdminSelect from "../components/admin/AdminSelect.vue";
import CalibrationRankSelector from "../components/admin/CalibrationRankSelector.vue";
import { DIMENSION_HELP } from "./adminScoringHelp";

const route = useRoute();
const router = useRouter();

const models = ref<AdminScoreModelDTO[]>([]);
const cohorts = ref<CalibrationCohortDTO[]>([]);
const cohort = ref<CalibrationCohortDTO | null>(null);
const selectedModelId = ref("");
const selectedCohortId = ref("");
const runs = ref<CalibrationRunDTO[]>([]);
const activeRun = ref<CalibrationRunDTO | null>(null);
const report = ref<CalibrationReportDTO | null>(null);

const loading = ref(true);
const loadError = ref<string | null>(null);
const actionError = ref<string | null>(null);
const actionMessage = ref<string | null>(null);
const busy = ref(false);

const newCohortName = ref("");
const renameValue = ref("");
const showDeleteConfirm = ref(false);
const showAddDialog = ref(false);

const addRegion = ref("EU");
const addRealmSlug = ref("");
const addRealmQuery = ref("");
const addName = ref("");
const addExpectedRank = ref<CalibrationExpectedRank>("B");
const realmOptions = ref<RealmOption[]>([]);
const searchState = ref<
  "idle" | "searching" | "resolving" | "resolved" | "already" | "failed"
>("idle");
const searchError = ref<string | null>(null);
const resolvedPreview = ref<CalibrationCohortMemberDTO | null>(null);

let pollTimer: ReturnType<typeof setInterval> | null = null;

const selectedModel = computed(
  () => models.value.find((m) => m.id === selectedModelId.value) ?? null,
);

const modelOptions = computed(() =>
  models.value
    .filter((m) => m.status === "ACTIVE" || m.status === "DRAFT")
    .sort((a, b) => {
      if (a.status === b.status) return b.version - a.version;
      return a.status === "ACTIVE" ? -1 : 1;
    })
    .map((m) => ({
      value: m.id,
      label: `${m.name} · v${m.version} · ${m.status}`,
    })),
);

const cohortOptions = computed(() =>
  cohorts.value.map((c) => ({
    value: c.id,
    label: `${c.name} · ${c.memberCount} characters`,
  })),
);

const members = computed(() => cohort.value?.members ?? []);
const canRun = computed(
  () =>
    Boolean(selectedCohortId.value && selectedModelId.value && members.value.length > 0) &&
    !busy.value,
);

const progressLabel = computed(() => {
  const p = activeRun.value?.progress;
  if (!p || p.total <= 0) return null;
  const done = p.completed + p.failed;
  const current =
    p.currentCharacterName && p.currentRealm
      ? ` — Current: ${p.currentCharacterName} — ${p.currentRealm}`
      : "";
  return `${done} / ${p.total} evaluated${current}`;
});

type ResultRow = {
  character: string;
  realm: string;
  region: string;
  expected: string;
  actual: string | null;
  score: number | null;
  performance: number | null;
  survival: number | null;
  utility: number | null;
  experience: number | null;
  difference: string;
  status: string;
};

function dimScore(
  dims: Array<{ dimension: string; score: number | null }> | undefined,
  name: string,
): number | null {
  if (!dims) return null;
  const hit = dims.find((d) => d.dimension.toUpperCase() === name);
  return hit?.score ?? null;
}

function formatDifference(expected: string | null, actual: string | null): string {
  if (!expected || !actual || actual === "U") return "—";
  const exp = expected as CalibrationExpectedRank;
  const act = actual as CalibrationExpectedRank;
  if (!(exp in CALIBRATION_RANK_ORDINAL) || !(act in CALIBRATION_RANK_ORDINAL)) return "—";
  const delta = CALIBRATION_RANK_ORDINAL[act] - CALIBRATION_RANK_ORDINAL[exp];
  if (delta === 0) return "exact match";
  if (delta > 0) return `+${delta} tier${delta === 1 ? "" : "s"}`;
  return `${delta} tier${delta === -1 ? "" : "s"}`;
}

const resultRows = computed<ResultRow[]>(() => {
  const chars = (report.value?.report as { characters?: unknown[] } | null)?.characters;
  if (!Array.isArray(chars)) return [];
  return chars.map((raw) => {
    const c = raw as Record<string, unknown>;
    const dims = c.dimensions as Array<{ dimension: string; score: number | null }> | undefined;
    const expectedVersus = c.expectedVersusActual as
      | { expectedLabel?: string; actualGrade?: string | null }
      | undefined;
    const labelToTier: Record<string, string> = {
      excellent: "S",
      good: "A",
      average: "B",
      weak: "C",
      overrated: "D",
    };
    const expected =
      labelToTier[String(expectedVersus?.expectedLabel ?? "")] ??
      String(expectedVersus?.expectedLabel ?? "—");
    const actual = (expectedVersus?.actualGrade as string | null) ?? (c.grade as string | null);
    const failed = Boolean(c.error || c.validationFailure);
    return {
      character: String(c.character ?? c.displayName ?? "—"),
      realm: String(c.realm ?? "—"),
      region: String(c.region ?? "—"),
      expected,
      actual,
      score: typeof c.overallScore === "number" ? c.overallScore : null,
      performance: dimScore(dims, "PERFORMANCE"),
      survival: dimScore(dims, "SURVIVAL"),
      utility: dimScore(dims, "UTILITY"),
      experience: dimScore(dims, "EXPERIENCE"),
      difference: formatDifference(expected, actual),
      status: failed ? "failed" : "completed",
    };
  });
});

const summary = computed(() => {
  const rows = resultRows.value;
  const completed = rows.filter((r) => r.status === "completed" && r.actual && r.actual !== "U");
  const failed = rows.filter((r) => r.status === "failed").length;
  const exact = completed.filter((r) => r.difference === "exact match").length;
  const diffs = completed
    .map((r) => {
      const m = r.difference.match(/([+-]?\d+)/);
      return m ? Math.abs(Number(m[1])) : r.difference === "exact match" ? 0 : null;
    })
    .filter((n): n is number => n != null);
  const avg =
    diffs.length > 0 ? Math.round((diffs.reduce((a, b) => a + b, 0) / diffs.length) * 100) / 100 : null;
  return {
    total: rows.length || members.value.length,
    completed: completed.length,
    failed,
    exact,
    avgAbsDiff: avg,
  };
});

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function refreshCohorts(): Promise<void> {
  cohorts.value = await api.listCalibrationCohorts();
}

async function selectCohort(id: string): Promise<void> {
  selectedCohortId.value = id;
  if (!id) {
    cohort.value = null;
    runs.value = [];
    return;
  }
  cohort.value = await api.getCalibrationCohort(id);
  renameValue.value = cohort.value.name;
  runs.value = await api.listCalibrationRuns(id);
  void router.replace({
    name: "admin-calibration",
    params: { cohortId: id },
    query: route.query,
  });
}

async function loadReportForRun(run: CalibrationRunDTO): Promise<void> {
  activeRun.value = run;
  if (run.hasReport || run.status === "SUCCEEDED") {
    report.value = await api.getCalibrationReport(run.id);
    stopPolling();
  } else {
    report.value = null;
  }
}

function startPolling(runId: string): void {
  stopPolling();
  pollTimer = setInterval(() => {
    void (async () => {
      try {
        const run = await api.getCalibrationRun(runId);
        activeRun.value = run;
        if (run.status === "SUCCEEDED" || run.status === "FAILED" || run.status === "CANCELLED") {
          if (run.hasReport || run.status === "SUCCEEDED") {
            report.value = await api.getCalibrationReport(run.id);
          }
          runs.value = await api.listCalibrationRuns(selectedCohortId.value);
          stopPolling();
        }
      } catch {
        /* keep polling */
      }
    })();
  }, 2000);
}

function formatCalibrationLoadError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: unknown }).code ?? "")
      : "";
  if (
    code === "ADMIN_CALIBRATION_DISABLED" ||
    /calibration is not enabled/i.test(message)
  ) {
    return "Calibration API is disabled. Set ADMIN_CALIBRATION_ENABLED=true in the API environment and restart pnpm dev.";
  }
  return message;
}

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    // Models can load even when the calibration feature flag is off.
    models.value = await api.listModels();
    const preferredModel =
      models.value.find((m) => m.status === "ACTIVE") ??
      models.value.find((m) => m.status === "DRAFT") ??
      null;
    selectedModelId.value = preferredModel?.id ?? "";

    try {
      await refreshCohorts();
    } catch (err) {
      loadError.value = formatCalibrationLoadError(err);
      return;
    }

    const routeCohort =
      typeof route.params.cohortId === "string" ? route.params.cohortId : "";
    const initial =
      cohorts.value.find((c) => c.id === routeCohort) ?? cohorts.value[0] ?? null;
    if (initial) await selectCohort(initial.id);
  } catch (err) {
    loadError.value = formatCalibrationLoadError(err);
  } finally {
    loading.value = false;
  }
}

async function createCohort(): Promise<void> {
  const name = newCohortName.value.trim();
  if (!name) return;
  busy.value = true;
  actionError.value = null;
  try {
    const created = await api.createCalibrationCohort({ name });
    newCohortName.value = "";
    await refreshCohorts();
    await selectCohort(created.id);
    actionMessage.value = "Cohort created.";
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function renameCohort(): Promise<void> {
  if (!selectedCohortId.value || !renameValue.value.trim()) return;
  busy.value = true;
  try {
    await api.patchCalibrationCohort(selectedCohortId.value, { name: renameValue.value.trim() });
    await refreshCohorts();
    await selectCohort(selectedCohortId.value);
    actionMessage.value = "Cohort renamed.";
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function deleteCohort(): Promise<void> {
  if (!selectedCohortId.value) return;
  busy.value = true;
  try {
    await api.deleteCalibrationCohort(selectedCohortId.value);
    showDeleteConfirm.value = false;
    await refreshCohorts();
    selectedCohortId.value = "";
    cohort.value = null;
    actionMessage.value = "Cohort deleted.";
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function searchRealms(): Promise<void> {
  try {
    realmOptions.value = await api.searchRealms(addRegion.value, addRealmQuery.value, undefined, 25);
  } catch {
    realmOptions.value = [];
  }
}

watch([addRegion, addRealmQuery], () => {
  void searchRealms();
});

async function resolveAndAdd(): Promise<void> {
  if (!selectedCohortId.value || !addRealmSlug.value || !addName.value.trim()) return;
  searchState.value = "resolving";
  searchError.value = null;
  resolvedPreview.value = null;
  try {
    const member = await api.resolveCalibrationMember(selectedCohortId.value, {
      region: addRegion.value,
      realmSlug: addRealmSlug.value,
      characterName: addName.value.trim(),
      expectedRank: addExpectedRank.value,
    });
    searchState.value = "resolved";
    resolvedPreview.value = member;
    await selectCohort(selectedCohortId.value);
    actionMessage.value = `${member.characterName} added to cohort.`;
    showAddDialog.value = false;
    addName.value = "";
    searchState.value = "idle";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/already in the cohort/i.test(message)) searchState.value = "already";
    else searchState.value = "failed";
    searchError.value = message;
  }
}

async function updateMemberRank(memberId: string, rank: CalibrationExpectedRank): Promise<void> {
  if (!selectedCohortId.value) return;
  try {
    await api.patchCalibrationMember(selectedCohortId.value, memberId, { expectedRank: rank });
    await selectCohort(selectedCohortId.value);
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : String(err);
  }
}

async function removeMember(memberId: string): Promise<void> {
  if (!selectedCohortId.value) return;
  try {
    await api.deleteCalibrationMember(selectedCohortId.value, memberId);
    await selectCohort(selectedCohortId.value);
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : String(err);
  }
}

async function runCalibration(): Promise<void> {
  if (!canRun.value || !cohort.value) return;
  busy.value = true;
  actionError.value = null;
  try {
    const run = await api.createCalibrationRun(selectedCohortId.value, {
      scoreModelId: selectedModelId.value,
      expectedCohortRevision: cohort.value.revision,
    });
    activeRun.value = run;
    report.value = null;
    startPolling(run.id);
    actionMessage.value = "Calibration run started.";
    runs.value = await api.listCalibrationRuns(selectedCohortId.value);
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function openRun(run: CalibrationRunDTO): Promise<void> {
  await loadReportForRun(run);
  if (run.status === "QUEUED" || run.status === "RUNNING") startPolling(run.id);
}

onMounted(() => {
  void load();
  void searchRealms();
});
onUnmounted(stopPolling);
</script>

<template>
  <main class="admin-page" aria-labelledby="calibration-title" data-testid="admin-calibration-page">
    <header class="admin-page__header">
      <div>
        <p class="eyebrow">Scoring</p>
        <h1 id="calibration-title">Calibration</h1>
        <p class="lede">
          Label a reusable cohort with expected ranks, evaluate an ACTIVE or DRAFT model, and compare
          expected versus calculated results — without publishing production scores.
        </p>
      </div>
      <div class="header-actions">
        <RouterLink class="btn ghost" :to="{ name: 'admin-models' }">Models</RouterLink>
        <RouterLink class="btn ghost" :to="{ name: 'admin-tuning' }">Tuning</RouterLink>
        <RouterLink
          v-if="selectedModel?.status === 'DRAFT'"
          class="btn primary"
          data-testid="open-in-tuning"
          :to="{ name: 'admin-tuning', query: { model: selectedModel.id } }"
        >
          Open model in Tuning
        </RouterLink>
      </div>
    </header>

    <StatusBanner v-if="loadError" tone="error">{{ loadError }}</StatusBanner>
    <StatusBanner v-if="actionError" tone="error">{{ actionError }}</StatusBanner>
    <StatusBanner v-if="actionMessage" tone="success">{{ actionMessage }}</StatusBanner>

    <div v-if="loading" class="skeletons" data-testid="calibration-loading">
      <SkeletonBlock height="4rem" />
      <SkeletonBlock height="12rem" />
    </div>

    <template v-else>
      <section class="panel controls" aria-label="Cohort and model">
        <div class="controls-grid">
          <AdminSelect
            v-if="cohortOptions.length > 0"
            :model-value="selectedCohortId"
            label="Cohort"
            :options="cohortOptions"
            data-testid="calibration-cohort-select"
            @update:model-value="(v) => void selectCohort(v)"
          />
          <div class="create-row">
            <label class="field">
              <span>New cohort</span>
              <input v-model="newCohortName" type="text" placeholder="Name" maxlength="200" />
            </label>
            <button type="button" class="btn primary" data-testid="create-cohort" :disabled="busy" @click="createCohort">
              Create
            </button>
          </div>
          <AdminSelect
            v-if="modelOptions.length > 0"
            v-model="selectedModelId"
            label="Model to calibrate"
            :options="modelOptions"
            hint="ACTIVE for production checks, DRAFT to evaluate a candidate."
            data-testid="calibration-model-select"
          />
          <div v-if="selectedModel" class="selected-meta">
            <ModelStatusBadge
              :status="selectedModel.status"
              :production="selectedModel.status === 'ACTIVE'"
            />
            <div>
              <div class="selected-name">{{ selectedModel.name }}</div>
              <div class="selected-version">Version {{ selectedModel.version }}</div>
            </div>
          </div>
        </div>

        <div v-if="cohort" class="cohort-actions">
          <label class="field grow">
            <span>Rename</span>
            <input v-model="renameValue" type="text" maxlength="200" />
          </label>
          <button type="button" class="btn ghost" :disabled="busy" @click="renameCohort">Save name</button>
          <button
            type="button"
            class="btn ghost danger"
            data-testid="delete-cohort"
            :disabled="busy"
            @click="showDeleteConfirm = true"
          >
            Delete cohort
          </button>
        </div>
      </section>

      <section v-if="cohort" class="panel" aria-label="Cohort members" data-testid="calibration-members">
        <div class="section-head">
          <h2>Members</h2>
          <button type="button" class="btn primary" data-testid="add-character" @click="showAddDialog = true">
            Add character
          </button>
        </div>
        <p class="muted">{{ members.length }} characters · created {{ new Date(cohort.createdAt).toLocaleString() }}</p>

        <div v-if="members.length === 0" class="empty">No characters yet. Add one to begin labeling.</div>
        <table v-else class="table">
          <thead>
            <tr>
              <th>Character</th>
              <th>Realm</th>
              <th>Region</th>
              <th>Class / Spec</th>
              <th>
                  <span class="th-with-tip">
                    Expected
                    <FieldTooltip
                      label="Expected rank"
                      what-it-means="What you believe this player's rank should be before running the model."
                    />
                  </span>
              </th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in members" :key="m.id">
              <td>{{ m.characterName }}</td>
              <td>{{ m.realmSlug }}</td>
              <td>{{ m.region }}</td>
              <td>{{ [m.classSlug, m.specSlug].filter(Boolean).join(" · ") || "—" }}</td>
              <td>
                <CalibrationRankSelector
                  :model-value="m.expectedRank"
                  size="sm"
                  @update:model-value="(r) => void updateMemberRank(m.id, r)"
                />
              </td>
              <td>
                <button type="button" class="btn ghost danger" @click="removeMember(m.id)">Remove</button>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section v-if="cohort" class="panel" aria-label="Run calibration">
        <div class="section-head">
          <h2>Run</h2>
          <button
            type="button"
            class="btn primary"
            data-testid="run-calibration"
            :disabled="!canRun"
            @click="runCalibration"
          >
            Run calibration
          </button>
        </div>
        <p v-if="progressLabel" class="progress" data-testid="run-progress">{{ progressLabel }}</p>
        <p v-else class="muted">Sequential evaluation · reusable evidence when available · does not publish production scores.</p>
      </section>

      <section v-if="resultRows.length > 0" class="panel" aria-label="Results" data-testid="calibration-results">
        <h2>Results</h2>
        <div class="summary" data-testid="calibration-summary">
          <span>{{ summary.total }} total</span>
          <span>{{ summary.completed }} completed</span>
          <span>{{ summary.failed }} failed</span>
          <span>{{ summary.exact }} exact matches</span>
          <span v-if="summary.avgAbsDiff != null">avg |Δ| {{ summary.avgAbsDiff }}</span>
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Character</th>
                <th>
                  <span class="th-with-tip">
                    Expected
                    <FieldTooltip label="Expected rank" what-it-means="Administrator label before the run." />
                  </span>
                </th>
                <th>
                  <span class="th-with-tip">
                    Actual
                    <FieldTooltip
                      label="Actual rank"
                      what-it-means="What the selected scoring model calculated."
                    />
                  </span>
                </th>
                <th>Score</th>
                <th>
                  <span class="th-with-tip">
                    Performance
                    <FieldTooltip
                      :label="DIMENSION_HELP.performance.title"
                      :what-it-means="DIMENSION_HELP.performance.summary"
                    />
                  </span>
                </th>
                <th>
                  <span class="th-with-tip">
                    Survival
                    <FieldTooltip
                      :label="DIMENSION_HELP.survival.title"
                      :what-it-means="DIMENSION_HELP.survival.summary"
                    />
                  </span>
                </th>
                <th>
                  <span class="th-with-tip">
                    Utility
                    <FieldTooltip
                      :label="DIMENSION_HELP.utility.title"
                      :what-it-means="DIMENSION_HELP.utility.summary"
                    />
                  </span>
                </th>
                <th>
                  <span class="th-with-tip">
                    Experience
                    <FieldTooltip
                      :label="DIMENSION_HELP.experience.title"
                      :what-it-means="DIMENSION_HELP.experience.summary"
                    />
                  </span>
                </th>
                <th>
                  <span class="th-with-tip">
                    Difference
                    <FieldTooltip
                      label="Difference"
                      what-it-means="Ordinal tier distance between expected and actual (S=0 … D=4)."
                    />
                  </span>
                </th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in resultRows" :key="i" :class="{ 'is-fail': row.status === 'failed' }">
                <td>{{ row.character }} <span class="muted">{{ row.realm }}</span></td>
                <td><span class="rank">{{ row.expected }}</span></td>
                <td><span class="rank">{{ row.actual ?? "—" }}</span></td>
                <td>{{ row.score != null ? row.score.toFixed(1) : "—" }}</td>
                <td>{{ row.performance != null ? row.performance.toFixed(1) : "—" }}</td>
                <td>{{ row.survival != null ? row.survival.toFixed(1) : "—" }}</td>
                <td>{{ row.utility != null ? row.utility.toFixed(1) : "—" }}</td>
                <td>{{ row.experience != null ? row.experience.toFixed(1) : "—" }}</td>
                <td>{{ row.difference }}</td>
                <td><span class="badge" :class="row.status">{{ row.status }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-if="runs.length > 0" class="panel" aria-label="Run history" data-testid="run-history">
        <h2>Run history</h2>
        <ul class="history">
          <li v-for="run in runs" :key="run.id">
            <button type="button" class="history-btn" @click="openRun(run)">
              <span>{{ new Date(run.createdAt).toLocaleString() }}</span>
              <span>{{ run.scoreModelName ?? "Model" }} v{{ run.scoreModelVersion ?? "?" }}</span>
              <span>{{ run.scoreModelStatus }}</span>
              <span>{{ run.status }}</span>
              <span v-if="run.summaryExactMatches != null">{{ run.summaryExactMatches }} exact</span>
            </button>
          </li>
        </ul>
      </section>
    </template>

    <div v-if="showAddDialog" class="dialog-backdrop" data-testid="add-character-dialog" @click.self="showAddDialog = false">
      <div class="dialog" role="dialog" aria-modal="true" aria-label="Add character">
        <h2>Add character</h2>
        <p class="muted">Search by region, realm, and name. Missing characters are resolved from Blizzard identity only — no scoring acquisition yet.</p>
        <div class="dialog-grid">
          <label class="field">
            <span>Region</span>
            <select v-model="addRegion">
              <option value="EU">EU</option>
              <option value="US">US</option>
              <option value="KR">KR</option>
              <option value="TW">TW</option>
            </select>
          </label>
          <label class="field">
            <span>Realm</span>
            <input v-model="addRealmQuery" type="text" placeholder="Search realm…" list="realm-options" />
            <datalist id="realm-options">
              <option v-for="r in realmOptions" :key="r.slug" :value="r.slug">{{ r.name }}</option>
            </datalist>
            <select v-model="addRealmSlug">
              <option disabled value="">Select realm</option>
              <option v-for="r in realmOptions" :key="r.slug" :value="r.slug">{{ r.name }}</option>
            </select>
          </label>
          <label class="field">
            <span>Character name</span>
            <input v-model="addName" type="text" maxlength="48" />
          </label>
          <div class="field">
            <span>Expected rank</span>
            <CalibrationRankSelector v-model="addExpectedRank" />
          </div>
        </div>
        <p v-if="searchState === 'resolving'" class="muted">Resolving from Blizzard…</p>
        <p v-else-if="searchState === 'already'" class="warn">Already in cohort</p>
        <p v-else-if="searchState === 'failed'" class="warn">{{ searchError ?? "Character not found" }}</p>
        <p v-else-if="searchState === 'resolved' && resolvedPreview" class="ok">
          Resolved {{ resolvedPreview.characterName }} — {{ resolvedPreview.realmSlug }} ({{ resolvedPreview.region }})
          <template v-if="resolvedPreview.classSlug"> · {{ resolvedPreview.classSlug }}</template>
          <template v-if="resolvedPreview.specSlug"> / {{ resolvedPreview.specSlug }}</template>
        </p>
        <div class="dialog-actions">
          <button type="button" class="btn ghost" @click="showAddDialog = false">Cancel</button>
          <button type="button" class="btn primary" :disabled="searchState === 'resolving'" @click="resolveAndAdd">
            Search &amp; add
          </button>
        </div>
      </div>
    </div>

    <div v-if="showDeleteConfirm" class="dialog-backdrop" @click.self="showDeleteConfirm = false">
      <div class="dialog" role="dialog" aria-modal="true">
        <h2>Delete cohort?</h2>
        <p class="muted">Only unused cohorts (no runs) can be deleted. This cannot be undone.</p>
        <div class="dialog-actions">
          <button type="button" class="btn ghost" @click="showDeleteConfirm = false">Cancel</button>
          <button type="button" class="btn primary danger" :disabled="busy" @click="deleteCohort">Delete</button>
        </div>
      </div>
    </div>
  </main>
</template>

<style scoped>
.admin-page {
  max-width: 72rem;
  margin: 0 auto;
  padding: var(--space-8) var(--space-4) var(--space-16);
  display: grid;
  gap: var(--space-6);
}

.admin-page__header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: var(--space-4);
}

.eyebrow {
  margin: 0 0 var(--space-2);
  font-size: var(--text-xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-amber-400);
  font-weight: 700;
}

h1 {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-3xl);
}

h2 {
  margin: 0;
  font-size: var(--text-lg);
}

.lede {
  margin: var(--space-3) 0 0;
  color: var(--color-text-muted);
  line-height: 1.5;
  max-width: 42rem;
}

.header-actions,
.section-head,
.cohort-actions,
.dialog-actions,
.create-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: end;
}

.section-head {
  justify-content: space-between;
  align-items: center;
}

.panel {
  padding: var(--space-5);
  border-radius: var(--radius-card);
  border: 1px solid var(--color-border);
  background:
    linear-gradient(180deg, rgb(255 255 255 / 3%), transparent 45%),
    var(--color-surface);
  display: grid;
  gap: var(--space-4);
}

.controls-grid {
  display: grid;
  gap: var(--space-4);
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
}

.selected-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: center;
}

.selected-name { font-weight: 700; }
.selected-version {
  font-family: var(--font-data);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

.field {
  display: grid;
  gap: 0.35rem;
  font-size: var(--text-sm);
}

.field.grow { flex: 1; min-width: 12rem; }

.field input,
.field select {
  padding: 0.5rem 0.65rem;
  border-radius: var(--radius-control);
  border: 1px solid var(--color-border);
  background: rgb(0 0 0 / 25%);
  color: var(--color-text);
}

.muted { margin: 0; color: var(--color-text-muted); font-size: var(--text-sm); }
.warn { color: #f0a0a0; }
.ok { color: #9fdfb0; }
.empty { color: var(--color-text-muted); padding: var(--space-4) 0; }
.progress { font-family: var(--font-data); font-weight: 600; }

.table-wrap { overflow-x: auto; }
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}
.table th,
.table td {
  text-align: left;
  padding: 0.55rem 0.45rem;
  border-bottom: 1px solid var(--color-border);
  vertical-align: middle;
}
.table tr.is-fail td { color: #f0a0a0; }
.rank { font-family: var(--font-data); font-weight: 700; }
.th-with-tip { display: inline-flex; align-items: center; gap: 0.25rem; }

.summary {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  font-family: var(--font-data);
  font-size: var(--text-sm);
}

.badge {
  display: inline-block;
  padding: 0.15rem 0.45rem;
  border-radius: var(--radius-control);
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.badge.completed { background: rgb(80 160 100 / 25%); }
.badge.failed { background: rgb(180 60 60 / 30%); }

.history { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.35rem; }
.history-btn {
  width: 100%;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  padding: 0.55rem 0.7rem;
  border-radius: var(--radius-control);
  border: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
  font-size: var(--text-sm);
  text-align: left;
}
.history-btn:hover { background: var(--color-surface-hover); }

.btn {
  display: inline-flex;
  align-items: center;
  padding: 0.45rem 0.85rem;
  border-radius: var(--radius-control);
  border: 1px solid var(--color-border);
  color: var(--color-text);
  text-decoration: none;
  font-size: var(--text-sm);
  font-weight: 600;
  background: transparent;
  cursor: pointer;
}
.btn:hover:not(:disabled) { background: var(--color-surface-hover); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn.primary {
  background: var(--color-amber-400);
  border-color: transparent;
  color: #111;
}
.btn.danger { color: #f0a0a0; }
.btn.primary.danger { background: #a33; color: #fff; }

.dialog-backdrop {
  position: fixed;
  inset: 0;
  background: rgb(0 0 0 / 55%);
  display: grid;
  place-items: center;
  padding: var(--space-4);
  z-index: 40;
}
.dialog {
  width: min(32rem, 100%);
  padding: var(--space-5);
  border-radius: var(--radius-card);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  display: grid;
  gap: var(--space-4);
}
.dialog-grid {
  display: grid;
  gap: var(--space-3);
}

.skeletons { display: grid; gap: var(--space-3); }

@media (max-width: 720px) {
  .table { font-size: var(--text-xs); }
}
</style>
