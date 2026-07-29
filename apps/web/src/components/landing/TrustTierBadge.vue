<script setup lang="ts">
import { computed } from "vue";
import type { Grade } from "../../api/types";
import { presentGrade } from "../../lib/characterViewModel";
import TierGradeLetter from "../brand/TierGradeLetter.vue";

const props = withDefaults(
  defineProps<{
    tier?: Grade | null;
    label?: string;
    size?: "sm" | "md" | "lg" | "xl";
    variant?: "default" | "hero";
    /** Show only the tier letter (no title/interpretation meta). */
    letterOnly?: boolean;
    /** No chrome (border / padding / background) — for dense headers. */
    flush?: boolean;
  }>(),
  {
    tier: "A",
    label: undefined,
    size: "md",
    variant: "default",
    letterOnly: false,
    flush: false,
  },
);

const presentation = computed(() => presentGrade(props.tier));
const letterSize = computed(() => (props.variant === "hero" ? "lg" : props.size));
const letterSurface = computed(() => (props.variant === "hero" ? "ghost" : "panel"));
</script>

<template>
  <div
    v-if="variant === 'hero'"
    class="tier-badge tier-badge--hero"
    :data-tier="presentation.letter ?? 'none'"
    :data-unrated="presentation.isUnrated ? 'true' : 'false'"
    role="img"
    :aria-label="`${presentation.title}: ${label || presentation.interpretation}`"
  >
    <div class="tier-badge__grade-stack">
      <span class="tier-badge__title">{{ presentation.title }}</span>
      <TierGradeLetter :tier="tier" :size="letterSize" :surface="letterSurface" />
    </div>
    <span class="tier-badge__label tier-badge__label--hero">{{ label || presentation.interpretation }}</span>
    <div v-if="$slots.trailing" class="tier-badge__trailing">
      <slot name="trailing" />
    </div>
  </div>
  <div
    v-else
    class="tier-badge"
    :class="{ 'tier-badge--with-trailing': !!$slots.trailing }"
    :data-tier="presentation.letter ?? 'none'"
    :data-unrated="presentation.isUnrated ? 'true' : 'false'"
    :data-size="size"
    :data-flush="flush ? 'true' : 'false'"
    role="img"
    :aria-label="`${presentation.title}: ${label || presentation.interpretation}`"
  >
    <TierGradeLetter :tier="tier" :size="letterSize" :surface="letterSurface" />
    <span v-if="!letterOnly" class="tier-badge__meta">
      <span class="tier-badge__title">{{ presentation.title }}</span>
      <span class="tier-badge__label">{{ label || presentation.interpretation }}</span>
    </span>
    <div v-if="$slots.trailing" class="tier-badge__trailing">
      <slot name="trailing" />
    </div>
  </div>
</template>

<style scoped>
.tier-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-card);
  border: 1px solid var(--color-border);
  background: var(--color-obsidian-900);
}

.tier-badge--with-trailing {
  width: 100%;
}

.tier-badge__trailing {
  margin-left: auto;
  flex-shrink: 0;
}

.tier-badge__meta {
  display: grid;
  gap: 0.1rem;
}

.tier-badge__title {
  font-family: var(--font-data);
  font-size: var(--text-xs);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.tier-badge__label {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text);
}

.tier-badge[data-size="xl"] .tier-badge__title {
  font-size: var(--text-sm);
}

.tier-badge[data-size="xl"] .tier-badge__label {
  font-size: var(--text-base);
}

.tier-badge[data-flush="true"] {
  padding: 0;
  border: none;
  background: transparent;
  border-radius: 0;
}

.tier-badge[data-size="sm"] {
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
}

.tier-badge--hero {
  width: 100%;
  align-items: center;
  gap: var(--space-3);
  padding: 0;
  border: none;
  background: transparent;
}

.tier-badge--hero .tier-badge__grade-stack {
  display: grid;
  gap: 0.15rem;
  align-items: center;
  flex-shrink: 0;
}

.tier-badge--hero .tier-badge__title {
  text-align: center;
  line-height: 1.1;
}

.tier-badge--hero .tier-badge__label--hero {
  flex: 1;
  min-width: 0;
  font-size: var(--text-xs);
  line-height: 1.35;
}

.tier-badge--hero .tier-badge__trailing {
  margin-left: 0;
}
</style>
