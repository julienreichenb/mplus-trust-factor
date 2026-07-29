<script setup lang="ts">
import { computed, ref } from "vue";
import type { CharacterProfileView } from "../../api/types";
import {
  parseContributorSignals,
  topSignals,
} from "../../lib/characterViewModel";
import KeySignalRow from "./KeySignalRow.vue";
import HeroGearPanel from "./HeroGearPanel.vue";
import HeroTalentPanel from "./HeroTalentPanel.vue";

type PanelId = "signals" | "gear" | "talents";

const props = defineProps<{
  profile: CharacterProfileView;
}>();

const openPanel = ref<PanelId>("signals");
const copyState = ref<"idle" | "copied" | "failed">("idle");
let copyResetTimer: ReturnType<typeof setTimeout> | null = null;

const signals = computed(() =>
  props.profile.score?.dimensions ? parseContributorSignals(props.profile.score.dimensions) : [],
);
const positives = computed(() => topSignals(signals.value, "positive", 5));
const risks = computed(() => topSignals(signals.value, "risk", 5));
const detailsLocked = computed(() => !(props.profile.entitlements?.detailsUnlocked ?? true));
const loadoutCode = computed(() => props.profile.talents?.loadoutCode?.trim() || null);

const gearItemLevel = computed(() => {
  const fromProfile = props.profile.itemLevel;
  if (typeof fromProfile === "number" && Number.isFinite(fromProfile) && fromProfile > 0) {
    return Math.round(fromProfile);
  }
  const equipped = props.profile.equipment?.equippedItemLevel;
  if (typeof equipped === "number" && Number.isFinite(equipped) && equipped > 0) {
    return Math.round(equipped);
  }
  const average = props.profile.equipment?.averageItemLevel;
  if (typeof average === "number" && Number.isFinite(average) && average > 0) {
    return Math.round(average);
  }
  // Last resort while snapshot lacks Blizzard equipped ilvl: average near-peak pieces only
  // (drops legacy/base outliers that previously dragged the title to ~274).
  const itemIlvls = (props.profile.equipment?.items ?? props.profile.equipment?.keyItems ?? [])
    .map((item) => item.itemLevel)
    .filter((ilvl): ilvl is number => typeof ilvl === "number" && Number.isFinite(ilvl) && ilvl > 0);
  if (itemIlvls.length === 0) return null;
  const peak = Math.max(...itemIlvls);
  const nearPeak = itemIlvls.filter((ilvl) => ilvl >= peak - 40);
  const pool = nearPeak.length > 0 ? nearPeak : itemIlvls;
  return Math.round(pool.reduce((sum, ilvl) => sum + ilvl, 0) / pool.length);
});

const panels = computed(() => [
  { id: "signals" as const, title: "Key signals" },
  {
    id: "gear" as const,
    title:
      gearItemLevel.value != null
        ? `Character gear · ${gearItemLevel.value} ilvl`
        : "Character gear",
  },
  { id: "talents" as const, title: "Specialization" },
]);

function open(id: PanelId): void {
  openPanel.value = id;
}

function isOpen(id: PanelId): boolean {
  return openPanel.value === id;
}

async function copyLoadout(): Promise<void> {
  const code = loadoutCode.value;
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    copyState.value = "copied";
  } catch {
    copyState.value = "failed";
  }
  if (copyResetTimer) clearTimeout(copyResetTimer);
  copyResetTimer = setTimeout(() => {
    copyState.value = "idle";
  }, 2000);
}
</script>

<template>
  <div class="insight-accordion" data-testid="insight-accordion">
    <div
      v-for="panel in panels"
      :key="panel.id"
      class="insight-accordion__item"
      :data-open="isOpen(panel.id) ? 'true' : 'false'"
    >
      <h2 class="insight-accordion__heading">
        <button
          type="button"
          class="insight-accordion__trigger"
          :id="`insight-${panel.id}-trigger`"
          :aria-expanded="isOpen(panel.id)"
          :aria-controls="`insight-${panel.id}-panel`"
          @click="open(panel.id)"
        >
          <span>{{ panel.title }}</span>
        </button>
        <button
          v-if="panel.id === 'talents' && loadoutCode"
          type="button"
          class="insight-accordion__copy"
          :aria-label="copyState === 'copied' ? 'Copied loadout' : 'Copy loadout'"
          @click.stop="copyLoadout"
        >
          <svg
            v-if="copyState !== 'copied'"
            viewBox="0 0 16 16"
            width="12"
            height="12"
            aria-hidden="true"
            focusable="false"
          >
            <rect
              x="5"
              y="5"
              width="8"
              height="8"
              rx="1.5"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            />
            <path
              d="M3 10.5V3.5A1.5 1.5 0 0 1 4.5 2H10"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
            />
          </svg>
          <svg
            v-else
            viewBox="0 0 16 16"
            width="12"
            height="12"
            aria-hidden="true"
            focusable="false"
          >
            <path
              d="M3.5 8.5 6.5 11.5 12.5 4.5"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <span>{{
            copyState === "copied" ? "Copied" : copyState === "failed" ? "Failed" : "Copy"
          }}</span>
        </button>
      </h2>

      <div
        v-show="isOpen(panel.id)"
        :id="`insight-${panel.id}-panel`"
        class="insight-accordion__panel"
        role="region"
        :aria-labelledby="`insight-${panel.id}-trigger`"
      >
        <div v-if="panel.id === 'signals'" class="key-signals" aria-label="Top signals">
          <section class="key-signals__col" aria-labelledby="key-signals-strengths">
            <h3 id="key-signals-strengths" class="key-signals__title">Strengths</h3>
            <ul v-if="positives.length" class="key-signals__list">
              <KeySignalRow
                v-for="(item, index) in positives"
                :key="`p-${index}`"
                :signal="item"
              />
            </ul>
            <p v-else class="empty">No standout strengths in this snapshot</p>
          </section>
          <section class="key-signals__col" aria-labelledby="key-signals-weaknesses">
            <h3 id="key-signals-weaknesses" class="key-signals__title">Weaknesses</h3>
            <ul v-if="risks.length" class="key-signals__list">
              <KeySignalRow
                v-for="(item, index) in risks"
                :key="`r-${index}`"
                :signal="item"
              />
            </ul>
            <p v-else class="empty">No standout weaknesses in this snapshot</p>
          </section>
        </div>

        <HeroGearPanel
          v-else-if="panel.id === 'gear'"
          :equipment="profile.equipment"
          :locked="detailsLocked"
        />

        <HeroTalentPanel
          v-else
          :talents="profile.talents"
          :locked="detailsLocked"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.insight-accordion {
  display: grid;
  gap: 0;
  max-width: 42rem;
  border-top: 1px solid rgb(255 255 255 / 12%);
}

.insight-accordion__item {
  border-bottom: 1px solid rgb(255 255 255 / 10%);
}

.insight-accordion__heading {
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.insight-accordion__trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) 0;
  border: 0;
  background: transparent;
  color: var(--color-text-muted);
  font-family: var(--font-data);
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  text-align: left;
  cursor: pointer;
}

.insight-accordion__trigger::before {
  content: "";
  width: 0.4rem;
  height: 0.4rem;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: rotate(-45deg);
  transition: transform var(--duration-fast);
  flex-shrink: 0;
}

.insight-accordion__item[data-open="true"] .insight-accordion__trigger {
  color: var(--color-gold-300);
}

.insight-accordion__item[data-open="true"] .insight-accordion__trigger::before {
  transform: rotate(45deg);
}

.insight-accordion__trigger:hover,
.insight-accordion__trigger:focus-visible {
  color: var(--color-gold-300);
  outline: none;
}

.insight-accordion__copy {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  flex-shrink: 0;
  margin: 0;
  padding: 0.2rem 0.4rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--color-text-muted);
  font-family: var(--font-data);
  font-size: 0.65rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  line-height: 1;
  cursor: pointer;
}

.insight-accordion__copy:hover,
.insight-accordion__copy:focus-visible {
  color: var(--color-gold-300);
  border-color: var(--color-gold-300);
  outline: none;
}

.insight-accordion__panel {
  padding: 0 0 var(--space-3);
}

.key-signals {
  display: grid;
  gap: var(--space-4);
}

.key-signals__col {
  min-width: 0;
}

.key-signals__title {
  margin: 0 0 var(--space-2);
  font-family: var(--font-data);
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.key-signals__list {
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-1);
}

.empty {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

@media (min-width: 768px) {
  .key-signals {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
