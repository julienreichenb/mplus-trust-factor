<script setup lang="ts">
defineProps<{
  title: string;
  titleId?: string;
  testId?: string;
}>();
</script>

<template>
  <details class="profile-fold" :data-testid="testId">
    <summary class="profile-fold__summary">
      <span :id="titleId" class="profile-section-title profile-fold__title">{{ title }}</span>
      <span class="profile-fold__meta">
        <slot name="meta" />
      </span>
    </summary>
    <div class="profile-fold__body">
      <slot />
    </div>
  </details>
</template>

<style scoped>
.profile-fold {
  min-width: 0;
}

.profile-fold__summary {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) 0;
  cursor: pointer;
  user-select: none;
}

.profile-fold__summary::-webkit-details-marker {
  display: none;
}

.profile-fold__summary::before {
  content: "";
  flex: 0 0 auto;
  width: 0.45rem;
  height: 0.45rem;
  margin-top: 0.15rem;
  border-right: 1.75px solid var(--color-gold-300);
  border-bottom: 1.75px solid var(--color-gold-300);
  transform: rotate(-45deg);
  transition: transform var(--duration-fast);
}

.profile-fold[open] > .profile-fold__summary::before {
  transform: rotate(45deg);
}

.profile-fold__meta {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.profile-fold__meta :slotted(.profile-fold__tag) {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.35rem;
  padding: 0.2rem 0.55rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: rgb(255 255 255 / 5%);
  font-family: var(--font-data);
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  line-height: 1.3;
}

.profile-fold__meta :slotted(.profile-fold__tag[data-tone="high"]) {
  border-color: color-mix(in srgb, var(--color-danger-500) 55%, var(--color-border));
  background: color-mix(in srgb, var(--color-danger-500) 16%, transparent);
  color: var(--color-danger-500);
}

.profile-fold__meta :slotted(.profile-fold__tag[data-tone="elevated"]) {
  border-color: color-mix(in srgb, var(--color-amber-500) 55%, var(--color-border));
  background: color-mix(in srgb, var(--color-amber-500) 14%, transparent);
  color: var(--color-amber-400);
}

.profile-fold__meta :slotted(.profile-fold__tag[data-tone="low"]) {
  border-color: color-mix(in srgb, var(--color-success-500) 40%, var(--color-border));
  color: var(--color-success-500);
}

.profile-fold__body {
  display: grid;
  gap: var(--space-3);
  padding: 0 0 var(--space-4);
}

@media (prefers-reduced-motion: reduce) {
  .profile-fold__summary::before {
    transition: none;
  }
}
</style>
