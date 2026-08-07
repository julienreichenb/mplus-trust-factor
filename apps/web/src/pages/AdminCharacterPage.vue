<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import CharacterIdentity from "../components/character/CharacterIdentity.vue";
import StatusBanner from "../components/common/StatusBanner.vue";
import SkeletonBlock from "../components/common/SkeletonBlock.vue";
import { ApiClientError } from "../api/live-client";
import { sanitizeWarcraftLogsUrl } from "../lib/warcraftLogsUrl";
import TrustTierBadge from "../components/landing/TrustTierBadge.vue";
import type { Grade } from "@mplus/contracts";

const props = defineProps<{ characterId: string }>();

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

type DigestRow = {
  id: string;
  participantActorId: number;
  characterName: string;
  realmSlug: string | null;
  regionCode: string | null;
  classSlug: string | null;
  specSlug: string | null;
  role: string | null;
  extractorVersion: string;
  dungeonSlug: string | null;
  keyLevel: number | null;
  createdAt: string;
  updatedAt: string;
  offensive: unknown;
  utility: unknown;
  survival: unknown;
  sourceMetadata: unknown;
  raw: {
    id: string;
    reportCode: string;
    fightId: number;
    reportRevision: number;
    acquisitionVersion: string;
    fetchedAt: string;
    providerCost: unknown;
    payloadBytes: number | null;
    payloadKeys: string[];
    wclUrl: string;
  };
};

type CharacterScoreRow = {
  id: string;
  seasonSlug: string | null;
  scoringVersion: string;
  performance: number | null;
  utility: number | null;
  survival: number | null;
  experience: number | null;
  composite: number | null;
  confidence: number | null;
  tier: string | null;
  dimensionDetails: unknown;
  selectedRuns: unknown;
  calculatedAt: string;
};

type SnapshotRow = {
  id: string;
  seasonSlug: string | null;
  scoreModelKey: string | null;
  scoreModelVersion: number | null;
  overallScore: number;
  grade: string;
  confidence: number;
  publicationStatus: string;
  isPublic: boolean;
  coverageState: string | null;
  rejectionReason: string | null;
  calculatedAt: string;
  publishedAt: string | null;
  explanation: unknown;
};

type DetailResponse = {
  character: {
    id: string;
    region: string;
    realmSlug: string;
    realmName: string;
    name: string;
    classSlug: string | null;
    classColor: string | null;
    avatarUrl: string | null;
    classIconUrl: string | null;
    mythicPlusScore: number | null;
    lastSeenAt: string | null;
    lastPublicRefreshAt: string | null;
    publicPath: string;
  };
  digests: DigestRow[];
  characterScores: CharacterScoreRow[];
  scoreSnapshots: SnapshotRow[];
};

type SortDir = "asc" | "desc";

const loading = ref(true);
const error = ref<string | null>(null);
const detail = ref<DetailResponse | null>(null);

const digestFilter = ref("");
const digestSortKey = ref<"createdAt" | "reportCode" | "specSlug" | "role" | "dungeonSlug" | "keyLevel">(
  "createdAt",
);
const digestSortDir = ref<SortDir>("desc");
const digestPage = ref(1);
const DIGEST_PAGE_SIZE = 10;

const scoreFilter = ref("");
const scoreSortKey = ref<"calculatedAt" | "composite" | "confidence" | "tier">("calculatedAt");
const scoreSortDir = ref<SortDir>("desc");

const snapshotFilter = ref("");
const snapshotSortKey = ref<"calculatedAt" | "overallScore" | "confidence" | "grade">("calculatedAt");
const snapshotSortDir = ref<SortDir>("desc");

const expandedDigestId = ref<string | null>(null);
const rawPayload = ref<unknown>(null);
const rawPayloadBusy = ref(false);
const rawPayloadError = ref<string | null>(null);
const expandedScoreId = ref<string | null>(null);
const expandedSnapshotId = ref<string | null>(null);

async function apiJson<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, { credentials: "include" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiClientError(
      typeof body?.message === "string" ? body.message : `HTTP ${response.status}`,
      response.status,
      typeof body?.code === "string" ? body.code : undefined,
    );
  }
  return body as T;
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  detail.value = null;
  expandedDigestId.value = null;
  rawPayload.value = null;
  try {
    detail.value = await apiJson<DetailResponse>(
      `/api/v1/admin/characters/${encodeURIComponent(props.characterId)}`,
    );
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

function cmp(a: unknown, b: unknown, dir: SortDir): number {
  const mul = dir === "asc" ? 1 : -1;
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return (a - b) * mul;
  return String(a).localeCompare(String(b), undefined, { sensitivity: "base" }) * mul;
}

function toggleSort<K extends string>(
  currentKey: { value: K },
  currentDir: { value: SortDir },
  key: K,
): void {
  if (currentKey.value === key) {
    currentDir.value = currentDir.value === "asc" ? "desc" : "asc";
  } else {
    currentKey.value = key;
    currentDir.value = key.toLowerCase().includes("at") ? "desc" : "asc";
  }
}

const filteredDigests = computed(() => {
  const q = digestFilter.value.trim().toLowerCase();
  let rows = detail.value?.digests ?? [];
  if (q) {
    rows = rows.filter((r) => {
      const hay = [
        r.raw.reportCode,
        String(r.raw.fightId),
        r.specSlug,
        r.role,
        r.extractorVersion,
        r.classSlug,
        r.dungeonSlug,
        r.keyLevel != null ? String(r.keyLevel) : "",
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }
  const key = digestSortKey.value;
  const dir = digestSortDir.value;
  return [...rows].sort((a, b) => {
    if (key === "reportCode") return cmp(a.raw.reportCode, b.raw.reportCode, dir);
    if (key === "specSlug") return cmp(a.specSlug, b.specSlug, dir);
    if (key === "role") return cmp(a.role, b.role, dir);
    if (key === "dungeonSlug") return cmp(a.dungeonSlug, b.dungeonSlug, dir);
    if (key === "keyLevel") return cmp(a.keyLevel, b.keyLevel, dir);
    return cmp(a.createdAt, b.createdAt, dir);
  });
});

const digestPageCount = computed(() =>
  Math.max(1, Math.ceil(filteredDigests.value.length / DIGEST_PAGE_SIZE)),
);

const pagedDigests = computed(() => {
  const page = Math.min(digestPage.value, digestPageCount.value);
  const start = (page - 1) * DIGEST_PAGE_SIZE;
  return filteredDigests.value.slice(start, start + DIGEST_PAGE_SIZE);
});

watch(digestFilter, () => {
  digestPage.value = 1;
});

watch(filteredDigests, () => {
  if (digestPage.value > digestPageCount.value) {
    digestPage.value = digestPageCount.value;
  }
});

const filteredScores = computed(() => {
  const q = scoreFilter.value.trim().toLowerCase();
  let rows = detail.value?.characterScores ?? [];
  if (q) {
    rows = rows.filter((r) =>
      [r.seasonSlug, r.scoringVersion, r.tier, String(r.composite ?? "")]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }
  const key = scoreSortKey.value;
  const dir = scoreSortDir.value;
  return [...rows].sort((a, b) => cmp(a[key], b[key], dir));
});

const filteredSnapshots = computed(() => {
  const q = snapshotFilter.value.trim().toLowerCase();
  let rows = detail.value?.scoreSnapshots ?? [];
  if (q) {
    rows = rows.filter((r) =>
      [
        r.seasonSlug,
        r.scoreModelKey,
        r.grade,
        r.publicationStatus,
        r.coverageState,
        r.rejectionReason,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }
  const key = snapshotSortKey.value;
  const dir = snapshotSortDir.value;
  return [...rows].sort((a, b) => cmp(a[key], b[key], dir));
});

async function toggleDigest(row: DigestRow): Promise<void> {
  if (expandedDigestId.value === row.id) {
    expandedDigestId.value = null;
    rawPayload.value = null;
    rawPayloadError.value = null;
    return;
  }
  expandedDigestId.value = row.id;
  rawPayload.value = null;
  rawPayloadError.value = null;
  rawPayloadBusy.value = true;
  try {
    const body = await apiJson<{ payload: unknown }>(
      `/api/v1/admin/characters/${encodeURIComponent(props.characterId)}/wcl-raw/${encodeURIComponent(row.raw.id)}`,
    );
    rawPayload.value = body.payload;
  } catch (err) {
    rawPayloadError.value = err instanceof Error ? err.message : String(err);
  } finally {
    rawPayloadBusy.value = false;
  }
}

function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toFixed(digits);
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function pretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

onMounted(() => {
  void load();
});

watch(
  () => props.characterId,
  () => {
    void load();
  },
);

const currentTrust = computed(() => {
  const operational = detail.value?.characterScores[0] ?? null;
  if (operational && (operational.composite != null || operational.tier)) {
    return {
      source: "operational" as const,
      grade: operational.tier,
      score: operational.composite,
      confidence: operational.confidence,
      seasonSlug: operational.seasonSlug,
      calculatedAt: operational.calculatedAt,
    };
  }
  const published = detail.value?.scoreSnapshots[0] ?? null;
  if (published) {
    return {
      source: "published" as const,
      grade: published.grade,
      score: published.overallScore,
      confidence: published.confidence,
      seasonSlug: published.seasonSlug,
      calculatedAt: published.calculatedAt,
    };
  }
  return null;
});

const currentGrade = computed((): Grade | null => {
  const raw = currentTrust.value?.grade;
  if (raw === "S" || raw === "A" || raw === "B" || raw === "C" || raw === "D" || raw === "U") {
    return raw;
  }
  return null;
});
</script>

<template>
  <section class="admin-char" data-testid="admin-character-page">
    <header class="header">
      <div class="header__nav">
        <RouterLink class="btn ghost" :to="{ name: 'admin-users' }">← Admin users</RouterLink>
      </div>
      <template v-if="detail">
        <div class="header__identity">
          <div class="header__portrait">
            <CharacterIdentity
              portrait-only
              :region="detail.character.region"
              :name="detail.character.name"
              :realm-slug="detail.character.realmSlug"
              :class-slug="detail.character.classSlug"
              :class-color="detail.character.classColor"
              :avatar-url="detail.character.avatarUrl"
              :class-icon-url="detail.character.classIconUrl"
              :size="48"
            />
          </div>
          <div class="header__meta">
            <div class="header__meta-main">
              <h1>{{ detail.character.name }}</h1>
              <p class="muted">
                {{ detail.character.region }} · {{ detail.character.realmName }} · M+
                {{
                  detail.character.mythicPlusScore != null
                    ? Math.round(detail.character.mythicPlusScore)
                    : "—"
                }}
              </p>
              <div class="header__trust" data-testid="admin-character-trust">
                <template v-if="currentTrust">
                  <TrustTierBadge
                    :tier="currentGrade"
                    size="md"
                    letter-only
                    flush
                  />
                  <span class="header__score">
                    Score
                    <strong class="mpts-data">{{
                      currentTrust.score != null ? fmtNum(currentTrust.score, 1) : "—"
                    }}</strong>
                  </span>
                  <span
                    v-if="currentTrust.confidence != null"
                    class="muted header__conf"
                  >
                    · conf {{ fmtNum(currentTrust.confidence, 3) }}
                    <template v-if="currentTrust.source === 'operational'"> (operational)</template>
                    <template v-else> (published)</template>
                  </span>
                </template>
                <span v-else class="muted">No Trust Score yet</span>
              </div>
            </div>
            <div class="header__links">
              <RouterLink class="btn ghost" :to="detail.character.publicPath">Public profile</RouterLink>
              <button type="button" class="btn ghost" :disabled="loading" @click="load">Reload</button>
            </div>
          </div>
        </div>
      </template>
      <template v-else>
        <h1>Admin character</h1>
      </template>
    </header>

    <StatusBanner v-if="error" tone="error">{{ error }}</StatusBanner>

    <div v-if="loading" class="skeletons" data-testid="admin-character-loading">
      <SkeletonBlock height="4rem" />
      <SkeletonBlock height="12rem" />
    </div>

    <template v-else-if="detail">
      <section class="panel" aria-label="WCL digests">
        <div class="panel__head">
          <h2>WCL digests &amp; raw runs</h2>
          <input
            v-model="digestFilter"
            class="admin-control"
            type="search"
            placeholder="Filter report, dungeon, key…"
            data-testid="digest-filter"
          />
        </div>
        <p class="muted count">
          {{ filteredDigests.length }} digest{{ filteredDigests.length === 1 ? "" : "s" }}
          <span v-if="filteredDigests.length > DIGEST_PAGE_SIZE">
            · page {{ Math.min(digestPage, digestPageCount) }} / {{ digestPageCount }}
          </span>
        </p>
        <div class="table-wrap">
          <table class="data-table" data-testid="digest-table">
            <thead>
              <tr>
                <th>
                  <button type="button" class="th-btn" @click="toggleSort(digestSortKey, digestSortDir, 'dungeonSlug')">
                    Dungeon
                  </button>
                </th>
                <th>
                  <button type="button" class="th-btn" @click="toggleSort(digestSortKey, digestSortDir, 'keyLevel')">
                    Key
                  </button>
                </th>
                <th>
                  <button type="button" class="th-btn" @click="toggleSort(digestSortKey, digestSortDir, 'reportCode')">
                    Report
                  </button>
                </th>
                <th>Fight</th>
                <th>
                  <button type="button" class="th-btn" @click="toggleSort(digestSortKey, digestSortDir, 'specSlug')">
                    Spec
                  </button>
                </th>
                <th>
                  <button type="button" class="th-btn" @click="toggleSort(digestSortKey, digestSortDir, 'role')">
                    Role
                  </button>
                </th>
                <th>
                  <button type="button" class="th-btn" @click="toggleSort(digestSortKey, digestSortDir, 'createdAt')">
                    Created
                  </button>
                </th>
                <th>WCL</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="row in pagedDigests" :key="row.id">
                <tr
                  class="clickable"
                  :class="{ 'row--expanded': expandedDigestId === row.id }"
                  @click="toggleDigest(row)"
                >
                  <td>{{ row.dungeonSlug ?? "—" }}</td>
                  <td>{{ row.keyLevel != null ? `+${row.keyLevel}` : "—" }}</td>
                  <td><code>{{ row.raw.reportCode }}</code></td>
                  <td>{{ row.raw.fightId }}</td>
                  <td>{{ row.specSlug ?? "—" }}</td>
                  <td>{{ row.role ?? "—" }}</td>
                  <td>{{ fmtDate(row.createdAt) }}</td>
                  <td @click.stop>
                    <a
                      v-if="sanitizeWarcraftLogsUrl(row.raw.wclUrl)"
                      class="ext"
                      :href="sanitizeWarcraftLogsUrl(row.raw.wclUrl)!"
                      target="_blank"
                      rel="noopener noreferrer"
                    >Open</a>
                    <span v-else>—</span>
                  </td>
                </tr>
                <tr v-if="expandedDigestId === row.id" class="detail-row">
                  <td colspan="8">
                    <div class="detail-grid">
                      <div>
                        <h3>Digest</h3>
                        <pre>{{ pretty({ offensive: row.offensive, utility: row.utility, survival: row.survival, sourceMetadata: row.sourceMetadata }) }}</pre>
                      </div>
                      <div>
                        <h3>Raw WCL payload</h3>
                        <p class="muted">
                          rev {{ row.raw.reportRevision }} · {{ row.raw.acquisitionVersion }} · fetched
                          {{ fmtDate(row.raw.fetchedAt) }}
                        </p>
                        <p v-if="rawPayloadBusy" class="muted">Loading payload…</p>
                        <p v-else-if="rawPayloadError" class="error">{{ rawPayloadError }}</p>
                        <pre v-else>{{ pretty(rawPayload) }}</pre>
                      </div>
                    </div>
                  </td>
                </tr>
              </template>
              <tr v-if="pagedDigests.length === 0">
                <td colspan="8" class="muted">No digests matched.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="filteredDigests.length > DIGEST_PAGE_SIZE" class="pager" data-testid="digest-pager">
          <button
            type="button"
            class="btn ghost"
            :disabled="digestPage <= 1"
            data-testid="digest-page-prev"
            @click="digestPage -= 1"
          >
            Previous
          </button>
          <span class="muted">{{ digestPage }} / {{ digestPageCount }}</span>
          <button
            type="button"
            class="btn ghost"
            :disabled="digestPage >= digestPageCount"
            data-testid="digest-page-next"
            @click="digestPage += 1"
          >
            Next
          </button>
        </div>
      </section>

      <section class="panel" aria-label="Character scores">
        <div class="panel__head">
          <h2>Operational CharacterScore</h2>
          <input
            v-model="scoreFilter"
            class="admin-control"
            type="search"
            placeholder="Filter season, version, tier…"
            data-testid="score-filter"
          />
        </div>
        <div class="table-wrap">
          <table class="data-table" data-testid="score-table">
            <thead>
              <tr>
                <th>Season</th>
                <th>Version</th>
                <th>
                  <button type="button" class="th-btn" @click="toggleSort(scoreSortKey, scoreSortDir, 'composite')">
                    Composite
                  </button>
                </th>
                <th>P / U / S / E</th>
                <th>
                  <button type="button" class="th-btn" @click="toggleSort(scoreSortKey, scoreSortDir, 'confidence')">
                    Confidence
                  </button>
                </th>
                <th>
                  <button type="button" class="th-btn" @click="toggleSort(scoreSortKey, scoreSortDir, 'tier')">
                    Tier
                  </button>
                </th>
                <th>
                  <button type="button" class="th-btn" @click="toggleSort(scoreSortKey, scoreSortDir, 'calculatedAt')">
                    Calculated
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              <template v-for="row in filteredScores" :key="row.id">
                <tr class="clickable" @click="expandedScoreId = expandedScoreId === row.id ? null : row.id">
                  <td>{{ row.seasonSlug ?? "—" }}</td>
                  <td><code>{{ row.scoringVersion }}</code></td>
                  <td>{{ fmtNum(row.composite) }}</td>
                  <td class="dims">
                    {{ fmtNum(row.performance) }} /
                    {{ fmtNum(row.utility) }} /
                    {{ fmtNum(row.survival) }} /
                    {{ fmtNum(row.experience) }}
                  </td>
                  <td>{{ fmtNum(row.confidence, 3) }}</td>
                  <td>{{ row.tier ?? "—" }}</td>
                  <td>{{ fmtDate(row.calculatedAt) }}</td>
                </tr>
                <tr v-if="expandedScoreId === row.id" class="detail-row">
                  <td colspan="7">
                    <pre>{{ pretty({ dimensionDetails: row.dimensionDetails, selectedRuns: row.selectedRuns }) }}</pre>
                  </td>
                </tr>
              </template>
              <tr v-if="filteredScores.length === 0">
                <td colspan="7" class="muted">No operational scores.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel" aria-label="Published snapshots">
        <div class="panel__head">
          <h2>Published ScoreSnapshot history</h2>
          <input
            v-model="snapshotFilter"
            class="admin-control"
            type="search"
            placeholder="Filter grade, model, coverage…"
            data-testid="snapshot-filter"
          />
        </div>
        <div class="table-wrap">
          <table class="data-table" data-testid="snapshot-table">
            <thead>
              <tr>
                <th>Season</th>
                <th>Model</th>
                <th>
                  <button type="button" class="th-btn" @click="toggleSort(snapshotSortKey, snapshotSortDir, 'overallScore')">
                    Overall
                  </button>
                </th>
                <th>
                  <button type="button" class="th-btn" @click="toggleSort(snapshotSortKey, snapshotSortDir, 'grade')">
                    Grade
                  </button>
                </th>
                <th>
                  <button type="button" class="th-btn" @click="toggleSort(snapshotSortKey, snapshotSortDir, 'confidence')">
                    Confidence
                  </button>
                </th>
                <th>Publication</th>
                <th>
                  <button type="button" class="th-btn" @click="toggleSort(snapshotSortKey, snapshotSortDir, 'calculatedAt')">
                    Calculated
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              <template v-for="row in filteredSnapshots" :key="row.id">
                <tr class="clickable" @click="expandedSnapshotId = expandedSnapshotId === row.id ? null : row.id">
                  <td>{{ row.seasonSlug ?? "—" }}</td>
                  <td>
                    <code v-if="row.scoreModelKey">{{ row.scoreModelKey }}@{{ row.scoreModelVersion }}</code>
                    <span v-else>—</span>
                  </td>
                  <td>{{ fmtNum(row.overallScore) }}</td>
                  <td>{{ row.grade }}</td>
                  <td>{{ fmtNum(row.confidence, 3) }}</td>
                  <td>
                    {{ row.publicationStatus }}{{ row.isPublic ? "" : " (private)" }}
                    <span v-if="row.coverageState" class="muted"> · {{ row.coverageState }}</span>
                  </td>
                  <td>{{ fmtDate(row.calculatedAt) }}</td>
                </tr>
                <tr v-if="expandedSnapshotId === row.id" class="detail-row">
                  <td colspan="7">
                    <p v-if="row.rejectionReason" class="error">Rejection: {{ row.rejectionReason }}</p>
                    <pre>{{ pretty(row.explanation) }}</pre>
                  </td>
                </tr>
              </template>
              <tr v-if="filteredSnapshots.length === 0">
                <td colspan="7" class="muted">No published snapshots.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </section>
</template>

<style scoped>
.admin-char {
  display: grid;
  gap: var(--space-4);
}
.header__nav {
  margin-bottom: var(--space-2);
}
.header__identity {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--space-3);
  align-items: stretch;
}
.header__portrait {
  min-width: 0;
  min-height: 0;
}
.header__portrait :deep(.char-identity--portrait-only) {
  display: block;
  height: 100%;
  max-width: none;
}
.header__portrait :deep(.char-identity__portrait) {
  display: block;
  height: 100%;
  width: auto;
  aspect-ratio: 1;
  object-fit: cover;
}
.header__portrait :deep(.char-identity__portrait--empty) {
  width: auto !important;
  height: 100% !important;
  aspect-ratio: 1;
}
.header__meta {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
  min-width: 0;
}
.header__meta-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1 1 auto;
}
.header__meta h1 {
  margin: 0;
  font-size: var(--text-2xl);
}
.header__trust {
  margin: 0.35rem 0 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem 0.65rem;
  font-size: 1rem;
}
.header__score strong {
  font-variant-numeric: tabular-nums;
}
.header__links {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  flex: 0 0 auto;
  margin-left: auto;
  align-self: flex-start;
}
.pager {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  justify-content: flex-end;
}
.muted {
  color: var(--color-text-muted);
}
.error {
  color: var(--color-danger, #c44);
}
.panel {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md, 0.5rem);
  background: var(--color-surface);
}
.panel__head {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  align-items: center;
  flex-wrap: wrap;
}
.panel__head h2 {
  margin: 0;
  font-size: var(--text-lg);
}
.count {
  margin: 0;
  font-size: 0.85rem;
}
.admin-control {
  min-width: 14rem;
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm, 0.35rem);
  background: var(--color-bg, transparent);
  color: inherit;
  font: inherit;
}
.table-wrap {
  overflow-x: auto;
}
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}
.data-table th,
.data-table td {
  text-align: left;
  padding: 0.45rem 0.55rem;
  border-bottom: 1px solid var(--color-border);
  vertical-align: top;
}
.th-btn {
  appearance: none;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: 600;
  padding: 0;
  cursor: pointer;
}
.clickable {
  cursor: pointer;
}
.clickable:hover {
  background: rgb(127 127 127 / 8%);
}
.row--expanded {
  background: rgb(127 127 127 / 10%);
}
.detail-row td {
  background: rgb(0 0 0 / 4%);
}
.detail-grid {
  display: grid;
  gap: var(--space-3);
  grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
}
.detail-grid h3 {
  margin: 0 0 0.35rem;
  font-size: 0.95rem;
}
pre {
  margin: 0;
  max-height: 22rem;
  overflow: auto;
  padding: 0.65rem;
  border-radius: var(--radius-sm, 0.35rem);
  background: rgb(0 0 0 / 12%);
  font-size: 0.75rem;
  white-space: pre-wrap;
  word-break: break-word;
}
.ext {
  color: var(--color-link, #6af);
}
.dims {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.btn {
  appearance: none;
  border: 1px solid var(--color-border);
  background: transparent;
  color: inherit;
  font: inherit;
  padding: 0.35rem 0.7rem;
  border-radius: var(--radius-sm, 0.35rem);
  cursor: pointer;
  text-decoration: none;
}
.btn.ghost:hover {
  background: rgb(127 127 127 / 10%);
}
.skeletons {
  display: grid;
  gap: var(--space-3);
}
</style>
