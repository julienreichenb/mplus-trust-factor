<script setup lang="ts">
import { computed, ref } from "vue";
import { api } from "../api/client";
import type { CharacterComparisonResponse, CharacterIdentityInput, RedFlagDTO } from "../api/types";
import StatusBanner from "../components/common/StatusBanner.vue";
import TrustRadarChart from "../components/charts/TrustRadarChart.vue";
import { validateCompareCount, formatPercent, formatScore, DIMENSION_LABELS, RADAR_DIMENSIONS } from "../lib/format";

type CompareEntry = CharacterComparisonResponse["entries"][number] & {
  authenticityScore?: number | null;
  redFlags?: RedFlagDTO[];
};

type CompareResult = CharacterComparisonResponse & {
  compatible?: boolean;
  incompatibilityReason?: string | null;
  entries: CompareEntry[];
};

const draftRegion = ref("EU");
const draftRealm = ref("");
const draftName = ref("");
const candidates = ref<CharacterIdentityInput[]>([
  { region: "EU", realmSlug: "tarren-mill", name: "Aleria" },
  { region: "EU", realmSlug: "kazzak", name: "Carryme" },
]);
const formError = ref<string | null>(null);
const loading = ref(false);
const result = ref<CompareResult | null>(null);
const sortKey = ref<"overall" | (typeof RADAR_DIMENSIONS)[number]>("overall");
const hiddenSeries = ref<Set<string>>(new Set());

function addCandidate(): void {
  formError.value = null;
  if (!draftRealm.value.trim() || !draftName.value.trim()) {
    formError.value = "Realm and name are required.";
    return;
  }
  const countError = validateCompareCount(candidates.value.length + 1, { minimum: false });
  if (countError) {
    formError.value = countError;
    return;
  }
  candidates.value.push({
    region: draftRegion.value.toUpperCase(),
    realmSlug: draftRealm.value.trim().toLowerCase(),
    name: draftName.value.trim(),
  });
  draftRealm.value = "";
  draftName.value = "";
}

function removeCandidate(index: number): void {
  candidates.value.splice(index, 1);
}

async function runCompare(): Promise<void> {
  formError.value = validateCompareCount(candidates.value.length);
  if (formError.value) return;
  loading.value = true;
  result.value = null;
  try {
    result.value = (await api.compareCharacters({
      characters: candidates.value,
    })) as CompareResult;
  } catch (err) {
    formError.value = (err as Error).message;
  } finally {
    loading.value = false;
  }
}

const sortedEntries = computed(() => {
  const entries = [...(result.value?.entries ?? [])];
  entries.sort((a, b) => {
    const av =
      sortKey.value === "overall"
        ? (a.overallScore ?? -1)
        : (a.dimensions?.find((d) => d.dimension === sortKey.value)?.score ?? -1);
    const bv =
      sortKey.value === "overall"
        ? (b.overallScore ?? -1)
        : (b.dimensions?.find((d) => d.dimension === sortKey.value)?.score ?? -1);
    return bv - av;
  });
  return entries;
});

const radarSeries = computed(() =>
  (result.value?.entries ?? [])
    .filter((e) => e.dimensions)
    .map((e) => ({
      id: `${e.identity.region}-${e.identity.realmSlug}-${e.identity.name}`,
      name: e.identity.name,
      dimensions: e.dimensions!,
      visible: !hiddenSeries.value.has(
        `${e.identity.region}-${e.identity.realmSlug}-${e.identity.name}`,
      ),
    })),
);

function toggleSeries(id: string): void {
  const next = new Set(hiddenSeries.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  hiddenSeries.value = next;
}
</script>

<template>
  <section data-testid="compare-page">
    <h1>Compare candidates</h1>
    <p>Compare 2–10 characters on one model/season snapshot with deltas vs median and best.</p>

    <form class="add-form" aria-label="Add comparison candidate" @submit.prevent="addCandidate">
      <label>
        Region
        <select v-model="draftRegion">
          <option value="EU">EU</option>
        </select>
      </label>
      <label>
        Realm
        <input v-model="draftRealm" data-testid="compare-realm" />
      </label>
      <label>
        Name
        <input v-model="draftName" data-testid="compare-name" />
      </label>
      <button type="submit" class="btn" data-testid="compare-add">Add</button>
    </form>

    <ul class="candidates" data-testid="compare-candidates">
      <li v-for="(c, idx) in candidates" :key="`${c.region}-${c.realmSlug}-${c.name}-${idx}`">
        {{ c.name }} — {{ c.realmSlug }} ({{ c.region }})
        <button type="button" class="btn link" @click="removeCandidate(idx)">Remove</button>
      </li>
    </ul>

    <p v-if="formError" class="error" role="alert" data-testid="compare-error">{{ formError }}</p>

    <button type="button" class="btn primary" data-testid="compare-submit" :disabled="loading" @click="runCompare">
      {{ loading ? "Comparing…" : "Compare" }}
    </button>

    <template v-if="result">
      <StatusBanner
        v-if="result.compatible === false"
        tone="error"
        title="Incompatible comparison"
        data-testid="compatibility-banner"
      >
        {{ result.incompatibilityReason || "Model or season mismatch across candidates." }}
      </StatusBanner>
      <StatusBanner v-else tone="success" title="Compatible snapshot">
        Model {{ result.modelKey }} v{{ result.modelVersion }} · {{ result.seasonSlug }}
      </StatusBanner>

      <TrustRadarChart
        title="Overlaid dimensions"
        :series="radarSeries"
        @toggle-series="toggleSeries"
      />

      <label class="sort">
        Sort by
        <select v-model="sortKey" data-testid="compare-sort">
          <option value="overall">Overall</option>
          <option v-for="dim in RADAR_DIMENSIONS" :key="dim" :value="dim">
            {{ DIMENSION_LABELS[dim] }}
          </option>
        </select>
      </label>

      <div class="table-wrap">
        <table class="compare-table" data-testid="compare-table">
          <thead>
            <tr>
              <th scope="col">Character</th>
              <th scope="col">Grade / score</th>
              <th scope="col">Confidence</th>
              <th v-for="dim in RADAR_DIMENSIONS" :key="dim" scope="col">{{ DIMENSION_LABELS[dim] }}</th>
              <th scope="col">Authenticity</th>
              <th scope="col">Red flags</th>
              <th scope="col">Δ median</th>
              <th scope="col">Δ best</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in sortedEntries" :key="`${e.identity.name}-${e.characterId}`">
              <th scope="row">{{ e.identity.name }}</th>
              <td>{{ e.grade ?? "—" }} / {{ formatScore(e.overallScore, 0) }}</td>
              <td>{{ formatPercent(e.confidence != null ? e.confidence * 100 : null, 0) }}</td>
              <td v-for="dim in RADAR_DIMENSIONS" :key="dim">
                {{ formatScore(e.dimensions?.find((d) => d.dimension === dim)?.score, 0) }}
              </td>
              <td>{{ formatScore(e.authenticityScore ?? null, 0) }}</td>
              <td>{{ (e.redFlags ?? []).map((f) => f.label).join(", ") || "—" }}</td>
              <td>{{ formatScore(e.deltasFromMedian.overall ?? null, 1) }}</td>
              <td>{{ formatScore(e.deltasFromBest.overall ?? null, 1) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>

<style scoped>
.add-form {
  display: grid;
  gap: 0.6rem;
  grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
  max-width: 40rem;
  align-items: end;
  margin-bottom: 1rem;
}

label {
  display: grid;
  gap: 0.25rem;
  font-weight: 600;
}

input,
select {
  font: inherit;
  padding: 0.5rem 0.65rem;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--fg);
}

.candidates {
  list-style: none;
  padding: 0;
  display: grid;
  gap: 0.35rem;
}

.error {
  color: var(--danger);
}

.sort {
  display: inline-grid;
  gap: 0.25rem;
  margin: 1rem 0;
}

.table-wrap {
  overflow-x: auto;
}

.compare-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
}

.compare-table th,
.compare-table td {
  border: 1px solid var(--border);
  padding: 0.45rem 0.55rem;
  text-align: left;
  white-space: nowrap;
}
</style>
