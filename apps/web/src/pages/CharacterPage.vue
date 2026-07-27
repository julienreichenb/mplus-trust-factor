<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { api } from "../api/client";
import type { CharacterProfileView } from "../api/types";
import { useAbortableQuery } from "../composables/useAbortableQuery";
import { useRefreshPolling } from "../composables/useRefreshPolling";
import { useRecentSearchesStore } from "../stores/recentSearches";
import SkeletonBlock from "../components/common/SkeletonBlock.vue";
import StatusBanner from "../components/common/StatusBanner.vue";
import CollapsiblePanel from "../components/common/CollapsiblePanel.vue";
import ScoreHeader from "../components/profile/ScoreHeader.vue";
import DimensionEvidencePanel from "../components/profile/DimensionEvidencePanel.vue";
import AuthenticitySection from "../components/profile/AuthenticitySection.vue";
import SelectedRunsPanel from "../components/profile/SelectedRunsPanel.vue";
import PerformanceSummaryPanel from "../components/profile/PerformanceSummaryPanel.vue";
import WclVisibilityBanner from "../components/profile/WclVisibilityBanner.vue";
import TrustRadarChart from "../components/charts/TrustRadarChart.vue";
import KeySignalsPanel from "../components/character/KeySignalsPanel.vue";
import DataProvenancePanel from "../components/character/DataProvenancePanel.vue";
import EquipmentGrid from "../components/equipment/EquipmentGrid.vue";
import TalentBuildPanel from "../components/talents/TalentBuildPanel.vue";
import MethodologyPanel from "../components/methodology/MethodologyPanel.vue";
import {
  presentDimensionEvidence,
  resolveDataConfidence,
} from "../lib/characterViewModel";
import { resolveSelectedRuns } from "../lib/selectedRunsViewModel";
import { useWowheadTooltips } from "../composables/useWowheadTooltips";
import { ApiClientError } from "../api/live-client";

type ProfileTab = "overview" | "keys" | "methodology";

const props = defineProps<{
  region: string;
  realm: string;
  name: string;
}>();

const recent = useRecentSearchesStore();
const { nextSignal } = useAbortableQuery();
const { polling, start: startPolling, stop: stopPolling } = useRefreshPolling();
useWowheadTooltips(true);

const loading = ref(true);
const error = ref<string | null>(null);
const notFound = ref(false);
const profile = ref<CharacterProfileView | null>(null);
const activeTab = ref<ProfileTab>("overview");

const confidenceWarning = computed(() => {
  const conf = profile.value ? resolveDataConfidence(profile.value) : null;
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

const entitlements = computed(
  () =>
    profile.value?.entitlements ?? {
      detailsUnlocked: true,
      runsUnlocked: true,
      compareExpanded: true,
    },
);

const selectedRuns = computed(() =>
  profile.value ? resolveSelectedRuns(profile.value) : null,
);

const dimensionEvidence = computed(() =>
  profile.value?.score?.dimensions
    ? presentDimensionEvidence(profile.value.score.dimensions, profile.value.score.modelVersion)
    : [],
);

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  notFound.value = false;
  stopPolling();
  activeTab.value = "overview";
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
            const terminalFailed =
              status.refreshStatus === "FAILED" || status.job?.status === "failed";
            const inProgress =
              status.refreshStatus === "IN_PROGRESS" ||
              status.refreshStatus === "QUEUED" ||
              status.job?.status === "queued" ||
              status.job?.status === "active";
            profile.value = {
              ...profile.value,
              refreshStatus: terminalFailed
                ? "STALE"
                : inProgress
                  ? "QUEUED"
                  : "FRESH",
            };
          }
        },
        onComplete: async (status) => {
          if (status.refreshStatus === "FAILED" || status.job?.status === "failed") {
            error.value =
              status.job?.errorMessage?.trim() ||
              "Refresh failed. You can retry without losing the last available snapshot.";
          }
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
      onComplete: async (status) => {
        if (status.refreshStatus === "FAILED" || status.job?.status === "failed") {
          error.value =
            status.job?.errorMessage?.trim() ||
            "Refresh failed. You can retry without losing the last available snapshot.";
        }
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
  <section class="character-page" data-testid="character-page">
    <div v-if="loading" class="loading" role="status" aria-live="polite">
      <SkeletonBlock label="Loading character identity" :lines="4" />
      <SkeletonBlock label="Loading trust score" :lines="5" />
      <SkeletonBlock label="Loading dimensions and sources" :lines="6" />
    </div>

    <StatusBanner v-else-if="notFound" tone="warn" title="Character not found">
      No fixture or API record for {{ name }} on {{ realm }} ({{ region }}). Try Aleria / tarren-mill in
      mock mode.
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
        Data confidence is low. The Trust Factor is shrunk toward neutral and should be interpreted
        cautiously.
      </StatusBanner>

      <StatusBanner
        v-for="w in profile.warnings"
        :key="w.code"
        :tone="w.severity === 'WARN' ? 'warn' : 'info'"
        :title="w.code.replaceAll('_', ' ')"
      >
        {{ w.message }}
      </StatusBanner>

      <WclVisibilityBanner
        :visibility="profile.wclVisibility"
        :data-state="profile.wclDataState"
      />

      <ScoreHeader :profile="profile" :refreshing="polling" @refresh="refresh" />

      <nav class="tabs" aria-label="Profile sections" data-testid="profile-tabs">
        <button
          type="button"
          class="tabs__btn"
          :aria-selected="activeTab === 'overview'"
          data-testid="tab-overview"
          @click="activeTab = 'overview'"
        >
          Overview
        </button>
        <button
          type="button"
          class="tabs__btn"
          :aria-selected="activeTab === 'keys'"
          data-testid="tab-keys"
          @click="activeTab = 'keys'"
        >
          Highest Keys
        </button>
        <button
          type="button"
          class="tabs__btn"
          :aria-selected="activeTab === 'methodology'"
          data-testid="tab-methodology"
          @click="activeTab = 'methodology'"
        >
          Methodology
        </button>
      </nav>

      <div v-if="activeTab === 'overview'" class="tab-panel" data-testid="panel-overview">
        <TrustRadarChart
          v-if="profile.score?.dimensions?.length"
          :series="[
            {
              id: profile.characterId,
              name: profile.displayName,
              dimensions: profile.score.dimensions,
            },
          ]"
          :locked="!entitlements.detailsUnlocked"
        />

        <DimensionEvidencePanel
          :dimensions="dimensionEvidence"
          :locked="!entitlements.detailsUnlocked"
        />

        <KeySignalsPanel
          :dimensions="profile.score?.dimensions ?? []"
          :flags="profile.redFlags"
        />

        <CollapsiblePanel title="Equipment">
          <EquipmentGrid :equipment="profile.equipment" :locked="!entitlements.detailsUnlocked" />
        </CollapsiblePanel>

        <CollapsiblePanel title="Talents & specialization">
          <TalentBuildPanel :talents="profile.talents" :locked="!entitlements.detailsUnlocked" />
        </CollapsiblePanel>

        <CollapsiblePanel title="Provider provenance">
          <DataProvenancePanel :profile="profile" />
        </CollapsiblePanel>

        <CollapsiblePanel title="Historical experience & authenticity">
          <AuthenticitySection
            :authenticity-score="profile.score?.authenticityScore ?? null"
            :flags="authFlags"
            :locked="!entitlements.detailsUnlocked"
          />
          <PerformanceSummaryPanel
            :summary="profile.performanceSummary"
            :locked="!entitlements.detailsUnlocked"
          />
        </CollapsiblePanel>
      </div>

      <div v-else-if="activeTab === 'keys'" class="tab-panel" data-testid="panel-keys">
        <SelectedRunsPanel
          v-if="selectedRuns"
          :runs="selectedRuns.runs"
          :coverage-label="selectedRuns.coverageLabel"
          :expected-count="selectedRuns.expectedCount"
          :locked="!entitlements.runsUnlocked"
        />
      </div>

      <div v-else class="tab-panel" data-testid="panel-methodology">
        <MethodologyPanel :profile="profile" />
        <DataProvenancePanel :profile="profile" />
      </div>
    </template>
  </section>
</template>

<style scoped>
.character-page {
  display: grid;
  gap: var(--space-8);
}

.loading {
  display: grid;
  gap: var(--space-5);
}

.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  padding-bottom: var(--space-3);
  border-bottom: 1px solid var(--color-border);
  position: sticky;
  top: 3.75rem;
  z-index: 5;
  background: linear-gradient(180deg, rgb(7 7 7 / 96%), rgb(7 7 7 / 88%));
  backdrop-filter: blur(8px);
}

.tabs__btn {
  font: inherit;
  font-weight: 600;
  font-size: var(--text-sm);
  min-height: 2.5rem;
  padding: 0.4rem 0.85rem;
  border-radius: var(--radius-control);
  border: 1px solid transparent;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
}

.tabs__btn[aria-selected="true"] {
  color: var(--color-text);
  border-color: var(--color-border);
  background: var(--color-surface);
}

.tab-panel {
  display: grid;
  gap: var(--space-8);
}
</style>
