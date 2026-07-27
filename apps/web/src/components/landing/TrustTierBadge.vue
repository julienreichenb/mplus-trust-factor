<script setup lang="ts">
import { computed } from "vue";
import type { Grade } from "../../api/types";
import { presentGrade } from "../../lib/characterViewModel";

const props = withDefaults(
  defineProps<{
    tier?: Grade | null;
    label?: string;
    size?: "sm" | "md" | "lg";
  }>(),
  {
    tier: "A",
    label: undefined,
    size: "md",
  },
);

const presentation = computed(() => presentGrade(props.tier));
</script>

<template>
  <div
    class="tier-badge"
    :data-tier="presentation.letter ?? 'none'"
    :data-unrated="presentation.isUnrated ? 'true' : 'false'"
    :data-size="size"
    role="img"
    :aria-label="`${presentation.title}: ${label || presentation.interpretation}`"
  >
    <span class="tier-badge__letter" aria-hidden="true">{{ presentation.letter ?? "—" }}</span>
    <span class="tier-badge__meta">
      <span class="tier-badge__title">{{ presentation.title }}</span>
      <span class="tier-badge__label">{{ label || presentation.interpretation }}</span>
    </span>
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

.tier-badge__letter {
  display: grid;
  place-items: center;
  width: 2.5rem;
  height: 2.5rem;
  clip-path: polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%);
  font-family: var(--font-display);
  font-weight: 700;
  font-size: var(--text-xl);
  background: var(--color-iron-800);
  border: 1px solid currentColor;
  color: var(--color-text-muted);
}

.tier-badge[data-tier="S"] .tier-badge__letter {
  color: var(--color-tier-s);
  box-shadow: var(--shadow-brand-glow);
}

.tier-badge[data-tier="A"] .tier-badge__letter {
  color: var(--color-tier-a);
}

.tier-badge[data-tier="B"] .tier-badge__letter {
  color: var(--color-tier-b);
}

.tier-badge[data-tier="C"] .tier-badge__letter {
  color: var(--color-tier-c);
}

.tier-badge[data-tier="D"] .tier-badge__letter {
  color: var(--color-tier-d);
}

.tier-badge[data-tier="U"] .tier-badge__letter,
.tier-badge[data-unrated="true"] .tier-badge__letter {
  clip-path: none;
  border-radius: var(--radius-control);
  color: var(--color-info-500);
  border-style: dashed;
  box-shadow: none;
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

.tier-badge[data-size="lg"] .tier-badge__letter {
  width: 3.25rem;
  height: 3.25rem;
  font-size: var(--text-2xl);
}

.tier-badge[data-size="sm"] {
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
}

.tier-badge[data-size="sm"] .tier-badge__letter {
  width: 2rem;
  height: 2rem;
  font-size: var(--text-base);
}
</style>
