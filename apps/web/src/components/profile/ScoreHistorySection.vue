<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { CharacterIdentityInput, ScoreSnapshotDTO } from "@mplus/contracts";
import { formatScore } from "../../lib/format";

const props = defineProps<{
  identity: CharacterIdentityInput;
  /** Test-only injection. When present, this component does not fetch. */
  snapshots?: ScoreSnapshotDTO[] | null;
  limit?: number;
}>();

const loading = ref(false);
const error = ref<string | null>(null);
const fetchedSnapshots = ref<ScoreSnapshotDTO[]>([]);

const effectiveSnapshots = computed<ScoreSnapshotDTO[]>(() => {
  return props.snapshots ?? fetchedSnapshots.value;
});

const points = computed(() => {
  const sorted = effectiveSnapshots.value
    .slice()
    .sort((a, b) => new Date(a.calculatedAt).getTime() - new Date(b.calculatedAt).getTime());

  return sorted.map((s) => {
    const rawTopLevel = (s as { scoreContext?: { rawScoreBeforeContext?: unknown } }).scoreContext
      ?.rawScoreBeforeContext;
    const rawFromExplanation = (
      s as {
        explanation?: { scoreContext?: { rawScoreBeforeContext?: unknown } } | null;
      }
    )?.explanation?.scoreContext?.rawScoreBeforeContext;
    const raw = typeof rawTopLevel === "number" && Number.isFinite(rawTopLevel)
      ? rawTopLevel
      : typeof rawFromExplanation === "number" && Number.isFinite(rawFromExplanation)
        ? rawFromExplanation
        : null;

    const adjusted = typeof s.overallScore === "number" && Number.isFinite(s.overallScore) ? s.overallScore : null;

    return {
      id: s.calculatedAt + "|" + s.seasonSlug + "|" + s.modelKey,
      calculatedAt: s.calculatedAt,
      seasonSlug: s.seasonSlug,
      adjusted,
      raw,
    };
  });
});

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Invalid date";
  return d.toLocaleString();
}

const activeIndex = ref<number | null>(null);
function setActive(idx: number | null): void {
  activeIndex.value = idx;
}

const plot = computed(() => {
  const N = points.value.length;
  const left = 44;
  const right = 16;
  const top = 20;
  const bottom = 34;
  const width = 600 - left - right;
  const height = 240 - top - bottom;
  const step = N <= 1 ? width : width / (N - 1);

  const xFor = (i: number): number => {
    if (N <= 1) return left + width / 2;
    return left + (i / (N - 1)) * width;
  };

  const yFor = (score: number): number => {
    const clamped = Math.max(0, Math.min(100, score));
    return top + height * (1 - clamped / 100);
  };

  const rawSegments: Array<{ from: number; to: number }> = [];
  let segStart: number | null = null;
  for (let i = 0; i < N; i++) {
    const ok = points.value[i]!.raw != null;
    if (ok && segStart == null) segStart = i;
    if ((!ok || i === N - 1) && segStart != null) {
      const end = !ok ? i - 1 : i;
      rawSegments.push({ from: segStart, to: end });
      segStart = null;
    }
  }

  const adjustedSegments: Array<{ from: number; to: number }> = [];
  let adjStart: number | null = null;
  for (let i = 0; i < N; i++) {
    const ok = points.value[i]!.adjusted != null;
    if (ok && adjStart == null) adjStart = i;
    if ((!ok || i === N - 1) && adjStart != null) {
      const end = !ok ? i - 1 : i;
      adjustedSegments.push({ from: adjStart, to: end });
      adjStart = null;
    }
  }

  const seasonBands: Array<{ from: number; to: number; seasonSlug: string }> = [];
  for (let i = 0; i < N; ) {
    const slug = points.value[i]!.seasonSlug;
    let j = i;
    while (j + 1 < N && points.value[j + 1]!.seasonSlug === slug) j++;
    seasonBands.push({ from: i, to: j, seasonSlug: slug });
    i = j + 1;
  }

  function seasonBandX(from: number): number {
    if (N <= 1) return left;
    return xFor(from) - step / 2;
  }

  function seasonBandWidth(from: number, to: number): number {
    if (N <= 1) return width;
    return Math.max(0, step * (to - from + 1));
  }

  return {
    left,
    width,
    height,
    top,
    bottom,
    xFor,
    yFor,
    rawSegments,
    adjustedSegments,
    seasonBands,
    seasonBandX,
    seasonBandWidth,
  };
});

function seasonBandColor(seasonSlug: string, bandIndex: number): string {
  const palette = [
    "rgba(245, 158, 11, 0.10)", // amber
    "rgba(96, 165, 250, 0.10)", // blue
    "rgba(167, 139, 250, 0.10)", // violet
    "rgba(34, 197, 94, 0.10)", // green
    "rgba(251, 113, 133, 0.10)", // rose
  ];
  const idx = bandIndex % palette.length;
  return palette[idx]!;
}

async function loadHistory(): Promise<void> {
  if (props.snapshots) return;
  loading.value = true;
  error.value = null;
  try {
    const apiBase = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";
    const { region, realmSlug, name } = props.identity;
    const limit = props.limit ?? 50;
    const url = `/api/v1/characters/${encodeURIComponent(region)}/${encodeURIComponent(realmSlug)}/${encodeURIComponent(name)}/history?limit=${encodeURIComponent(
      String(limit),
    )}`;
    const res = await fetch(`${apiBase}${url}`, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      throw new Error(body?.error?.message ?? `Score history request failed (${res.status})`);
    }
    const body = (await res.json()) as { snapshots?: ScoreSnapshotDTO[] | null };
    fetchedSnapshots.value = Array.isArray(body.snapshots) ? body.snapshots : [];
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Score history unavailable";
    fetchedSnapshots.value = [];
  } finally {
    loading.value = false;
  }
}

watch(
  () => [props.identity.region, props.identity.realmSlug, props.identity.name, props.snapshots] as const,
  () => {
    void loadHistory();
  },
  { immediate: true },
);
</script>

<template>
  <details class="score-history" data-testid="score-history-section">
    <summary class="score-history__summary">
      Score history
      <span class="score-history__count mpts-data">
        {{ points.length > 0 ? `${points.length} snapshot${points.length === 1 ? "" : "s"}` : "" }}
      </span>
    </summary>

    <div class="score-history__panel">
      <p v-if="loading" class="muted">Loading…</p>
      <p v-else-if="error" class="muted" role="status" aria-live="polite">
        {{ error }}
      </p>
      <p v-else-if="points.length === 0" class="muted">
        No score history available.
      </p>

      <div v-else class="score-history__chart">
        <div class="score-history__legend" aria-label="Score history series legend">
          <span class="legend-item">
            <span class="legend-dot legend-dot--raw" aria-hidden="true" />
            Raw score
          </span>
          <span class="legend-item">
            <span class="legend-dot legend-dot--adjusted" aria-hidden="true" />
            Adjusted / final score
          </span>
        </div>

        <div class="score-history__svg-wrap">
          <svg
            class="score-history__svg"
            viewBox="0 0 600 240"
            preserveAspectRatio="none"
            role="img"
            aria-label="Line chart of score history"
          >
            <g>
              <rect
                v-for="(band, index) in plot.seasonBands"
                :key="band.from + '-' + band.to + '-' + band.seasonSlug"
                :x="plot.seasonBandX(band.from)"
                :width="plot.seasonBandWidth(band.from, band.to)"
                :y="plot.top"
                :height="plot.height"
                :fill="seasonBandColor(band.seasonSlug, index)"
              />
            </g>

            <g>
              <path
                v-for="(seg, idx) in plot.adjustedSegments"
                :key="`adj-${idx}`"
                class="score-history__line score-history__line--adjusted"
                :d="
                  (() => {
                    const xs: number[] = [];
                    for (let i = seg.from; i <= seg.to; i++) xs.push(plot.xFor(i));
                    const ys = xs.map((_, i) => plot.yFor(points[seg.from + i]!.adjusted!));
                    const start = `M ${xs[0]} ${ys[0]}`;
                    const rest = xs.slice(1).map((x, i) => `L ${x} ${ys[i + 1]}`).join(' ');
                    return start + (rest ? ' ' + rest : '');
                  })()
                "
              />
            </g>

            <g>
              <path
                v-for="(seg, idx) in plot.rawSegments"
                :key="`raw-${idx}`"
                class="score-history__line score-history__line--raw"
                :d="
                  (() => {
                    const xs: number[] = [];
                    for (let i = seg.from; i <= seg.to; i++) xs.push(plot.xFor(i));
                    const ys = xs.map((_, i) => plot.yFor(points[seg.from + i]!.raw!));
                    const start = `M ${xs[0]} ${ys[0]}`;
                    const rest = xs.slice(1).map((x, i) => `L ${x} ${ys[i + 1]}`).join(' ');
                    return start + (rest ? ' ' + rest : '');
                  })()
                "
              />
            </g>

            <g>
              <g
                v-for="(p, i) in points"
                :key="p.id"
              >
                <circle
                  v-if="p.adjusted != null"
                  :cx="plot.xFor(i)"
                  :cy="plot.yFor(p.adjusted)"
                  r="4"
                  class="score-history__point score-history__point--adjusted"
                  tabindex="0"
                  role="button"
                  :aria-label="`Adjusted score ${p.adjusted} on ${p.seasonSlug} at ${p.calculatedAt}`"
                  @mouseenter="setActive(i)"
                  @focus="setActive(i)"
                  @mouseleave="setActive(null)"
                  @blur="setActive(null)"
                />
                <circle
                  v-if="p.raw != null"
                  :cx="plot.xFor(i)"
                  :cy="plot.yFor(p.raw)"
                  r="3"
                  class="score-history__point score-history__point--raw"
                  tabindex="0"
                  role="button"
                  :aria-label="`Raw score ${p.raw} on ${p.seasonSlug} at ${p.calculatedAt}`"
                  @mouseenter="setActive(i)"
                  @focus="setActive(i)"
                  @mouseleave="setActive(null)"
                  @blur="setActive(null)"
                />
              </g>
            </g>
          </svg>

          <div
            v-if="activeIndex != null"
            class="score-history__tooltip"
            role="status"
            aria-live="polite"
          >
            <div class="tooltip-row">
              <strong>Calculated</strong> {{ formatDateTime(points[activeIndex]!.calculatedAt) }}
            </div>
            <div class="tooltip-row">
              <strong>Raw</strong>
              {{ points[activeIndex]!.raw != null ? formatScore(points[activeIndex]!.raw!, 1) : "Unavailable" }}
            </div>
            <div class="tooltip-row">
              <strong>Adjusted</strong>
              {{
                points[activeIndex]!.adjusted != null
                  ? formatScore(points[activeIndex]!.adjusted!, 1)
                  : "Unavailable"
              }}
            </div>
            <div class="tooltip-row">
              <strong>Season</strong> {{ points[activeIndex]!.seasonSlug }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </details>
</template>

<style scoped>
.score-history {
  display: grid;
  gap: var(--space-2);
}

.score-history__summary {
  cursor: pointer;
  font-family: var(--font-data);
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  user-select: none;
}

.score-history__count {
  margin-left: var(--space-2);
}

.score-history__panel {
  display: grid;
  gap: var(--space-3);
}

.muted {
  margin: 0;
  color: var(--color-text-muted);
}

.score-history__legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  font-size: var(--text-xs);
  font-weight: 700;
  color: var(--color-text-muted);
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.legend-dot {
  width: 0.65rem;
  height: 0.65rem;
  border-radius: 999px;
  display: inline-block;
}

.legend-dot--raw {
  background: rgba(148, 163, 184, 0.9);
}

.legend-dot--adjusted {
  background: rgba(245, 158, 11, 0.95);
}

.score-history__svg-wrap {
  position: relative;
  padding: var(--space-2) 0;
}

.score-history__svg {
  width: 100%;
  height: auto;
  display: block;
}

.score-history__line {
  fill: none;
  stroke-width: 2;
}

.score-history__line--adjusted {
  stroke: rgba(245, 158, 11, 0.95);
}

.score-history__line--raw {
  stroke: rgba(148, 163, 184, 0.9);
  stroke-dasharray: 4 3;
}

.score-history__point {
  outline: none;
}

.score-history__point--adjusted {
  fill: rgba(245, 158, 11, 0.95);
}

.score-history__point--raw {
  fill: rgba(148, 163, 184, 0.9);
}

.score-history__tooltip {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  margin: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  background: rgb(0 0 0 / 35%);
  border-radius: var(--radius-sm);
  color: white;
  font-size: var(--text-xs);
  display: grid;
  gap: 0.25rem;
  pointer-events: none;
}

.tooltip-row strong {
  margin-right: 0.35rem;
}
</style>

