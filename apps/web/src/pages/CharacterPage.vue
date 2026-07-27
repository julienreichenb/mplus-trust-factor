<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { api } from "../api/client";
import type { CharacterProfileView } from "../api/types";
import { useAbortableQuery } from "../composables/useAbortableQuery";
import { useRefreshPolling } from "../composables/useRefreshPolling";
import { useRecentSearchesStore } from "../stores/recentSearches";
import SkeletonBlock from "../components/common/SkeletonBlock.vue";
import StatusBanner from "../components/common/StatusBanner.vue";
import ScoreHeader from "../components/profile/ScoreHeader.vue";
import RedFlagsList from "../components/profile/RedFlagsList.vue";
import DimensionCards from "../components/profile/DimensionCards.vue";
import AuthenticitySection from "../components/profile/AuthenticitySection.vue";
import AnalyzedRunsSection from "../components/profile/AnalyzedRunsSection.vue";
import EquipmentSeasonSection from "../components/profile/EquipmentSeasonSection.vue";
import SourcesAttribution from "../components/profile/SourcesAttribution.vue";
import TrustRadarChart from "../components/charts/TrustRadarChart.vue";
import { ApiClientError } from "../api/live-client";

const props = defineProps<{
  region: string;
  realm: string;
  name: string;
}>();

const recent = useRecentSearchesStore();
const { nextSignal } = useAbortableQuery();
const { polling, start: startPolling, stop: stopPolling } = useRefreshPolling();

const loading = ref(true);
const error = ref<string | null>(null);
const notFound = ref(false);
const profile = ref<CharacterProfileView | null>(null);

const confidenceWarning = computed(() => {
  const conf = profile.value?.dataConfidence ?? (profile.value?.score?.confidence != null ? profile.value.score.confidence * 100 : null);
  return conf !== null && conf < 40;
});

const authFlags = computed(
  () =>
    profile.value?.redFlags.filter((f) =>
      ["boost_suspected", "atypical_progression", "low_run_volume", "probable_reroll", "confirmed_reroll"].includes(
        f.key,
      ),
    ) ?? [],
);

const entitlements = computed(() => profile.value?.entitlements ?? {
  detailsUnlocked: true,
  runsUnlocked: true,
  compareExpanded: true,
});

const raiderIoUsed = computed(() => profile.value?.raiderIoUsed ?? false);

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  notFound.value = false;
  stopPolling();
  const signal = nextSignal();
  const identity = {
    region: props.region.toUpperCase(),
    realmSlug: props.realm.toLowerCase(),
    name: props.name,
  };
  try {
    const data = await api.getCharacterProfile(identity, signal);
    profile.value = data;
    recent.add(identity);
    if (data.refreshStatus === "QUEUED") {
      void startPolling({
        identity,
        onUpdate: (status) => {
          if (profile.value) {
            profile.value = {
              ...profile.value,
              refreshStatus:
                status.refreshStatus === "IN_PROGRESS" || status.refreshStatus === "QUEUED"
                  ? "QUEUED"
                  : status.refreshStatus === "FAILED"
                    ? "STALE"
                    : "FRESH",
            };
          }
        },
        onComplete: async () => {
          const refreshed = await api.getCharacterProfile(identity);
          profile.value = refreshed;
        },
      });
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    const status = (err as ApiClientError).status ?? (err as { status?: number }).status;
    const code = (err as ApiClientError).code ?? (err as { code?: string }).code;
    if (status === 404 || code === "CHARACTER_NOT_FOUND") {
      notFound.value = true;
      profile.value = null;
    } else {
      error.value = (err as Error).message || "Failed to load profile";
    }
  } finally {
    loading.value = false;
  }
}

async function refresh(): Promise<void> {
  if (!profile.value) return;
  const identity = {
    region: props.region.toUpperCase(),
    realmSlug: props.realm.toLowerCase(),
    name: props.name,
  };
  try {
    await api.refreshCharacter(identity);
    profile.value = { ...profile.value, refreshStatus: "QUEUED" };
    void startPolling({
      identity,
      onUpdate: (status) => {
        if (profile.value) {
          profile.value = {
            ...profile.value,
            refreshStatus:
              status.refreshStatus === "IN_PROGRESS" || status.refreshStatus === "QUEUED"
                ? "QUEUED"
                : status.refreshStatus === "FAILED"
                  ? "STALE"
                  : "FRESH",
          };
        }
      },
      onComplete: async () => {
        const refreshed = await api.getCharacterProfile(identity);
        profile.value = refreshed;
      },
    });
  } catch (err) {
    error.value = (err as Error).message || "Refresh failed";
  }
}

watch(
  () => [props.region, props.realm, props.name],
  () => {
    void load();
  },
  { immediate: true },
);
</script>

<template>
  <section data-testid="character-page">
    <SkeletonBlock v-if="loading" label="Loading character profile" :lines="8" />

    <StatusBanner v-else-if="notFound" tone="warn" title="Character not found">
      No fixture or API record for {{ name }} on {{ realm }} ({{ region }}). Try Aleria / tarren-mill in mock mode.
    </StatusBanner>

    <StatusBanner v-else-if="error" tone="error" title="Could not load profile">
      {{ error }}
      <button type="button" class="btn" @click="load">Retry</button>
    </StatusBanner>

    <template v-else-if="profile">
      <StatusBanner
        v-if="profile.refreshStatus === 'QUEUED' || polling"
        tone="info"
        title="Refresh queued"
        data-testid="queued-banner"
      >
        Showing the latest available snapshot while a refresh runs. Polling with backoff until complete.
      </StatusBanner>

      <StatusBanner
        v-else-if="profile.refreshStatus === 'STALE'"
        tone="warn"
        title="Stale data"
        data-testid="stale-banner"
      >
        This snapshot is usable but may be outdated. Refresh to queue an update.
      </StatusBanner>

      <StatusBanner
        v-if="confidenceWarning"
        tone="warn"
        title="Low confidence"
        data-testid="confidence-warning"
      >
        Data confidence is low. The Trust Factor is shrunk toward neutral and should be interpreted cautiously.
      </StatusBanner>

      <StatusBanner
        v-for="w in profile.warnings"
        :key="w.code"
        :tone="w.severity === 'WARN' ? 'warn' : 'info'"
        :title="w.code.replaceAll('_', ' ')"
      >
        {{ w.message }}
      </StatusBanner>

      <ScoreHeader :profile="profile" :refreshing="polling" @refresh="refresh" />

      <TrustRadarChart
        v-if="profile.score?.dimensions?.length"
        :series="[
          {
            id: profile.characterId,
            name: profile.displayName,
            dimensions: profile.score.dimensions,
          },
        ]"
      />

      <DimensionCards
        v-if="profile.score"
        :dimensions="profile.score.dimensions"
        :locked="!entitlements.detailsUnlocked"
      />

      <AuthenticitySection
        :authenticity-score="profile.score?.authenticityScore ?? null"
        :flags="authFlags"
        :locked="!entitlements.detailsUnlocked"
      />

      <RedFlagsList :flags="profile.redFlags" />

      <AnalyzedRunsSection
        :last="profile.lastAnalyzedRun ?? null"
        :highest="profile.highestAnalyzedRun ?? null"
        :locked="!entitlements.runsUnlocked"
      />

      <EquipmentSeasonSection
        :equipment="profile.equipment ?? null"
        :talents="profile.talents ?? null"
        :season="profile.seasonSummary ?? null"
        :locked="!entitlements.detailsUnlocked"
      />

      <SourcesAttribution
        :sources="profile.sources"
        :raider-io-used="raiderIoUsed"
        :model-key="profile.score?.modelKey"
        :model-version="profile.score?.modelVersion"
        :calculated-at="profile.score?.calculatedAt"
      />
    </template>
  </section>
</template>
