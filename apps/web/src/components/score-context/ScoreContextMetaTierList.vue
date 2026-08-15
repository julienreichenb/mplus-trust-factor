<script setup lang="ts">
import { computed, ref } from "vue";
import WowIcon from "../ability-catalog/WowIcon.vue";
import { CLASS_COLORS, contrastingTextColor } from "../../lib/wowClass";
import { specIconName } from "../../lib/wowIcons";
import { formatContextFactor, tierFactorValue } from "../../lib/scoreContextFormat";

export type MetaTier = 1 | 2 | 3 | 4 | 5;

export interface SpecTile {
  classSlug: string;
  className: string;
  specSlug: string;
  specName: string;
}

const TIER_COPY: Record<MetaTier, { title: string; subtitle: string }> = {
  5: { title: "Tier 5", subtitle: "Top meta" },
  4: { title: "Tier 4", subtitle: "Strong" },
  3: { title: "Tier 3", subtitle: "Average" },
  2: { title: "Tier 2", subtitle: "Below meta" },
  1: { title: "Tier 1", subtitle: "Niche / weak" },
};

const props = defineProps<{
  classes: Array<{
    slug: string;
    name: string;
    specs: Array<{ slug: string; name: string; role: string }>;
  }>;
  assignments: Array<{ classSlug: string; specSlug: string; tier: MetaTier }>;
  tierFactors: Record<MetaTier, number>;
  readOnly: boolean;
}>();

const emit = defineEmits<{
  "move-spec": [classSlug: string, specSlug: string, tier: MetaTier | null];
  "update-tier-factor": [tier: MetaTier, factor: number];
}>();

const hoverTarget = ref<MetaTier | "unassigned" | null>(null);
const draggingKey = ref<string | null>(null);

const allSpecs = computed<SpecTile[]>(() =>
  props.classes.flatMap((cls) =>
    cls.specs.map((spec) => ({
      classSlug: cls.slug,
      className: cls.name,
      specSlug: spec.slug,
      specName: spec.name,
    })),
  ),
);

function specKey(classSlug: string, specSlug: string): string {
  return `${classSlug}:${specSlug}`;
}

function assignedTier(classSlug: string, specSlug: string): MetaTier | null {
  const hit = props.assignments.find((a) => a.classSlug === classSlug && a.specSlug === specSlug);
  return hit ? hit.tier : null;
}

function specsIn(tier: MetaTier | null): SpecTile[] {
  return allSpecs.value.filter((spec) => assignedTier(spec.classSlug, spec.specSlug) === tier);
}

const showUnassigned = computed(() => !props.readOnly || specsIn(null).length > 0);

function iconFor(spec: SpecTile): string | null {
  return specIconName(spec.classSlug, spec.specSlug);
}

function onDragStart(event: DragEvent, spec: SpecTile): void {
  if (props.readOnly) {
    event.preventDefault();
    return;
  }
  draggingKey.value = specKey(spec.classSlug, spec.specSlug);
  event.dataTransfer?.setData("text/plain", draggingKey.value);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
}

function onDrop(tier: MetaTier | null): void {
  const key = draggingKey.value;
  draggingKey.value = null;
  hoverTarget.value = null;
  if (!key || props.readOnly) return;
  const [classSlug, specSlug] = key.split(":");
  if (!classSlug || !specSlug) return;
  emit("move-spec", classSlug, specSlug, tier);
}

function setHover(target: MetaTier | "unassigned" | null): void {
  if (props.readOnly) return;
  hoverTarget.value = target;
}

function tileStyle(spec: SpecTile): { backgroundColor: string; color: string; borderColor: string } {
  const backgroundColor = CLASS_COLORS[spec.classSlug.toLowerCase()] ?? "#3a3a40";
  return {
    backgroundColor,
    color: contrastingTextColor(backgroundColor),
    borderColor: backgroundColor,
  };
}
</script>

<template>
  <div class="meta-tab" data-testid="meta-tab-panel">
    <div
      v-for="tier in ([5, 4, 3, 2, 1] as const)"
      :key="tier"
      class="tier-row"
      :class="{ 'tier-row--hover': !readOnly && hoverTarget === tier }"
      :data-testid="`meta-tier-${tier}`"
      @dragover.prevent="setHover(tier)"
      @dragleave="hoverTarget === tier && setHover(null)"
      @drop.prevent="onDrop(tier)"
    >
      <div class="tier-row__label">
        <strong>{{ TIER_COPY[tier].title }}</strong>
        <span class="muted">{{ TIER_COPY[tier].subtitle }}</span>
      </div>
      <div class="tier-row__pool" :data-testid="`meta-tier-pool-${tier}`">
        <div
          v-for="spec in specsIn(tier)"
          :key="specKey(spec.classSlug, spec.specSlug)"
          class="spec-tile"
          :class="{
            'spec-tile--dragging': draggingKey === specKey(spec.classSlug, spec.specSlug),
            'spec-tile--readonly': readOnly,
          }"
          :style="tileStyle(spec)"
          :draggable="!readOnly"
          :title="`${spec.specName}\n${spec.className}`"
          :data-testid="`spec-${spec.classSlug}-${spec.specSlug}`"
          @dragstart="onDragStart($event, spec)"
          @dragend="draggingKey = null"
        >
          <WowIcon :icon-name="iconFor(spec)" :alt="spec.specName" :width="28" :height="28" :lazy="false" />
          <span class="spec-tile__name">{{ spec.specName }}</span>
        </div>
      </div>
      <div class="tier-row__factor" :data-testid="`tier-factor-wrap-${tier}`">
        <span v-if="readOnly" class="factor-value" :data-testid="`tier-factor-${tier}`">
          {{ formatContextFactor(tierFactorValue(tierFactors, tier)) }}
        </span>
        <label v-else>
          <span class="muted">Factor ×</span>
          <input
            :value="tierFactorValue(tierFactors, tier)"
            type="number"
            min="0.01"
            step="0.01"
            :data-testid="`tier-factor-${tier}`"
            @change="emit('update-tier-factor', tier, Number(($event.target as HTMLInputElement).value))"
          />
        </label>
      </div>
    </div>

    <div
      v-if="showUnassigned"
      class="tier-row tier-row--unassigned"
      :class="{ 'tier-row--hover': !readOnly && hoverTarget === 'unassigned' }"
      data-testid="meta-unassigned"
      @dragover.prevent="setHover('unassigned')"
      @dragleave="hoverTarget === 'unassigned' && setHover(null)"
      @drop.prevent="onDrop(null)"
    >
      <div class="tier-row__label">
        <strong>Unassigned</strong>
        <span class="muted">Not configured · ×1.00</span>
      </div>
      <div class="tier-row__pool" data-testid="meta-unassigned-pool">
        <div
          v-for="spec in specsIn(null)"
          :key="specKey(spec.classSlug, spec.specSlug)"
          class="spec-tile"
          :class="{ 'spec-tile--readonly': readOnly }"
          :style="tileStyle(spec)"
          :draggable="!readOnly"
          :title="`${spec.specName}\n${spec.className}`"
          :data-testid="`spec-${spec.classSlug}-${spec.specSlug}`"
          @dragstart="onDragStart($event, spec)"
          @dragend="draggingKey = null"
        >
          <WowIcon :icon-name="iconFor(spec)" :alt="spec.specName" :width="28" :height="28" :lazy="false" />
          <span class="spec-tile__name">{{ spec.specName }}</span>
        </div>
      </div>
      <div class="tier-row__factor muted" aria-hidden="true"></div>
    </div>
  </div>
</template>

<style scoped>
.meta-tab {
  display: grid;
  gap: 0.55rem;
}
.tier-row {
  display: grid;
  grid-template-columns: 8.5rem minmax(0, 1fr) 8.5rem;
  gap: 0.65rem;
  align-items: stretch;
  min-height: 4.25rem;
  padding: 0.55rem 0.65rem;
  border: 1px solid rgb(255 255 255 / 12%);
  border-radius: 0.4rem;
  background: rgb(255 255 255 / 3%);
}
.tier-row--unassigned {
  border-style: dashed;
  background: transparent;
}
.tier-row--hover {
  border-color: #1f6feb;
  background: rgb(31 111 235 / 12%);
}
.tier-row__label {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 0.15rem;
}
.tier-row__pool {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  align-content: flex-start;
  min-height: 2.6rem;
}
.tier-row__factor {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.3rem;
  justify-self: end;
}
.tier-row__factor input {
  width: 4.75rem;
}
.factor-value {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.spec-tile {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.2rem 0.45rem 0.2rem 0.2rem;
  border: 1px solid transparent;
  border-radius: 0.35rem;
  cursor: grab;
  max-width: 9.5rem;
}
.spec-tile--readonly {
  cursor: default;
}
.spec-tile--dragging {
  opacity: 0.55;
}
.spec-tile__name {
  font-size: 0.78rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.muted {
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}
@media (max-width: 720px) {
  .tier-row {
    grid-template-columns: 1fr;
  }
  .tier-row__factor {
    justify-content: flex-start;
  }
}
</style>
