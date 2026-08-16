<script setup lang="ts">
import { computed } from "vue";
import type { RunTimelineEventPublicDTO } from "@mplus/contracts";
import SpellWowIcon from "../ability-catalog/SpellWowIcon.vue";
import WowIcon from "../ability-catalog/WowIcon.vue";
import DimensionAxisIcon from "../charts/DimensionAxisIcon.vue";
import DeathGlyphIcon from "../charts/DeathGlyphIcon.vue";
import { classIconName } from "../../lib/wowIcons";
import { classColor } from "../../lib/wowClass";
import { isCooldownTimelineEvent, isDeathTimelineEvent } from "../../lib/cooldownTimeline";

const props = defineProps<{
  event: RunTimelineEventPublicDTO;
}>();

const death = computed(() => (isDeathTimelineEvent(props.event) ? props.event : null));
const cooldown = computed(() => (isCooldownTimelineEvent(props.event) ? props.event : null));

const showTarget = computed(() => {
  const event = cooldown.value;
  if (!event) return false;
  const target = event.target;
  if (!target) return false;
  if (target.kind === "SELF") return true;
  return Boolean(target.name || target.portraitUrl);
});

function formatAxis(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const ICON_PX = 52;
</script>

<template>
  <article
    class="event"
    :data-testid="death ? 'cooldown-event-DEATH' : `cooldown-event-${cooldown?.dimension}`"
  >
    <template v-if="death">
      <span class="event__dim event__dim--death" aria-label="Death">
        <DeathGlyphIcon />
      </span>
      <span class="event__spell event__spell--class">
        <WowIcon
          v-if="classIconName(death.classSlug)"
          :icon-name="classIconName(death.classSlug)"
          :alt="death.classSlug ?? ''"
          :width="ICON_PX"
          :height="ICON_PX"
        />
      </span>
      <div class="event__body">
        <span class="event__name">
          <span :style="death.classSlug ? { color: classColor(death.classSlug) } : undefined">{{
            death.playerName
          }}</span>
          <span class="event__died"> died</span>
        </span>
        <span class="event__time mpts-data">{{ formatAxis(death.timestampMs) }}</span>
      </div>
    </template>
    <template v-else-if="cooldown">
      <span class="event__dim" :aria-label="cooldown.dimension">
        <DimensionAxisIcon :dimension="cooldown.dimension" layout="fill" />
      </span>
      <SpellWowIcon
        class="event__spell"
        :icon-name="cooldown.iconName"
        :spell-id="cooldown.abilityId"
        :alt="cooldown.abilityName ?? ''"
        :width="ICON_PX"
        :height="ICON_PX"
      />
      <div class="event__body">
        <span class="event__name">{{ cooldown.abilityName ?? "Ability" }}</span>
        <span class="event__time mpts-data">{{ formatAxis(cooldown.timestampMs) }}</span>
        <span v-if="cooldown.type" class="event__type">{{ cooldown.type }}</span>
      </div>
    </template>
    <div v-if="showTarget && cooldown?.target" class="event__target" data-testid="cooldown-event-target">
      <span v-if="cooldown.target.kind === 'SELF'" class="target-self">Self</span>
      <span
        v-else-if="cooldown.target.kind === 'FRIENDLY_PLAYER'"
        class="target-player"
        :data-class-slug="cooldown.target.classSlug ?? undefined"
      >
        <WowIcon
          v-if="classIconName(cooldown.target.classSlug)"
          :icon-name="classIconName(cooldown.target.classSlug)"
          :alt="cooldown.target.classSlug ?? ''"
          :width="18"
          :height="18"
        />
        <span class="target-player__name" :style="{ color: classColor(cooldown.target.classSlug) }">{{
          cooldown.target.name
        }}</span>
      </span>
      <span
        v-else-if="cooldown.target.kind === 'HOSTILE'"
        class="target-hostile"
        :title="cooldown.target.name ?? undefined"
        :aria-label="cooldown.target.name ?? 'Hostile target'"
      >
        <img
          v-if="cooldown.target.portraitUrl"
          class="target-hostile__portrait"
          :src="cooldown.target.portraitUrl"
          :alt="cooldown.target.name ?? ''"
          width="28"
          height="28"
          loading="lazy"
        />
        <span v-else class="target-hostile__name">{{ cooldown.target.name }}</span>
      </span>
      <span v-else-if="cooldown.target.name" class="target-other">{{ cooldown.target.name }}</span>
    </div>
  </article>
</template>

<style scoped>
.event {
  --cooldown-event-icon-size: 52px;
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr) auto;
  gap: var(--space-2);
  align-items: center;
  min-width: 0;
  margin-bottom: var(--space-2);
}

.event:last-child {
  margin-bottom: 0;
}

.event__time {
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  color: var(--color-text-muted);
}

.event__dim {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  flex: 0 0 26px;
  border-radius: 50%;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text-muted);
}

.event__dim--death {
  color: var(--color-danger-500);
  border-color: color-mix(in srgb, var(--color-danger-500) 45%, var(--color-border));
}

.event__dim :deep(.dim-icon),
.event__dim :deep(.death-icon) {
  width: 14px;
  height: 14px;
}

.event__spell {
  width: var(--cooldown-event-icon-size);
  height: var(--cooldown-event-icon-size);
  flex: 0 0 var(--cooldown-event-icon-size);
}

.event__spell--class {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.event__spell :deep(img) {
  width: var(--cooldown-event-icon-size);
  height: var(--cooldown-event-icon-size);
  object-fit: cover;
  border-radius: var(--radius-control);
}

.event__body {
  display: grid;
  gap: 0.1rem;
  min-width: 0;
}

.event__name {
  overflow-wrap: anywhere;
  font-size: var(--text-sm);
}

.event__died,
.event__type {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

.event__type {
  text-transform: capitalize;
}

.event__target {
  justify-self: end;
  min-width: 0;
}

.target-self {
  display: inline-flex;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  padding: 0.12rem 0.45rem;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

.target-player {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  min-width: 0;
}

.target-player__name {
  overflow-wrap: anywhere;
  font-size: var(--text-xs);
}

.target-hostile,
.target-other {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

.target-hostile__portrait {
  width: 28px;
  height: 28px;
  object-fit: cover;
  border-radius: var(--radius-control);
}

@media (max-width: 40rem) {
  .event {
    grid-template-columns: auto auto minmax(0, 1fr);
  }

  .event__target {
    grid-column: 3;
    justify-self: start;
  }
}
</style>
