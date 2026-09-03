<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { api } from "../api/client";
import type { CharacterProfileView } from "../api/types";
import type { ActiveRerollCharacterDTO, ActiveRerollsResponse } from "@mplus/contracts";
import { useAbortableQuery } from "../composables/useAbortableQuery";
import { useAuthSession } from "../composables/useAuthSession";
import { useCharacterScoreAwait } from "../composables/useCharacterScoreAwait";
import { useRecentSearchesStore } from "../stores/recentSearches";
import StatusBanner from "../components/common/StatusBanner.vue";
import AppToast from "../components/common/AppToast.vue";
import CharacterRealmSearch from "../components/search/CharacterRealmSearch.vue";
import CharacterPortraitStage from "../components/character/CharacterPortraitStage.vue";
import CharacterProfileToolbar from "../components/character/CharacterProfileToolbar.vue";
import CharacterRefreshEta from "../components/character/CharacterRefreshEta.vue";
import ScoreHeader from "../components/profile/ScoreHeader.vue";
import DimensionCards from "../components/profile/DimensionCards.vue";
import BoostSuspicionSection from "../components/profile/BoostSuspicionSection.vue";
import ScoreHistorySection from "../components/profile/ScoreHistorySection.vue";
import BoostSuspicionAlertDialog from "../components/profile/BoostSuspicionAlertDialog.vue";
import RunDetailsDrawer from "../components/profile/RunDetailsDrawer.vue";
import type { RunDrawerModel } from "../components/profile/RunDetailsDrawer.vue";
import WclVisibilityBanner from "../components/profile/WclVisibilityBanner.vue";
import MethodologyPanel from "../components/methodology/MethodologyPanel.vue";
import { isHighBoostSuspicionAlert } from "@mplus/contracts";
import { resolveDataConfidence } from "../lib/characterViewModel";
import { gradeThemeCssVars } from "../lib/gradeTheme";
import { filterDimensionsForModel } from "../lib/format";
import { useWowheadTooltips } from "../composables/useWowheadTooltips";
import { ApiClientError } from "../api/live-client";
import {
  loadWowheadTooltipScript,
  refreshWowheadTooltips,
} from "../integrations/wowhead/tooltips";
import { inferBootstrapRepairRequired, refreshStatusHasRealInFlightJob } from "../lib/bootstrapRepair";
import { isInitialScoreCalculating } from "../lib/characterScoreLoadState";

const props = defineProps<{
  region: string;
  realm: string;
  name: string;
}>();

const recent = useRecentSearchesStore();
const { nextSignal } = useAbortableQuery();
const {
  polling,
  timedOut,
  lastRefreshStatus,
  terminalFailure,
  startAwaiting,
  retryScoreLoad,
  stopAwaiting,
  scorePhaseFor,
  showScoreLoadingUi,
  showScoreContent,
  applyRefreshStatusToProfile,
  withBootstrapRepairSignal,
} = useCharacterScoreAwait();
const { canForceRefresh, authenticated, hasPermission, fetchAuthMe } = useAuthSession();

const canOpenAdminCharacter = computed(
  () =>
    hasPermission("admin.users.read") ||
    hasPermission("admin.users.manage") ||
    hasPermission("admin.jobs.manage") ||
    hasPermission("score.candidate.read"),
);
const apiBase = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

onMounted(() => {
  void fetchAuthMe();
});
useWowheadTooltips(true);
void loadWowheadTooltipScript({ iconizeLinks: false })
  .then((status) => {
    if (status === "ready") refreshWowheadTooltips();
  })
  .catch(() => {
    /* plain links remain usable */
  });

const loading = ref(true);
const error = ref<string | null>(null);
const refreshNotice = ref<string | null>(null);
const notFound = ref(false);
const profile = ref<CharacterProfileView | null>(null);
const activeRerolls = ref<ActiveRerollCharacterDTO[]>([]);
const displayedCharacterIsMain = ref(false);
const repairing = ref(false);
const boostAlertOpen = ref(false);
const boostAlertAutoOpened = ref(false);
const selectedDrawerRun = ref<RunDrawerModel | null>(null);

function maybeAutoOpenBoostAlert(): void {
  if (boostAlertAutoOpened.value) return;
  if (isHighBoostSuspicionAlert(profile.value?.boostAssessment)) {
    boostAlertOpen.value = true;
    boostAlertAutoOpened.value = true;
  }
}

function closeBoostAlert(): void {
  boostAlertOpen.value = false;
}

function openBoostAlert(): void {
  boostAlertOpen.value = true;
}

const confidenceWarning = computed(() => {
  const conf = profile.value ? resolveDataConfidence(profile.value) : null;
  return conf !== null && conf < 40;
});

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
  if (!profile.value) return [];
  const titles: string[] = [];
  // Quiet refresh UX (main): no in-flight queued/refreshing banners — chips cover those states.
  // Initial score calculation uses ScoreHeader loading mode instead of these banners.
  if (showScoreLoadingUi(profile.value)) {
    /* score-loading panel owns calculating / timeout / failure messaging */
  } else if (timedOut.value) {
    titles.push("Refresh timed out");
  } else if (profile.value.refreshStatus === "STALE" && !polling.value) {
    titles.push("Data may be outdated");
  } else if (inferBootstrapRepairRequired(profile.value)) {
    titles.push("Profile data incomplete");
  } else if (profile.value.refreshStatus === "FAILED" && !polling.value) {
    titles.push("Refresh failed");
  }
  if (confidenceWarning.value) titles.push("Low confidence");
  for (const w of profile.value.warnings ?? []) {
    titles.push(w.code.replaceAll("_", " "));
  }
  if (hasWclNotice.value) titles.push("Warcraft Logs visibility");
  return titles;
});

const showBannerGroup = computed(() => bannerTitles.value.length > 0);

const scoreLoadPhase = computed(() => scorePhaseFor(profile.value));
const scoreLoadingPhase = computed(() => {
  const phase = scoreLoadPhase.value;
  if (phase === "calculating" || phase === "timed_out" || phase === "failed") return phase;
  return null;
});

function currentIdentity() {
  return {
    region: props.region.toUpperCase(),
    realmSlug: props.realm.toLowerCase(),
    name: props.name,
  };
}

function awaitCallbacks() {
  return {
    onNotice: (message: string | null) => {
      refreshNotice.value = message;
    },
    onError: (message: string | null) => {
      error.value = message;
    },
  };
}

async function loadActiveRerolls(): Promise<void> {
  activeRerolls.value = [];
  displayedCharacterIsMain.value = false;
  // Anonymous viewers must never call the Active Rerolls endpoint.
  if (!authenticated.value) return;
  try {
    const path = `/api/v1/characters/${encodeURIComponent(props.region)}/${encodeURIComponent(props.realm)}/${encodeURIComponent(props.name)}/active-rerolls`;
    const response = await fetch(`${apiBase}${path}`, { credentials: "include" });
    if (!response.ok) {
      activeRerolls.value = [];
      displayedCharacterIsMain.value = false;
      return;
    }
    const body = (await response.json()) as ActiveRerollsResponse;
    activeRerolls.value = Array.isArray(body.rerolls) ? body.rerolls : [];
    displayedCharacterIsMain.value = body.displayedCharacterIsMain === true;
  } catch {
    activeRerolls.value = [];
    displayedCharacterIsMain.value = false;
  }
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  refreshNotice.value = null;
  notFound.value = false;
  stopAwaiting();
  terminalFailure.value = false;
  activeRerolls.value = [];
  displayedCharacterIsMain.value = false;
  const signal = nextSignal();
  const identity = currentIdentity();
  try {
    await fetchAuthMe();
    const data = withBootstrapRepairSignal(await api.getCharacterProfile(identity, signal));
    profile.value = data;
    maybeAutoOpenBoostAlert();
    recent.add({
      ...identity,
      classSlug: data.classSlug ?? null,
      avatarUrl: data.media?.avatarUrl ?? data.media?.insetUrl ?? null,
    });
    void loadActiveRerolls();
    if (
      data.refreshStatus === "QUEUED" ||
      data.refreshStatus === "REFRESHING" ||
      isInitialScoreCalculating(data)
    ) {
      await startAwaiting({
        identity,
        profile,
        admin: canForceRefresh.value,
        force: true,
        ...awaitCallbacks(),
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

/** Public-safe: re-read profile/status and restart polling. Never POSTs refresh. */
async function retryScoreCalculation(): Promise<void> {
  if (!profile.value) return;
  error.value = null;
  refreshNotice.value = null;
  await retryScoreLoad({
    identity: currentIdentity(),
    profile,
    admin: canForceRefresh.value,
    force: true,
    ...awaitCallbacks(),
  });
}

async function repairBootstrap(): Promise<void> {
  if (!profile.value || repairing.value) return;
  const identity = currentIdentity();
  repairing.value = true;
  error.value = null;
  refreshNotice.value = null;
  try {
    const result = await api.resolveCharacter(
      {
        region: identity.region as "EU" | "US" | "KR" | "TW",
        realmSlug: identity.realmSlug,
        name: identity.name,
        forceRetry: true,
      },
      undefined,
    );
    if (result.status === "NOT_FOUND") {
      error.value = result.message || "Character not found on Blizzard.";
      return;
    }
    if (result.status === "PROVIDER_UNAVAILABLE") {
      error.value = result.message || "Blizzard is temporarily unavailable. Retry shortly.";
      return;
    }
    if (result.status === "FAILED") {
      error.value = result.message || "Blizzard profile lookup failed.";
      return;
    }

    const refreshed = withBootstrapRepairSignal(await api.getCharacterProfile(identity));
    profile.value = refreshed;
    if (
      result.status === "QUEUED" ||
      result.status === "PROCESSING" ||
      result.status === "READY" ||
      result.status === "PROFILE_ONLY"
    ) {
      refreshNotice.value =
        result.status === "QUEUED" || result.status === "PROCESSING"
          ? "Profile repaired — score refresh queued."
          : "Profile data restored.";
    } else {
      refreshNotice.value = "Profile data restored.";
    }

    if (refreshed.refreshStatus === "QUEUED" || refreshed.refreshStatus === "REFRESHING") {
      await startAwaiting({
        identity,
        profile,
        admin: canForceRefresh.value,
        force: true,
        ...awaitCallbacks(),
      });
    }
  } catch (err) {
    error.value = (err as Error).message || "Blizzard profile lookup failed";
  } finally {
    repairing.value = false;
  }
}

/** Admin-only capability: POST refresh then poll via the same score-await lifecycle. */
async function refresh(): Promise<void> {
  if (!profile.value || !canForceRefresh.value) return;
  const identity = currentIdentity();
  const force = canForceRefresh.value;
  try {
    refreshNotice.value = null;
    error.value = null;
    const status = await api.refreshCharacter(identity, undefined, { force });
    const inFlight = refreshStatusHasRealInFlightJob(status);

    if (!inFlight && status.cooldownSecondsRemaining > 0) {
      const minutes = Math.ceil(status.cooldownSecondsRemaining / 60);
      refreshNotice.value =
        status.cooldownSecondsRemaining >= 60
          ? `Refresh is on cooldown. Try again in about ${minutes} min.`
          : `Refresh is on cooldown. Try again in ${status.cooldownSecondsRemaining}s.`;
      return;
    }

    if (force) {
      refreshNotice.value = "Force refresh queued.";
    }

    if (status.refreshStatus === "FRESH" && !inFlight) {
      const refreshed = withBootstrapRepairSignal(await api.getCharacterProfile(identity));
      profile.value = refreshed;
      return;
    }

    profile.value = applyRefreshStatusToProfile(profile.value, status);
    lastRefreshStatus.value = status;

    if (!inFlight) return;

    await startAwaiting({
      identity,
      profile,
      admin: true,
      force: true,
      seedStatus: status,
      ...awaitCallbacks(),
    });
  } catch (err) {
    refreshNotice.value = (err as Error).message || "Refresh failed";
  }
}

watch(
  () => [props.region, props.realm, props.name],
  () => {
    boostAlertAutoOpened.value = false;
    boostAlertOpen.value = false;
    selectedDrawerRun.value = null;
    void load();
  },
  { immediate: true },
);
</script>

<template>
  <section
    class="character-page"
    :data-tier="grade ?? undefined"
    :style="rankThemeStyle"
    data-testid="character-page"
  >
    <StatusBanner v-if="notFound && !loading" tone="warn" title="Character not found on this realm">
      No record for {{ name }} on {{ realm }} ({{ region }}). Search again with a catalog realm.
      <div class="not-found-search">
        <CharacterRealmSearch :show-recent="false" submit-label="Search" />
      </div>
    </StatusBanner>

    <StatusBanner
      v-else-if="error && !profile && !loading"
      tone="error"
      title="Could not load profile"
    >
      {{ error }}
      <button type="button" class="btn" @click="load">Retry</button>
    </StatusBanner>

    <p v-if="loading && !profile" class="character-page__loading" data-testid="character-loading">
      Loading profile…
    </p>

    <template v-if="profile">
      <CharacterProfileToolbar
        :profile="profile"
        :refreshing="polling"
        :repairing="repairing"
        :can-refresh="canForceRefresh"
        :admin-character-id="canOpenAdminCharacter ? profile.characterId : null"
        @refresh="refresh()"
        @repair-bootstrap="repairBootstrap"
      />
      <CharacterRefreshEta
        v-if="!scoreLoadingPhase && (polling || lastRefreshStatus)"
        :job="lastRefreshStatus?.job ?? null"
      />

      <StatusBanner
        v-if="inferBootstrapRepairRequired(profile)"
        tone="warn"
        title="Profile data incomplete"
        data-testid="bootstrap-incomplete-banner"
      >
        Required Blizzard character metadata is missing. Retry Blizzard profile lookup to restore
        level, class, spec and role — then a score refresh can run when eligible.
        <button
          type="button"
          class="btn"
          data-testid="bootstrap-repair-banner-button"
          :disabled="repairing"
          @click="repairBootstrap"
        >
          Retry Blizzard profile lookup
        </button>
      </StatusBanner>

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
            v-if="timedOut"
            tone="warn"
            title="Refresh timed out"
            data-testid="refresh-timeout-banner"
          >
            Still waiting on providers. Retry refresh or come back shortly.
            <button v-if="canForceRefresh" type="button" class="btn" data-testid="refresh-timeout-retry" @click="refresh()">Retry</button>
          </StatusBanner>

          <StatusBanner
            v-else-if="profile.refreshStatus === 'STALE' && !polling"
            tone="warn"
            title="Data may be outdated"
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
            v-for="w in (profile.warnings ?? []).filter(
              (w) => w.code !== 'CHARACTER_BOOTSTRAP_INCOMPLETE',
            )"
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

      <div
        class="character-page__hero"
        :class="{ 'character-page__hero--score-loading': Boolean(scoreLoadingPhase) }"
      >
        <!-- Keep Blizzard media visible during first-score calculation. -->
        <CharacterPortraitStage :profile="profile" />
        <ScoreHeader
          v-if="scoreLoadingPhase || showScoreContent(profile) || !showScoreLoadingUi(profile)"
          :profile="profile"
          :active-rerolls="activeRerolls"
          :displayed-character-is-main="displayedCharacterIsMain"
          :score-load-phase="scoreLoadingPhase"
          :refresh-job="scoreLoadingPhase ? (lastRefreshStatus?.job ?? null) : null"
          @open-boost-alert="openBoostAlert"
          @retry-score-load="retryScoreCalculation()"
        />
      </div>

      <details
        v-if="showScoreContent(profile)"
        class="character-page__boost-disclosure"
        data-testid="boost-suspicion-collapse"
      >
        <summary>Boost suspicion</summary>
        <BoostSuspicionSection
          :assessment="profile.boostAssessment ?? null"
          :locked="!entitlements.detailsUnlocked"
        />
      </details>

      <ScoreHistorySection
        v-if="showScoreContent(profile)"
        :identity="currentIdentity()"
        :score-calculated-at="profile.score?.calculatedAt ?? null"
      />

      <DimensionCards
        v-if="showScoreContent(profile) && profile.score"
        :dimensions="visibleDimensions"
        :model-version="profile.score.modelVersion"
        :locked="!entitlements.detailsUnlocked"
        :performance-summary="profile.performanceSummary"
        :run-selection="profile.scoringRunSelection ?? null"
        :selected-run-details="profile.selectedRuns"
        :canonical-dungeon-evidence="profile.canonicalDungeonEvidence"
        :survival-summary="profile.survivalSummary"
        :boost-run-evidence="profile.boostAssessment?.runEvidence"
        :runs-locked="!entitlements.runsUnlocked"
        @open-run="selectedDrawerRun = $event"
      />

      <MethodologyPanel v-if="showScoreContent(profile)" :profile="profile" />
    </template>

    <BoostSuspicionAlertDialog
      :open="boostAlertOpen"
      :assessment="profile?.boostAssessment ?? null"
      @close="closeBoostAlert"
    />
    <RunDetailsDrawer
      :open="Boolean(selectedDrawerRun)"
      :run="selectedDrawerRun"
      :grade="grade"
      @close="selectedDrawerRun = null"
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

.character-page__hero--score-loading {
  /* Reserve portrait overflow space so media cannot cover loading content. */
  min-height: min(62dvh, 32rem);
  padding-bottom: var(--space-4);
}

@media (min-width: 768px) {
  .character-page__hero--score-loading {
    min-height: min(70dvh, 38rem);
  }
}

@media (min-width: 1100px) {
  .character-page__hero--score-loading {
    min-height: min(74dvh, 44rem);
  }
}

.character-page__loading {
  margin: var(--space-6) 0;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
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
</style>
