<script setup lang="ts">
type FeatureIcon = "shield" | "search" | "solo" | "balance";

interface Feature {
  icon: FeatureIcon;
  title: string;
  body: string;
}

const features: Feature[] = [
  {
    icon: "shield",
    title: "Send keys with less stress",
    body: "Screen invites before you commit — cut deplete risk and stop gambling your key on a guess.",
  },
  {
    icon: "search",
    title: "One check, not five tabs",
    body: "Skip the Raider.IO / WCL / Armory hop. See who they are and how they play in one place.",
  },
  {
    icon: "solo",
    title: "Solo queue with fewer surprises",
    body: "Spot suspect profiles early and join groups that look solid — not just filled.",
  },
  {
    icon: "balance",
    title: "Look past inflated FOTM scores",
    body: "Call out boosted and meta-padded ratings — and give off-meta classes a fair shot.",
  },
];
</script>

<template>
  <section id="features" class="features" aria-labelledby="features-title">
    <header class="features__header">
      <p class="eyebrow">Built for serious M+ players</p>
      <h2 id="features-title">Why players use M+ Trust Factor</h2>
      <p>
        Know who you're running with before the key starts — fewer depletions, cleaner picks.
      </p>
    </header>

    <ul class="features__grid">
      <li v-for="feature in features" :key="feature.title">
        <span class="features__icon-shell">
          <span class="features__icon" aria-hidden="true">
            <svg
              v-if="feature.icon === 'shield'"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linejoin="round"
            >
              <path d="M12 3 20 7v6c0 4.4-3.2 7.4-8 9-4.8-1.6-8-4.6-8-9V7l8-4z" />
              <path d="M9 12l2 2 4-4" stroke-linecap="round" />
            </svg>
            <svg
              v-else-if="feature.icon === 'search'"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="M16 16l5 5" />
            </svg>
            <svg
              v-else-if="feature.icon === 'solo'"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="12" cy="8" r="3.2" />
              <path d="M5.5 19.5c1.2-3.2 3.5-4.8 6.5-4.8s5.3 1.6 6.5 4.8" />
            </svg>
            <svg
              v-else-if="feature.icon === 'balance'"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M12 3v17M5 20h14" />
              <path d="M12 6H6.5L4 12h5l-2.5-6M12 6h5.5L20 12h-5l2.5-6" />
            </svg>
          </span>
        </span>
        <div class="features__content">
          <h3>{{ feature.title }}</h3>
          <p>{{ feature.body }}</p>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.features {
  display: grid;
  gap: var(--space-8);
}

.features__header {
  max-width: var(--container-reading);
}

.eyebrow {
  margin: 0;
  font-family: var(--font-data);
  font-size: var(--text-xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-gold-300);
}

.features__header h2 {
  margin: 0 0 var(--space-3);
}

.features__header p:not(.eyebrow) {
  margin: 0;
  color: var(--color-text-muted);
}

.features__grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-5);
}

.features__grid li {
  display: flex;
  align-items: flex-start;
  gap: var(--space-4);
}

.features__icon-shell {
  flex: 0 0 auto;
  display: flex;
  align-items: flex-start;
}

.features__icon {
  display: grid;
  place-items: center;
  width: 3.5rem;
  height: 3.5rem;
  flex-shrink: 0;
  clip-path: polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%);
  background: var(--color-iron-800);
  border: 1px solid currentColor;
  color: var(--color-gold-300);
}

.features__icon svg {
  width: 2rem;
  height: 2rem;
}

.features__content {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: var(--space-2);
  padding: var(--space-1) 0;
}

.features__grid h3 {
  margin: 0;
  font-size: var(--text-base);
}

.features__grid p {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  max-width: 28rem;
}

@media (min-width: 768px) {
  .features__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-5) var(--space-8);
  }
}
</style>
