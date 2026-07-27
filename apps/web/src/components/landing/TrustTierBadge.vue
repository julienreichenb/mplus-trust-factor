<script setup lang="ts">
withDefaults(
  defineProps<{
    tier?: "S" | "A" | "B" | "C" | "D";
    label?: string;
    size?: "sm" | "md" | "lg";
  }>(),
  {
    tier: "A",
    label: "Strong trust profile",
    size: "md",
  },
);

const tierNames: Record<string, string> = {
  S: "Elite confidence",
  A: "Strong confidence",
  B: "Credible",
  C: "Situational",
  D: "Insufficient evidence",
};
</script>

<template>
  <div
    class="tier-badge"
    :data-tier="tier"
    :data-size="size"
    role="img"
    :aria-label="`Tier ${tier}: ${label || tierNames[tier]}`"
  >
    <span class="tier-badge__letter" aria-hidden="true">{{ tier }}</span>
    <span class="tier-badge__meta">
      <span class="tier-badge__title">Tier {{ tier }}</span>
      <span class="tier-badge__label">{{ label || tierNames[tier] }}</span>
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
  color: var(--color-tier-a);
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
