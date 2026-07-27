<script setup lang="ts">
import { computed } from "vue";
import type { WclDataState, WclVisibilityState } from "@mplus/contracts";
import type { CharacterProfileView } from "../../api/types";
import { humanizeProvider } from "../../lib/characterViewModel";

const props = defineProps<{
  profile: CharacterProfileView;
}>();

const expectedProviders = ["BLIZZARD", "RAIDER_IO", "WARCRAFT_LOGS"] as const;

function normalizeProviderKey(provider: string): string {
  const compact = provider.trim().toLowerCase().replace(/[_-]+/g, "");
  if (compact === "blizzard") return "BLIZZARD";
  if (compact === "raiderio") return "RAIDER_IO";
  if (compact === "warcraftlogs") return "WARCRAFT_LOGS";
  return provider.toUpperCase();
}

const sourceMap = computed(() => {
  const map = new Map<
    string,
    { provider: string; fetchedAt: string; url: string | null; contributedToScore?: boolean }
  >();
  for (const source of props.profile.sources ?? []) {
    map.set(normalizeProviderKey(source.provider), {
      ...source,
      provider: normalizeProviderKey(source.provider),
    });
  }
  return map;
});

const stateMap = computed(() => {
  const map = new Map<string, NonNullable<CharacterProfileView["providerStates"]>[number]>();
  for (const state of props.profile.providerStates ?? []) {
    map.set(normalizeProviderKey(String(state.provider)), state);
  }
  return map;
});

const rows = computed(() =>
  expectedProviders.map((provider) => {
    const found = sourceMap.value.get(provider);
    const lifecycle = stateMap.value.get(provider);
    const contributed =
      found?.contributedToScore === true || lifecycle?.contributedToScore === true;
    let statusLabel = found ? "Present in snapshot" : "Not in snapshot";
    const dataState = lifecycle?.wclDataState ?? props.profile.wclDataState ?? null;
    if (lifecycle?.wclVisibility === "HIDDEN" || props.profile.wclVisibility === "HIDDEN") {
      statusLabel = "Hidden on Warcraft Logs";
    } else if (dataState === "NO_MATCHED_RUN") {
      statusLabel = "Public profile — no combat logs matched to selected runs";
    } else if (dataState === "RANKINGS_ONLY") {
      statusLabel = "Public rankings contributed; detailed combat analysis unavailable";
    } else if (lifecycle?.state === "RATE_LIMITED" || dataState === "RATE_LIMITED") {
      statusLabel = "Rate limited";
    } else if ((lifecycle?.state === "UNAVAILABLE" || dataState === "UNAVAILABLE") && !found) {
      statusLabel = "Unavailable";
    } else if (contributed) {
      const types = lifecycle?.contributionTypes?.length
        ? ` · ${lifecycle.contributionTypes.join("+").toLowerCase()}`
        : "";
      statusLabel = `Present · contributed to score${types}`;
    }
    return {
      provider,
      label: humanizeProvider(provider),
      present: Boolean(found || lifecycle),
      fetchedAt: found?.fetchedAt ?? lifecycle?.fetchedAt ?? null,
      url: found?.url ?? lifecycle?.sourceUrl ?? null,
      statusLabel,
    };
  }),
);

const wclLabel = computed(() => wclStatusLabel(props.profile.wclVisibility, props.profile.wclDataState));

function wclStatusLabel(
  visibility: WclVisibilityState | null | undefined,
  dataState?: WclDataState | null,
): string {
  if (visibility === "HIDDEN") return "Character hidden on Warcraft Logs";
  if (visibility === "PUBLIC" && dataState === "NO_MATCHED_RUN") {
    return "Public profile — no combat logs matched to selected runs";
  }
  if (visibility === "PUBLIC" && dataState === "RANKINGS_ONLY") {
    return "Public rankings contributed; detailed combat analysis unavailable";
  }
  if (visibility === "PUBLIC" && dataState === "MATCHED_COMBAT_LOGS") {
    return "Public logs available";
  }
  if (visibility === "PUBLIC") return "Public Warcraft Logs profile";
  switch (dataState) {
    case "NO_PUBLIC_LOGS":
      return "No public Warcraft Logs reports";
    case "UNAVAILABLE":
      return "Warcraft Logs unavailable";
    case "RATE_LIMITED":
      return "Warcraft Logs rate limited";
    default:
      return "Warcraft Logs visibility not reported";
  }
}
</script>

<template>
  <section class="provenance" aria-labelledby="provenance-title" data-testid="data-provenance">
    <h2 id="provenance-title">Data confidence & freshness</h2>
    <p class="lede">
      Provider presence, refresh state and visibility are shown separately from the trust grade so a
      missing source is not mistaken for a weak player.
    </p>

    <dl class="status-grid">
      <div>
        <dt>Refresh state</dt>
        <dd>{{ profile.refreshStatus }}</dd>
      </div>
      <div>
        <dt>Warcraft Logs</dt>
        <dd>
          {{ wclLabel }}
        </dd>
      </div>
      <div>
        <dt>Season sample</dt>
        <dd class="mpts-data">
          {{
            profile.seasonSummary
              ? `${profile.seasonSummary.runCount} runs · rating ${profile.seasonSummary.mythicRating ?? "—"}`
              : "Unavailable"
          }}
        </dd>
      </div>
    </dl>

    <ul class="sources">
      <li v-for="row in rows" :key="row.provider" :data-present="row.present ? 'true' : 'false'">
        <div class="sources__head">
          <strong>{{ row.label }}</strong>
          <span class="sources__status">{{ row.statusLabel }}</span>
        </div>
        <p v-if="row.fetchedAt" class="sources__meta mpts-data">
          Fetched {{ new Date(row.fetchedAt).toLocaleString() }}
          <template v-if="row.url">
            ·
            <a :href="row.url" target="_blank" rel="noopener noreferrer">Open source profile</a>
          </template>
        </p>
        <p v-else class="sources__meta">No fetch timestamp in this response.</p>
      </li>
    </ul>

    <footer class="sources-footer" aria-labelledby="sources-title">
      <h3 id="sources-title" class="sr-only">Sources & model</h3>
      <p v-if="profile.raiderIoUsed" class="rio" data-testid="raiderio-attribution">
        Includes data from
        <a href="https://raider.io" rel="noopener noreferrer" target="_blank">Raider.IO</a>
        where noted above. Attribution required for public Raider.IO usage.
      </p>
      <p class="model">
        Model {{ profile.score?.modelKey ?? "—" }} v{{ profile.score?.modelVersion ?? "—" }}
        <span v-if="profile.score?.calculatedAt">
          · calculated {{ new Date(profile.score.calculatedAt).toLocaleString() }}
        </span>
      </p>
    </footer>
  </section>
</template>

<style scoped>
.provenance {
  display: grid;
  gap: var(--space-4);
}

.provenance h2 {
  margin: 0;
}

.lede,
.sources__meta,
.rio,
.model {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.status-grid {
  display: grid;
  gap: var(--space-3);
  margin: 0;
  grid-template-columns: 1fr;
}

.status-grid dt {
  font-size: var(--text-xs);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.status-grid dd {
  margin: var(--space-1) 0 0;
  font-weight: 600;
  color: var(--color-text);
}

.sources {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-2);
}

.sources li {
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-surface);
}

.sources li[data-present="false"] {
  border-style: dashed;
  background: transparent;
}

.sources__head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  align-items: baseline;
  justify-content: space-between;
}

.sources__status {
  font-family: var(--font-data);
  font-size: var(--text-xs);
  color: var(--color-gold-300);
}

.sources li[data-present="false"] .sources__status {
  color: var(--color-text-muted);
}

.sources-footer {
  display: grid;
  gap: var(--space-2);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
}

@media (min-width: 768px) {
  .status-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
