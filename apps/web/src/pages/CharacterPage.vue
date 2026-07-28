<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { api } from "../api/client";
import type { CharacterProfileView } from "../api/types";
import { useAbortableQuery } from "../composables/useAbortableQuery";
import { useRefreshPolling } from "../composables/useRefreshPolling";
import { useRecentSearchesStore } from "../stores/recentSearches";
import StatusBanner from "../components/common/StatusBanner.vue";
import AppToast from "../components/common/AppToast.vue";
import CharacterRealmSearch from "../components/search/CharacterRealmSearch.vue";
import CharacterLoadingSplash from "../components/character/CharacterLoadingSplash.vue";
import CharacterPortraitStage from "../components/character/CharacterPortraitStage.vue";
import CharacterProfileToolbar from "../components/character/CharacterProfileToolbar.vue";
import ScoreHeader from "../components/profile/ScoreHeader.vue";
import DimensionCards from "../components/profile/DimensionCards.vue";
import AuthenticitySection from "../components/profile/AuthenticitySection.vue";
import SelectedRunsSection from "../components/profile/SelectedRunsSection.vue";
import PerformanceSummaryPanel from "../components/profile/PerformanceSummaryPanel.vue";
import WclVisibilityBanner from "../components/profile/WclVisibilityBanner.vue";
import KeySignalsPanel from "../components/character/KeySignalsPanel.vue";
import DataProvenancePanel from "../components/character/DataProvenancePanel.vue";
import EquipmentGrid from "../components/equipment/EquipmentGrid.vue";
import TalentBuildPanel from "../components/talents/TalentBuildPanel.vue";
import MethodologyPanel from "../components/methodology/MethodologyPanel.vue";
import { resolveDataConfidence } from "../lib/characterViewModel";
import { gradeThemeCssVars } from "../lib/gradeTheme";
import { filterDimensionsForModel } from "../lib/format";
import { useWowheadTooltips } from "../composables/useWowheadTooltips";
import { ApiClientError } from "../api/live-client";

const props = defineProps<{
  region: string;
  realm: string;
  name: string;
}>();

const recent = useRecentSearchesStore();
const { nextSignal } = useAbortableQuery();
const { polling, timedOut, start: startPolling, stop: stopPolling } = useRefreshPolling();
useWowheadTooltips(true);

const loading = ref(true);
const error = ref<string | null>(null);
const refreshNotice = ref<string | null>(null);
const notFound = ref(false);
const profile = ref<CharacterProfileView | null>(null);

/** Keep splash visible while the first fetch or queued enrichment is in progress. */
const showSplash = computed(() => loading.value || polling.value);

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

const visibleDimensions = computed(() =>
  filterDimensionsForModel(profile.value?.score?.dimensions ?? [], profile.value?.score?.modelVersion),
);

const grade = computed(() => profile.value?.score?.grade ?? null);
const rankThemeStyle = computed(() => gradeThemeCssVars(grade.value));

const hasWclNotice = computed(() => {
  const p = profile.value;
  if (!p) return false;
  const visibility = p.wclVisibility;
  const dataState = p.wclDataState;
  if (visibility === "HIDDEN") return true;
  if (visibility === "PUBLIC" && (dataState === "NO_MATCHED_RUN" || dataState === "RANKINGS_ONLY")) {
    return true;
  }
  return dataState === "NO_PUBLIC_LOGS" || dataState === "RATE_LIMITED" || dataState === "UNAVAILABLE";
});

/** Profile status / data notices shown in the collapsible banner group. */
const bannerTitles = computed(() => {
  if (!profile.value || showSplash.value) return [];
  const titles: string[] = [];
  if (profile.value.refreshStatus === "QUEUED" || polling.value) {
    titles.push("Refresh queued");
  } else if (timedOut.value) {
    titles.push("Refresh timed out");
  } else if (profile.value.refreshStatus === "STALE") {
    titles.push("Stale data");
  }
  if (confidenceWarning.value) titles.push("Low confidence");
  for (const w of profile.value.warnings ?? []) {
    titles.push(w.code.replaceAll("_", " "));
  }
  if (hasWclNotice.value) titles.push("Warcraft Logs visibility");
  return titles;
});

const showBannerGroup = computed(() => bannerTitles.value.length > 0);

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  refreshNotice.value = null;
  notFound.value = false;
  stopPolling();
  const startedAt = Date.now();
  const signal = nextSignal();
  const identity = {
    region: props.region.toUpperCase(),
    realmSlug: props.realm.toLowerCase(),
    name: props.name,
  };
  try {
    const data = await api.getCharacterProfile(identity, signal);
    profile.value = data;
    recent.add({
      ...identity,
      classSlug: data.classSlug ?? null,
      avatarUrl: data.media?.avatarUrl ?? data.media?.insetUrl ?? null,
    });
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
        onTimeout: () => {
          error.value = "Refresh is taking longer than expected. Retry or reopen this profile.";
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
    const minSplashMs = 500;
    const remaining = minSplashMs - (Date.now() - startedAt);
    if (remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, remaining));
    }
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
    refreshNotice.value = null;
    const status = await api.refreshCharacter(identity);
    const inFlight =
      status.refreshStatus === "QUEUED" || status.refreshStatus === "IN_PROGRESS";

    if (!inFlight && status.cooldownSecondsRemaining > 0) {
      const minutes = Math.ceil(status.cooldownSecondsRemaining / 60);
      refreshNotice.value =
        status.cooldownSecondsRemaining >= 60
          ? `Refresh is on cooldown. Try again in about ${minutes} min.`
          : `Refresh is on cooldown. Try again in ${status.cooldownSecondsRemaining}s.`;
      return;
    }

    if (status.refreshStatus === "FRESH" && !inFlight) {
      const refreshed = await api.getCharacterProfile(identity);
      profile.value = refreshed;
      return;
    }

    profile.value = { ...profile.value, refreshStatus: "QUEUED" };
    void startPolling({
      identity,
      onUpdate: (statusUpdate) => {
        if (profile.value) {
          profile.value = {
            ...profile.value,
            refreshStatus:
              statusUpdate.refreshStatus === "IN_PROGRESS" || statusUpdate.refreshStatus === "QUEUED"
                ? "QUEUED"
                : statusUpdate.refreshStatus === "FAILED"
                  ? "STALE"
                  : "FRESH",
          };
        }
      },
      onComplete: async (statusUpdate) => {
        if (statusUpdate.refreshStatus === "FAILED" || statusUpdate.job?.status === "failed") {
          refreshNotice.value =
            statusUpdate.job?.errorMessage?.trim() ||
            "Refresh failed. You can retry without losing the last available snapshot.";
        }
        const refreshed = await api.getCharacterProfile(identity);
        profile.value = refreshed;
      },
    });
  } catch (err) {
    refreshNotice.value = (err as Error).message || "Refresh failed";
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
  <section
    class="character-page"
    :class="{ 'character-page--splashing': showSplash }"
    :data-tier="grade ?? undefined"
    :style="rankThemeStyle"
    data-testid="character-page"
  >
    <StatusBanner v-if="notFound && !showSplash" tone="warn" title="Character not found on this realm">
      No record for {{ name }} on {{ realm }} ({{ region }}). Search again with a catalog realm.
      <div class="not-found-search">
        <CharacterRealmSearch :show-recent="false" submit-label="Search" />
      </div>
    </StatusBanner>

    <StatusBanner
      v-else-if="error && !profile && !showSplash"
      tone="error"
      title="Could not load profile"
    >
      {{ error }}
      <button type="button" class="btn" @click="load">Retry</button>
    </StatusBanner>

    <template v-if="profile">
      <CharacterProfileToolbar :profile="profile" :refreshing="polling" @refresh="refresh" />

      <details
        v-if="showBannerGroup"
        class="character-page__banners"
        data-testid="character-banners"
      >
        <summary class="character-page__banners-summary">
          Notices
          <span class="character-page__banners-count mpts-data">{{ bannerTitles.length }}</span>
        </summary>
        <div class="character-page__banners-body">
          <StatusBanner
            v-if="profile.refreshStatus === 'QUEUED' || polling"
            tone="info"
            title="Refresh queued"
            data-testid="queued-banner"
          >
            Showing the latest available snapshot while a refresh runs. Polling with backoff until complete.
          </StatusBanner>

          <StatusBanner
            v-else-if="timedOut"
            tone="warn"
            title="Refresh timed out"
            data-testid="refresh-timeout-banner"
          >
            Still waiting on providers. Retry refresh or come back shortly.
            <button type="button" class="btn" data-testid="refresh-timeout-retry" @click="refresh">Retry</button>
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
        </div>
      </details>

      <div class="character-page__hero">
        <CharacterPortraitStage :profile="profile" />
        <ScoreHeader :profile="profile" />
      </div>

      <DimensionCards
        v-if="profile.score"
        :dimensions="visibleDimensions"
        :model-version="profile.score.modelVersion"
        :locked="!entitlements.detailsUnlocked"
      />

      <div class="split">
        <KeySignalsPanel
          :dimensions="profile.score?.dimensions ?? []"
          :flags="profile.redFlags"
        />
        <DataProvenancePanel :profile="profile" />
      </div>

      <AuthenticitySection
        :authenticity-score="profile.score?.authenticityScore ?? null"
        :flags="authFlags"
        :locked="!entitlements.detailsUnlocked"
      />

      <SelectedRunsSection
        :selection="profile.scoringRunSelection ?? null"
        :locked="!entitlements.runsUnlocked"
      />

      <PerformanceSummaryPanel
        :summary="profile.performanceSummary"
        :locked="!entitlements.detailsUnlocked"
      />

      <EquipmentGrid :equipment="profile.equipment" :locked="!entitlements.detailsUnlocked" />
      <TalentBuildPanel :talents="profile.talents" :locked="!entitlements.detailsUnlocked" />
      <MethodologyPanel :profile="profile" />
    </template>

    <CharacterLoadingSplash
      v-if="showSplash"
      :name="name"
      :realm="realm"
      :region="region"
      :hint="polling && !loading ? 'Refreshing character data…' : 'Gathering public signals…'"
    />

    <AppToast
      :open="Boolean(refreshNotice)"
      :message="refreshNotice ?? ''"
      tone="warn"
      @close="refreshNotice = null"
    />
  </section>
</template>

<style scoped>
.character-page {
  display: grid;
  gap: var(--space-2);
  position: relative;
}

.character-page__hero {
  position: relative;
  isolation: isolate;
  overflow: visible;
}

.character-page--splashing {
  min-height: 70dvh;
}

.character-page__banners {
  border: none;
  background: transparent;
  padding: 0;
}

.character-page__banners-summary {
  cursor: pointer;
  list-style: none;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) 0;
  font-family: var(--font-data);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  user-select: none;
}

.character-page__banners-summary::-webkit-details-marker {
  display: none;
}

.character-page__banners-summary::before {
  content: "";
  width: 0.4rem;
  height: 0.4rem;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: rotate(-45deg);
  transition: transform var(--duration-fast);
}

.character-page__banners[open] > .character-page__banners-summary::before {
  transform: rotate(45deg);
}

.character-page__banners-count {
  display: inline-grid;
  place-items: center;
  min-width: 1.25rem;
  height: 1.25rem;
  padding: 0 0.35rem;
  border-radius: var(--radius-control);
  background: var(--color-iron-800);
  color: var(--color-gold-300);
  font-size: var(--text-xs);
}

.character-page__banners-body {
  display: grid;
  gap: var(--space-1);
  padding: 0;
}

.not-found-search {
  margin-top: var(--space-4);
  max-width: 40rem;
}

.split {
  display: grid;
  gap: var(--space-2);
}

@media (min-width: 1024px) {
  .split {
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
    align-items: start;
  }
}
</style>
