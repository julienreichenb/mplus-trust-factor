<script setup lang="ts">
const principles = [
  {
    title: "Explainable",
    body: "Tiers map to scored dimensions with visible rationale, not opaque rankings.",
  },
  {
    title: "Multi-dimensional",
    body: "No single metric decides trust — performance, consistency and evidence quality all contribute.",
  },
  {
    title: "Versioned",
    body: "Scores carry a model key and version so results remain comparable over time.",
  },
  {
    title: "Freshness-aware",
    body: "Source timestamps and refresh state stay attached to the result.",
  },
  {
    title: "Confidence-aware",
    body: "Incomplete or thin evidence is surfaced instead of silently overconfident tiers.",
  },
] as const;

const providers = [
  {
    name: "Blizzard APIs",
    logo: "/logos/blizzard.svg",
    logoAlt: "Blizzard Entertainment",
    href: "https://worldofwarcraft.blizzard.com/en-us/",
    status: "Implemented in the API layer",
    note: "Character, equipment and related profile signals when the live mode is configured.",
  },
  {
    name: "Raider.IO",
    logo: "/logos/raiderio.svg",
    logoAlt: "Raider.IO",
    href: "https://raider.io/",
    status: "Used when attributed",
    note: "Public Mythic+ context with required attribution on character results.",
  },
  {
    name: "Warcraft Logs",
    logo: "/logos/warcraftlogs.png",
    logoAlt: "Warcraft Logs",
    href: "https://www.warcraftlogs.com/",
    status: "Used when available",
    note: "Performance signals when visibility and data allow.",
  },
] as const;
</script>

<template>
  <section id="methodology" class="methodology" aria-labelledby="methodology-title">
    <header class="methodology__header">
      <p class="eyebrow">Methodology</p>
      <h2 id="methodology-title">Transparent by design</h2>
      <p>
        M+ Trust Factor is an evidence panel for high-key screening. Live character pages expose score,
        confidence, freshness and source attribution from the current API contracts.
      </p>
    </header>

    <div class="methodology__panel">
      <ul class="principles">
        <li v-for="item in principles" :key="item.title">
          <h3>{{ item.title }}</h3>
          <p>{{ item.body }}</p>
        </li>
      </ul>
    </div>

    <div class="sources" aria-labelledby="sources-heading">
      <h3 id="sources-heading">Data providers</h3>
      <ul>
        <li v-for="provider in providers" :key="provider.name">
          <div class="sources__head">
            <a
              class="sources__link"
              :href="provider.href"
              target="_blank"
              rel="noopener noreferrer"
              :aria-label="`Open ${provider.logoAlt}`"
            >
              <img
                class="sources__logo"
                :src="provider.logo"
                :alt="provider.logoAlt"
                width="160"
                height="32"
                loading="lazy"
                decoding="async"
              />
            </a>
            <span class="sources__status">{{ provider.status }}</span>
          </div>
          <p>{{ provider.note }}</p>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.methodology {
  display: grid;
  gap: var(--space-8);
}

.methodology__header {
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

.methodology__header h2 {
  margin: 0 0 var(--space-3);
}

.methodology__header p:not(.eyebrow) {
  margin: 0;
  color: var(--color-text-muted);
}

.methodology__panel {
  display: grid;
  gap: var(--space-5);
  padding: var(--space-6);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-surface);
}

.principles {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-4);
}

.principles h3 {
  margin: 0 0 var(--space-1);
  color: var(--color-text);
}

.principles p {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.sources h3 {
  margin: 0 0 var(--space-4);
}

.sources ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-4);
}

.sources li {
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--color-border);
}

.sources li:last-child {
  padding-bottom: 0;
  border-bottom: none;
}

.sources__head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  align-items: center;
  margin-bottom: var(--space-2);
}

.sources__link {
  display: inline-flex;
  align-items: center;
  text-decoration: none;
}

.sources__link:hover .sources__logo,
.sources__link:focus-visible .sources__logo {
  opacity: 0.9;
}

.sources__logo {
  display: block;
  height: 1.75rem;
  width: auto;
  max-width: 11rem;
  object-fit: contain;
  object-position: left center;
}

.sources__status {
  font-family: var(--font-data);
  font-size: var(--text-xs);
  color: var(--color-brand);
}

.sources p {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

@media (min-width: 768px) {
  .principles {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-5) var(--space-6);
  }

  .sources ul {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-5);
  }

  .sources li {
    padding-bottom: 0;
    border-bottom: none;
  }
}

@media (min-width: 1024px) {
  .principles {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
