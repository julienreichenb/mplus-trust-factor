<script setup lang="ts">
import { computed, ref } from "vue";
import type { RunTimelineEventPublicDTO, RunCooldownTimelinePublicDTO } from "@mplus/contracts";
import DimensionAxisIcon from "../charts/DimensionAxisIcon.vue";
import DeathGlyphIcon from "../charts/DeathGlyphIcon.vue";
import CooldownReplayEventRow from "./CooldownReplayEventRow.vue";
import {
  COOLDOWN_TIMELINE_EMPTY_COPY,
  COOLDOWN_TIMELINE_UNAVAILABLE_COPY,
  groupCooldownTimelineBlocks,
  isDeathTimelineEvent,
  uniqueBossJumpChips,
  type CooldownTimelineDimension,
} from "../../lib/cooldownTimeline";

const props = defineProps<{
  timeline?: RunCooldownTimelinePublicDTO | null;
}>();

const enabled = ref<Record<CooldownTimelineDimension, boolean>>({
  PERFORMANCE: true,
  UTILITY: true,
  SURVIVAL: true,
  DEATH: true,
});

const status = computed(() => props.timeline?.status ?? "UNAVAILABLE");
const persistedEvents = computed(() => props.timeline?.events ?? []);
const segments = computed(() => props.timeline?.segments ?? []);
const duration = computed(() => {
  const value = props.timeline?.durationMs;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  return null;
});
const truncated = computed(() => props.timeline?.truncated === true);

function toggle(dim: CooldownTimelineDimension): void {
  enabled.value = { ...enabled.value, [dim]: !enabled.value[dim] };
}

function formatAxis(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function dimensionLabel(dim: CooldownTimelineDimension): string {
  if (dim === "PERFORMANCE") return "Performance";
  if (dim === "UTILITY") return "Utility";
  if (dim === "DEATH") return "Deaths";
  return "Survival";
}

const visibleEvents = computed(() =>
  persistedEvents.value.filter((event) =>
    isDeathTimelineEvent(event) ? enabled.value.DEATH : enabled.value[event.dimension],
  ),
);

const deathCount = computed(
  () => persistedEvents.value.filter((event) => isDeathTimelineEvent(event)).length,
);

const blocks = computed(() => groupCooldownTimelineBlocks(visibleEvents.value, segments.value));
const bossChips = computed(() => uniqueBossJumpChips(segments.value));

const lanes: Array<{ dim: Exclude<CooldownTimelineDimension, "DEATH">; code: "P" | "U" | "S" }> = [
  { dim: "PERFORMANCE", code: "P" },
  { dim: "UTILITY", code: "U" },
  { dim: "SURVIVAL", code: "S" },
];

function eventKey(event: RunTimelineEventPublicDTO, index: number): string {
  if (isDeathTimelineEvent(event)) {
    return `DEATH-${event.timestampMs}-${event.playerName}-${index}`;
  }
  return `${event.dimension}-${event.timestampMs}-${event.abilityId ?? "x"}-${index}`;
}

function pullLabel(segment: { index: number; bossName?: string | null }): string {
  return segment.bossName ? `Pull ${segment.index} · ${segment.bossName}` : `Pull ${segment.index}`;
}

function pullTone(index: number): "neutral" | "rank" {
  return index % 2 === 1 ? "neutral" : "rank";
}

const failedPortraits = ref(new Set<string>());

function showBossPortrait(url: string | null | undefined): boolean {
  return typeof url === "string" && url.length > 0 && !failedPortraits.value.has(url);
}

function markPortraitFailed(url: string): void {
  const next = new Set(failedPortraits.value);
  next.add(url);
  failedPortraits.value = next;
}

function scrollToPull(segmentIndex: number): void {
  const node = document.querySelector(`[data-testid="cooldown-pull-${segmentIndex}"]`);
  if (node instanceof HTMLElement) {
    node.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}
</script>

<template>
  <section class="replay" data-testid="run-cooldown-timeline" aria-labelledby="cooldown-title">
    <h3 id="cooldown-title">Cooldown replay</h3>
    <div class="toolbar">
      <div class="filters" role="group" aria-label="Cooldown replay filters">
        <button
          v-for="lane in lanes"
          :key="lane.dim"
          type="button"
          class="chip"
          :data-testid="`cooldown-filter-${lane.code}`"
          :aria-pressed="enabled[lane.dim]"
          :aria-label="dimensionLabel(lane.dim)"
          @click="toggle(lane.dim)"
        >
          <DimensionAxisIcon :dimension="lane.dim" layout="fill" />
          {{ dimensionLabel(lane.dim) }}
        </button>
        <button
          type="button"
          class="chip"
          data-testid="cooldown-filter-D"
          :aria-pressed="enabled.DEATH"
          :aria-label="`Deaths ${deathCount}`"
          @click="toggle('DEATH')"
        >
          <DeathGlyphIcon />
          Deaths
          <span class="mpts-data">{{ deathCount }}</span>
        </button>
      </div>
      <div v-if="bossChips.length > 0" class="jumps" role="group" aria-label="Scroll to boss">
        <span class="jumps__label">Scroll to…</span>
        <button
          v-for="boss in bossChips"
          :key="boss.name"
          type="button"
          class="chip chip--boss"
          :data-testid="`cooldown-boss-chip-${boss.segmentIndex}`"
          :aria-label="`Scroll to ${boss.name}`"
          @click="scrollToPull(boss.segmentIndex)"
        >
          {{ boss.name }}
        </button>
      </div>
    </div>

    <p
      v-if="status === 'UNAVAILABLE'"
      class="muted"
      data-testid="cooldown-timeline-empty"
    >
      {{ COOLDOWN_TIMELINE_UNAVAILABLE_COPY }}
    </p>
    <p
      v-else-if="status === 'EMPTY'"
      class="muted"
      data-testid="cooldown-timeline-empty-tracked"
    >
      {{ COOLDOWN_TIMELINE_EMPTY_COPY }}
    </p>
    <p
      v-else-if="truncated"
      class="muted"
      data-testid="cooldown-timeline-truncated"
    >
      Cooldown replay is truncated; later events are omitted.
    </p>

    <ol
      v-if="(status === 'AVAILABLE' || status === 'EMPTY') && duration != null"
      class="axis"
      data-testid="cooldown-vertical-axis"
    >
      <li class="axis__end">Start — {{ formatAxis(0) }}</li>
      <template v-for="(block, blockIndex) in blocks" :key="`${block.kind}-${blockIndex}`">
        <li
          v-if="block.kind === 'between' && block.events.length > 0"
          class="between"
          data-testid="cooldown-between-pulls"
        >
          <p class="between__label">
            Between pulls
            <span v-if="block.gapMs != null && block.gapMs > 0"> · {{ formatAxis(block.gapMs) }}</span>
          </p>
          <CooldownReplayEventRow
            v-for="(event, index) in block.events"
            :key="eventKey(event, index)"
            :event="event"
          />
        </li>
        <li
          v-else-if="block.kind === 'pull' && block.events.length > 0"
          class="pull"
          :data-testid="`cooldown-pull-${block.segment.index}`"
          :data-tone="pullTone(block.segment.index)"
        >
          <p class="pull__label">
            <img
              v-if="showBossPortrait(block.segment.bossPortraitUrl)"
              class="pull__portrait"
              :src="block.segment.bossPortraitUrl!"
              alt=""
              width="28"
              height="28"
              loading="lazy"
              data-testid="cooldown-boss-portrait"
              @error="markPortraitFailed(block.segment.bossPortraitUrl!)"
            />
            {{ pullLabel(block.segment) }}
          </p>
          <CooldownReplayEventRow
            v-for="(event, index) in block.events"
            :key="eventKey(event, index)"
            :event="event"
          />
        </li>
      </template>
      <li class="axis__end">End — {{ formatAxis(duration) }}</li>
    </ol>
  </section>
</template>

<style scoped>
.replay {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  height: 100%;
}

.replay h3 {
  margin: 0;
}

.toolbar {
  position: sticky;
  top: 0;
  z-index: 1;
  display: grid;
  gap: var(--space-2);
  background: var(--color-surface);
  padding-bottom: var(--space-1);
}

.filters,
.jumps {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.jumps__label {
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}

.chip {
  cursor: pointer;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: transparent;
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  padding: 0.2rem 0.55rem;
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}

.chip :deep(.dim-icon),
.chip :deep(.death-icon) {
  width: 0.85rem;
  height: 0.85rem;
}

.chip[aria-pressed="true"] {
  border-color: var(--color-gold-300);
  color: var(--color-text);
}

.chip--boss {
  border-style: dashed;
}

.muted {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.axis {
  list-style: none;
  margin: 0;
  padding: 0 0.4rem 0 0.85rem;
  border-left: 2px solid var(--color-border);
  display: grid;
  gap: var(--space-3);
  min-width: 0;
  min-height: 0;
  flex: 1 1 auto;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgb(var(--color-rank-rgb) / 70%) transparent;
}

.axis::-webkit-scrollbar {
  width: 6px;
}

.axis::-webkit-scrollbar-track {
  background: transparent;
}

.axis::-webkit-scrollbar-thumb {
  background: rgb(var(--color-rank-rgb) / 70%);
  border-radius: 999px;
}

.axis__end {
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}

.between__label {
  margin: 0 0 var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}

.pull {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  margin-left: calc(-0.85rem - 2px);
  padding: var(--space-2) var(--space-2) var(--space-2) 0.85rem;
  border-radius: 0.4rem;
}

.pull__label {
  position: sticky;
  top: 0;
  z-index: 2;
  align-self: flex-end;
  margin: 0 0 var(--space-2);
  width: fit-content;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 0.2rem 0.55rem;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  background: var(--color-surface);
}

.pull__portrait {
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  object-fit: cover;
  border-radius: var(--radius-control);
}

.pull[data-tone="neutral"] {
  background: var(--color-surface);
}

.pull[data-tone="rank"] {
  background: rgb(var(--color-rank-rgb) / 6%);
}
</style>
