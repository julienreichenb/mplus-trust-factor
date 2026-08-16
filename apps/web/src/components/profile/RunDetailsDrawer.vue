<script setup lang="ts">
import { computed } from "vue";
import { sanitizeWarcraftLogsUrl } from "../../lib/warcraftLogsUrl";
import type { Grade } from "../../api/types";
import { gradeThemeCssVars } from "../../lib/gradeTheme";
import type { RunCooldownTimelinePublicDTO } from "@mplus/contracts";
import CooldownReplayTimeline from "./CooldownReplayTimeline.vue";

export interface RunDrawerModel {
  dungeonName: string;
  dungeonSlug: string;
  keyLevel: number | null;
  completedAt: string | null;
  identity?: "PRIMARY" | "SECONDARY" | null;
  wclUrl?: string | null;
  cooldownTimeline?: RunCooldownTimelinePublicDTO | null;
}

const props = defineProps<{
  open: boolean;
  run: RunDrawerModel | null;
  grade?: Grade | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

const publicUrl = computed(() => sanitizeWarcraftLogsUrl(props.run?.wclUrl ?? null));
const rankThemeStyle = computed(() => gradeThemeCssVars(props.grade));

function formatWhen(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open && run" class="drawer-root" data-testid="run-details-drawer" :style="rankThemeStyle">
      <button
        type="button"
        class="drawer-root__backdrop"
        aria-label="Close run details"
        @click="emit('close')"
      />
      <aside class="drawer" role="dialog" aria-modal="true" :aria-label="run.dungeonName">
        <header class="drawer__head">
          <div>
            <div class="drawer__title">
              <h2>{{ run.dungeonName }}</h2>
              <span class="drawer__key mpts-data">+{{ run.keyLevel ?? "—" }}</span>
            </div>
            <p class="drawer__meta mpts-data">
              <span v-if="run.identity" class="chip">{{ run.identity }}</span>
              <span class="chip">{{ formatWhen(run.completedAt) }}</span>
              <a
                v-if="publicUrl"
                class="chip drawer__link"
                :href="publicUrl"
                target="_blank"
                rel="noopener noreferrer"
              >Warcraft Logs ↗</a>
              <span v-else class="chip">No Warcraft Logs report</span>
            </p>
          </div>
          <button
            type="button"
            class="drawer__close"
            data-testid="run-drawer-close"
            @click="emit('close')"
          >
            Close
          </button>
        </header>
        <CooldownReplayTimeline :timeline="run.cooldownTimeline ?? null" />
      </aside>
    </div>
  </Teleport>
</template>

<style scoped>
.drawer-root {
  position: fixed;
  inset: 0;
  z-index: 70;
}

.drawer-root__backdrop {
  position: absolute;
  inset: 0;
  border: 0;
  background: rgb(0 0 0 / 45%);
  cursor: pointer;
}

.drawer {
  position: absolute;
  top: 0;
  right: 0;
  height: 100%;
  width: min(40vw, 32rem);
  max-width: 95vw;
  overflow: hidden;
  background: var(--color-surface);
  border-left: 1px solid var(--color-border);
  padding: var(--space-4);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  align-content: stretch;
  gap: var(--space-4);
}

@media (max-width: 900px) {
  .drawer {
    width: min(70vw, 28rem);
  }
}

@media (max-width: 640px) {
  .drawer {
    width: 95vw;
  }
}

.drawer__head {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  align-items: flex-start;
}

.drawer h2,
.drawer h3 {
  margin: 0;
}

.drawer__title {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2);
}

.drawer__key {
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--color-text-muted);
}

.drawer__meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: var(--space-1) 0 0;
  align-items: center;
}

.chip {
  display: inline-flex;
  padding: 0.15rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  font-size: var(--text-xs);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.drawer__close {
  appearance: none;
  border: 0;
  background: transparent;
  padding: 0;
  color: var(--color-gold-300);
  font: inherit;
  font-size: var(--text-sm);
  text-decoration: underline;
  text-underline-offset: 0.15em;
  cursor: pointer;
}

.drawer__close:hover,
.drawer__close:focus-visible {
  color: var(--color-brand-hover);
}

a.drawer__link {
  color: var(--color-gold-300);
  text-decoration: none;
  text-transform: none;
  letter-spacing: 0;
}
</style>
