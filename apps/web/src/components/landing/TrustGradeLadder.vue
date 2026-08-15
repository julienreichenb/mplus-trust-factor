<script setup lang="ts">
import TrustTierBadge from "./TrustTierBadge.vue";
import { TRUST_GRADES, trustGradeTip } from "../../lib/trustGradeScale";
</script>

<template>
  <div class="ranks__row" role="list" data-testid="trust-grade-ladder">
    <template v-for="(rank, index) in TRUST_GRADES" :key="rank">
      <div class="ranks__item" role="listitem" tabindex="0">
        <TrustTierBadge :tier="rank" size="xl" letter-only flush />
        <span class="ranks__tip" role="tooltip">{{ trustGradeTip(rank) }}</span>
      </div>
      <span v-if="index < TRUST_GRADES.length - 1" class="ranks__separator" aria-hidden="true">
        <span v-if="rank === 'D'" class="ranks__pipe">|</span>
        <svg v-else viewBox="0 0 16 16" width="20" height="20" focusable="false">
          <path
            d="M6 3.5 11 8 6 12.5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </span>
    </template>
  </div>
</template>

<style scoped>
.ranks__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: var(--space-3) var(--space-4);
}

.ranks__item {
  position: relative;
  display: grid;
  place-items: center;
  outline: none;
  cursor: default;
}

.ranks__item :deep(.tier-badge) {
  transition: transform var(--duration-default) ease;
}

.ranks__item:hover :deep(.tier-badge),
.ranks__item:focus-visible :deep(.tier-badge) {
  transform: scale(1.08) translateY(-3px);
}

.ranks__separator {
  display: grid;
  place-items: center;
  color: var(--color-text-muted);
  opacity: 0.55;
}

.ranks__pipe {
  font-family: var(--font-data);
  font-size: var(--text-xl);
  font-weight: 300;
  line-height: 1;
}

.ranks__tip {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 0.5rem);
  z-index: 4;
  width: max-content;
  max-width: min(18rem, 80vw);
  padding: 0.55rem 0.7rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-surface-hover);
  color: var(--color-text);
  font-size: var(--text-xs);
  line-height: 1.4;
  text-align: center;
  box-shadow: 0 8px 24px rgb(0 0 0 / 35%);
  transform: translateX(-50%) translateY(6px);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition:
    opacity var(--duration-default) ease,
    transform var(--duration-default) ease,
    visibility var(--duration-default);
}

.ranks__item:hover .ranks__tip,
.ranks__item:focus-visible .ranks__tip {
  opacity: 1;
  visibility: visible;
  transform: translateX(-50%) translateY(0);
}

@media (prefers-reduced-motion: reduce) {
  .ranks__item :deep(.tier-badge) {
    transition: none;
  }

  .ranks__item:hover :deep(.tier-badge),
  .ranks__item:focus-visible :deep(.tier-badge) {
    transform: none;
  }

  .ranks__tip {
    transition: opacity 120ms ease;
    transform: translateX(-50%);
  }

  .ranks__item:hover .ranks__tip,
  .ranks__item:focus-visible .ranks__tip {
    transform: translateX(-50%);
  }
}
</style>
