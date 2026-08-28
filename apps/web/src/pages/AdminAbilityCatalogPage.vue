<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { useRoute, useRouter } from "vue-router";
import { DRAFT_ABILITY_CATEGORIES, type AdminAbilityEntry } from "@mplus/abilities";
import { api } from "../api/client";
import type { AdminAbilityCatalogResponse } from "../api/types";
import type { ManualCatalogEditSummary } from "../api/types";
import StatusBanner from "../components/common/StatusBanner.vue";
import DisclosureChevron from "../components/ability-catalog/DisclosureChevron.vue";
import IconSelect from "../components/ability-catalog/IconSelect.vue";
import type { IconSelectOption } from "../components/ability-catalog/IconSelect.vue";
import ValidationIssuesPanel from "../components/ability-catalog/ValidationIssuesPanel.vue";
import AbilityCard from "../components/ability-catalog/AbilityCard.vue";
import AbilityCatalogManualEditModal from "../components/ability-catalog/AbilityCatalogManualEditModal.vue";
import WowIcon from "../components/ability-catalog/WowIcon.vue";
import { loadWowheadTooltipScript, refreshWowheadTooltips } from "../integrations/wowhead/tooltips";
import { classIconName, filterOptionIconName, specIconName } from "../lib/wowIcons";

const CATEGORY_OPTIONS = DRAFT_ABILITY_CATEGORIES;

const ROLE_OPTIONS = ["DPS", "TANK", "HEALER"] as const;
const OWNERSHIP_OPTIONS = ["PLAYER", "PET", "GUARDIAN", "ANY_OWNED"] as const;
const AVAILABILITY_OPTIONS = [
  "BASELINE",
  "TALENT",
  "PET_DEPENDENT",
  "FORM_DEPENDENT",
  "CHOICE_NODE",
  "SHARED",
] as const;

const VALIDATION_PRESETS = [
  { value: "", label: "Any validation" },
  { value: "error", label: "Has errors" },
  { value: "uncertain", label: "Uncertain" },
  { value: "talent", label: "Talent-dependent" },
  { value: "pet", label: "Pet-dependent" },
  { value: "missing-metadata", label: "Missing metadata" },
] as const;

interface SpecGroup {
  key: string;
  classSlug: string;
  specSlug: string;
  specName: string;
  iconName: string | null;
  entries: AdminAbilityEntry[];
}

interface ClassSection {
  key: string;
  classSlug: string;
  className: string;
  iconName: string | null;
  specGroups: SpecGroup[];
}

interface SharedSection {
  key: string;
  title: string;
  entries: AdminAbilityEntry[];
}

const props = withDefaults(
  defineProps<{
    /** When true, hide page chrome (used inside Ability catalog console tabs). */
    embedded?: boolean;
  }>(),
  { embedded: false },
);

// TODO before production: protect `/admin/ability-catalog` with the future admin auth system.
const catalog = ref<AdminAbilityCatalogResponse | null>(null);
const workflow = ref<Record<string, unknown> | null>(null);
const workflowLoading = ref(false);
const workflowError = ref<string | null>(null);
const workflowNotice = ref<string | null>(null);
const refreshBusy = ref(false);
const loading = ref(false);
const error = ref<string | null>(null);
const searchInput = ref("");
const debouncedQuery = ref("");
const classSlug = ref("");
const role = ref("");
const category = ref("");
const ownership = ref("");
const availability = ref("");
const validationState = ref("");
const page = ref(1);
const limit = ref(50);

const expandedClasses = ref<Set<string>>(new Set());
const expandedSpecs = ref<Set<string>>(new Set());
const expandedShared = ref<Set<string>>(new Set());
const manualEdits = ref<ManualCatalogEditSummary[]>([]);
const manualEditOpen = ref(false);
const manualEditCanonicalKey = ref("");

const manualEditsByKey = computed(() => {
  const map: Record<string, ManualCatalogEditSummary> = {};
  for (const edit of manualEdits.value) map[edit.canonicalKey] = edit;
  return map;
});

async function loadManualEdits(): Promise<void> {
  try {
    const result = await api.listManualCatalogEdits();
    manualEdits.value = result.edits;
  } catch {
    manualEdits.value = [];
  }
}

function openManualEdit(canonicalKey: string): void {
  manualEditCanonicalKey.value = canonicalKey;
  manualEditOpen.value = true;
}

async function discardManualEdit(canonicalKey: string): Promise<void> {
  if (!window.confirm("Discard pending manual edit for this rule?")) return;
  try {
    await api.discardManualCatalogEdit(canonicalKey);
    await loadManualEdits();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to discard manual edit";
  }
}

async function excludeFromMplus(canonicalKey: string): Promise<void> {
  if (
    !window.confirm(
      "Exclude this ability from M+ Trust Factor scoring? It will be omitted from the next published catalog release.",
    )
  ) {
    return;
  }
  try {
    await api.createAbilityCatalogExclusion({ canonicalKey });
    error.value = null;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to exclude ability";
  }
}

async function onManualEditSaved(): Promise<void> {
  await loadManualEdits();
}

const route = useRoute();
const router = useRouter();

let searchTimer: ReturnType<typeof setTimeout> | null = null;
let loadAbort: AbortController | null = null;
let syncingRoute = false;

function readQueryParam(key: string): string {
  const raw = route.query[key];
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && typeof raw[0] === "string") return raw[0];
  return "";
}

function applyRouteQuery(): void {
  searchInput.value = readQueryParam("query");
  debouncedQuery.value = searchInput.value;
  classSlug.value = readQueryParam("classSlug");
  role.value = readQueryParam("role");
  category.value = readQueryParam("category");
  ownership.value = readQueryParam("ownership");
  availability.value = readQueryParam("availability");
  validationState.value = readQueryParam("validationState");
  const pageRaw = readQueryParam("page");
  page.value = pageRaw ? Math.max(1, Number(pageRaw) || 1) : 1;
  const limitRaw = readQueryParam("limit");
  limit.value = limitRaw ? Math.min(200, Math.max(1, Number(limitRaw) || 50)) : 50;
}

function buildRouteQuery(): Record<string, string> {
  const q: Record<string, string> = {};
  if (debouncedQuery.value.trim()) q.query = debouncedQuery.value.trim();
  if (classSlug.value) q.classSlug = classSlug.value;
  if (role.value) q.role = role.value;
  if (category.value) q.category = category.value;
  if (ownership.value) q.ownership = ownership.value;
  if (availability.value) q.availability = availability.value;
  if (validationState.value) q.validationState = validationState.value;
  if (page.value > 1) q.page = String(page.value);
  if (limit.value !== 50) q.limit = String(limit.value);
  return q;
}

async function syncRouteQuery(): Promise<void> {
  syncingRoute = true;
  await router.replace({ query: buildRouteQuery() });
  syncingRoute = false;
}

function requestParams(): Record<string, string | number | undefined> {
  return {
    query: debouncedQuery.value.trim() || undefined,
    classSlug: classSlug.value || undefined,
    role: role.value || undefined,
    category: category.value || undefined,
    ownership: ownership.value || undefined,
    availability: availability.value || undefined,
    validationState: validationState.value || undefined,
    page: page.value,
    limit: limit.value,
  };
}

async function loadCatalog(): Promise<void> {
  loadAbort?.abort();
  loadAbort = new AbortController();
  loading.value = true;
  error.value = null;
  try {
    catalog.value = await api.getAdminAbilityCatalog(requestParams(), loadAbort.signal);
    collapseAll();
    await nextTick();
    refreshWowheadTooltips();
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    error.value = (err as Error).message;
  } finally {
    loading.value = false;
  }
}

function collapseAll(): void {
  expandedClasses.value = new Set();
  expandedSpecs.value = new Set();
  expandedShared.value = new Set();
}

function resetPageAndLoad(): void {
  page.value = 1;
  void syncRouteQuery().then(loadCatalog);
}

function onFilterChange(): void {
  resetPageAndLoad();
}

function onPageChange(next: number): void {
  if (!catalog.value) return;
  const totalPages = catalog.value.pagination.totalPages;
  page.value = Math.min(Math.max(1, next), totalPages);
  void syncRouteQuery().then(loadCatalog);
}

function toggleClass(key: string): void {
  const next = new Set(expandedClasses.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  expandedClasses.value = next;
}

function toggleSpec(key: string): void {
  const next = new Set(expandedSpecs.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  expandedSpecs.value = next;
}

function toggleShared(key: string): void {
  const next = new Set(expandedShared.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  expandedShared.value = next;
}

function scrollToAbility(canonicalKey: string | undefined): void {
  if (!canonicalKey) return;

  for (const section of classSections.value) {
    for (const group of section.specGroups) {
      if (group.entries.some((e) => e.rule.canonicalKey === canonicalKey)) {
        expandedClasses.value = new Set(expandedClasses.value).add(section.key);
        expandedSpecs.value = new Set(expandedSpecs.value).add(group.key);
        break;
      }
    }
  }
  for (const section of sharedSections.value) {
    if (section.entries.some((e) => e.rule.canonicalKey === canonicalKey)) {
      expandedShared.value = new Set(expandedShared.value).add(section.key);
      break;
    }
  }

  void nextTick(() => {
    const el = document.getElementById(`ability-${canonicalKey}`);
    if (!el) return;
    const details = el.querySelector("details.ability-card");
    if (details instanceof HTMLDetailsElement) details.open = true;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

const classSections = computed((): ClassSection[] => {
  if (!catalog.value) return [];
  const entries = catalog.value.entries.filter((e: AdminAbilityEntry) => e.section === "class");
  const byClass = new Map<string, AdminAbilityEntry[]>();
  for (const entry of entries) {
    const slug = entry.rule.classSlug ?? "unknown";
    const list = byClass.get(slug) ?? [];
    list.push(entry);
    byClass.set(slug, list);
  }

  const sections: ClassSection[] = [];
  for (const cls of catalog.value.classes) {
    const classEntries = byClass.get(cls.classSlug);
    if (!classEntries?.length) continue;

    const specs = catalog.value.coverageSummary.specs.filter(
      (s: { classSlug: string }) => s.classSlug === cls.classSlug,
    );
    const specGroups: SpecGroup[] = [];
    const assigned = new Set<string>();

    for (const spec of specs) {
      const matched = classEntries.filter(
        (e) =>
          e.rule.specSlugs.includes(spec.specSlug) ||
          (e.rule.specSlugs.length === 0 && e.rule.sharedAcrossSpecs),
      );
      for (const e of matched) assigned.add(e.rule.canonicalKey);
      if (matched.length) {
        specGroups.push({
          key: `${cls.classSlug}:${spec.specSlug}`,
          classSlug: cls.classSlug,
          specSlug: spec.specSlug,
          specName: spec.specName,
          iconName: specIconName(cls.classSlug, spec.specSlug),
          entries: matched,
        });
      }
    }

    const classWide = classEntries.filter((e) => !assigned.has(e.rule.canonicalKey));
    if (classWide.length) {
      specGroups.unshift({
        key: `${cls.classSlug}:all-specs`,
        classSlug: cls.classSlug,
        specSlug: "",
        specName: "All specs",
        iconName: classIconName(cls.classSlug),
        entries: classWide,
      });
    }

    sections.push({
      key: cls.classSlug,
      classSlug: cls.classSlug,
      className: cls.className,
      iconName: classIconName(cls.classSlug),
      specGroups,
    });
  }

  return sections;
});

const sharedSections = computed((): SharedSection[] => {
  if (!catalog.value) return [];
  const groups: Array<{ key: string; title: string; kind: AdminAbilityEntry["section"] }> = [
    { key: "shared-consumable", title: "Shared consumables", kind: "shared-consumable" },
    { key: "shared-racial", title: "Shared racials", kind: "shared-racial" },
    { key: "shared-other", title: "Shared other", kind: "shared-other" },
  ];
  return groups
    .map(({ key, title, kind }) => ({
      key,
      title,
      entries: catalog.value!.entries.filter((e: AdminAbilityEntry) => e.section === kind),
    }))
    .filter((s) => s.entries.length > 0);
});

const hasResults = computed(
  () =>
    (catalog.value?.entries.length ?? 0) > 0 ||
    classSections.value.length > 0 ||
    sharedSections.value.length > 0,
);

const classFilterOptions = computed((): IconSelectOption[] =>
  (catalog.value?.classes ?? []).map((cls) => ({
    value: cls.classSlug,
    label: cls.className,
    iconName: filterOptionIconName("class", cls.classSlug),
  })),
);

const roleFilterOptions = computed((): IconSelectOption[] =>
  ROLE_OPTIONS.map((r) => ({
    value: r,
    label: r,
    iconName: filterOptionIconName("role", r),
  })),
);

watch(searchInput, (val) => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    debouncedQuery.value = val;
    resetPageAndLoad();
  }, 250);
});

watch(
  () => route.query,
  () => {
    if (syncingRoute) return;
    applyRouteQuery();
    void loadCatalog();
  },
);

async function loadWorkflow(): Promise<void> {
  workflowLoading.value = true;
  workflowError.value = null;
  try {
    workflow.value = await api.getAbilityCatalogWorkflow();
  } catch (err) {
    workflowError.value = err instanceof Error ? err.message : "Failed to load workflow status";
  } finally {
    workflowLoading.value = false;
  }
}

async function refreshCatalog(): Promise<void> {
  if (refreshBusy.value) return;
  if (!window.confirm("Run pinned SimC + Blizzard catalog refresh? ACTIVE release stays unchanged until you activate.")) {
    return;
  }
  refreshBusy.value = true;
  workflowNotice.value = null;
  workflowError.value = null;
  try {
    const result = await api.refreshAbilityCatalog();
    workflowNotice.value =
      typeof result.notice === "string"
        ? result.notice
        : "Refresh complete — see review batch for actionable items.";
    await loadWorkflow();
  } catch (err) {
    workflowError.value = err instanceof Error ? err.message : "Catalog refresh failed";
  } finally {
    refreshBusy.value = false;
  }
}

const workflowState = computed(() => String(workflow.value?.state ?? "IDLE"));
const workflowActive = computed(() => workflow.value?.active as Record<string, unknown> | null);
const workflowRefresh = computed(() => workflow.value?.refresh as Record<string, unknown> | null);
const workflowReview = computed(() => workflow.value?.review as Record<string, unknown> | null);
const workflowRelease = computed(() => workflow.value?.release as Record<string, unknown> | null);

onMounted(() => {
  applyRouteQuery();
  void loadCatalog();
  void loadWorkflow();
  void loadManualEdits();
  void loadWowheadTooltipScript().catch(() => {
    /* progressive enhancement */
  });
});
</script>

<template>
  <!-- TODO before production: protect this page with the future admin authentication/authorization system. -->
  <section
    class="catalog-page"
    :class="{ 'catalog-page--embedded': props.embedded }"
    data-testid="ability-catalog-page"
  >
    <header v-if="!props.embedded" class="catalog-page__header">
      <h1>Ability catalog</h1>
      <p class="muted">
        Catalog control center — active release, refresh, review, and activation. New analyses always
        pin the ACTIVE immutable release.
      </p>
    </header>

    <StatusBanner v-if="workflowError" tone="error">{{ workflowError }}</StatusBanner>
    <StatusBanner v-if="workflowNotice" tone="info">{{ workflowNotice }}</StatusBanner>
    <StatusBanner v-if="error" tone="error">{{ error }}</StatusBanner>

    <section v-if="!workflowLoading" class="workflow-panel" data-testid="catalog-workflow">
      <div class="workflow-header">
        <strong>State: {{ workflowState }}</strong>
        <button type="button" class="btn" :disabled="refreshBusy" @click="refreshCatalog">
          {{ refreshBusy ? "Refreshing…" : "Refresh catalog" }}
        </button>
      </div>
      <div class="workflow-grid">
        <div>
          <h2>Active catalog</h2>
          <p v-if="workflowActive">
            <code>{{ workflowActive.releaseKey }}</code>
            <span class="muted"> · build {{ workflowActive.wowBuild ?? "—" }}</span><br />
            <span class="muted">digest {{ workflowActive.contentDigestShort }} · {{ workflowActive.ruleCount }} rules</span>
          </p>
          <p v-else class="muted">No ACTIVE release — activate Bootstrap before running analyses.</p>
        </div>
        <div>
          <h2>Refresh</h2>
          <p class="muted">
            SimC {{ workflowRefresh?.simcApplicationVersion ?? "—" }} · rev
            {{
              typeof workflowRefresh?.simcRevision === "string"
                ? String(workflowRefresh.simcRevision).slice(0, 12)
                : "—"
            }}
            <span v-if="workflowRefresh?.simcRevisionPrecision" class="muted">
              ({{ workflowRefresh.simcRevisionPrecision }})
            </span>
            · build {{ workflowRefresh?.wowBuild ?? "—" }} ·
            {{ workflowRefresh?.simcDataMode ?? "—" }} · changes
            {{ workflowRefresh?.changesDetected ?? 0 }} · pending
            {{ workflowRefresh?.pendingReviewCount ?? 0 }}
          </p>
        </div>
        <div>
          <h2>Review</h2>
          <p>
            <RouterLink
              :to="
                typeof workflowReview?.reviewUrl === 'string'
                  ? workflowReview.reviewUrl
                  : { name: 'admin-ability-catalog', params: { tab: 'review' } }
              "
            >
              Open review queue
            </RouterLink>
            <span class="muted"> · pending {{ workflowReview?.pendingItems ?? 0 }}</span>
          </p>
        </div>
        <div>
          <h2>Release</h2>
          <p v-if="workflowRelease?.candidateReleaseKey">
            Candidate <code>{{ workflowRelease.candidateReleaseKey }}</code>
            <span class="muted">
              · validation {{ workflowRelease.validationStatus ?? "—" }} · replay
              {{ workflowRelease.replayStatus ?? "—" }}
            </span>
          </p>
          <p v-else class="muted">No validated candidate ready.</p>
          <p v-if="workflowRelease?.canActivate">
            <RouterLink :to="{ name: 'admin-ability-catalog', params: { tab: 'releases' } }">
              Activate catalog →
            </RouterLink>
          </p>
        </div>
      </div>
    </section>

    <h2 class="explorer-heading">Catalog explorer</h2>

    <ValidationIssuesPanel
      v-if="catalog && catalog.validationSummary.issues.length"
      :issues="catalog.validationSummary.issues"
      @select="scrollToAbility"
    />

    <div class="sticky-bar" data-testid="catalog-sticky-bar">
      <div class="search-row">
        <label class="search-label">
          Search
          <input
            v-model="searchInput"
            type="search"
            placeholder="Name, spell ID, canonical key…"
            data-testid="catalog-search"
            autocomplete="off"
          />
        </label>
      </div>

      <div class="filters" data-testid="catalog-filters">
        <IconSelect
          id="catalog-filter-class"
          v-model="classSlug"
          :options="classFilterOptions"
          label="Class"
          empty-label="All classes"
          data-testid="class-filter"
          @change="onFilterChange"
        />
        <IconSelect
          id="catalog-filter-role"
          v-model="role"
          :options="roleFilterOptions"
          label="Role"
          empty-label="Any role"
          data-testid="role-filter"
          @change="onFilterChange"
        />
        <label>
          Category
          <select v-model="category" data-testid="category-filter" @change="onFilterChange">
            <option value="">Any category</option>
            <option v-for="c in CATEGORY_OPTIONS" :key="c" :value="c">{{ c }}</option>
          </select>
        </label>
        <label>
          Ownership
          <select v-model="ownership" @change="onFilterChange">
            <option value="">Any ownership</option>
            <option v-for="o in OWNERSHIP_OPTIONS" :key="o" :value="o">{{ o }}</option>
          </select>
        </label>
        <label>
          Availability
          <select v-model="availability" @change="onFilterChange">
            <option value="">Any availability</option>
            <option v-for="a in AVAILABILITY_OPTIONS" :key="a" :value="a">{{ a }}</option>
          </select>
        </label>
        <label>
          Validation
          <select v-model="validationState" data-testid="validation-filter" @change="onFilterChange">
            <option v-for="preset in VALIDATION_PRESETS" :key="preset.value" :value="preset.value">
              {{ preset.label }}
            </option>
          </select>
        </label>
      </div>
    </div>

    <p v-if="loading" class="muted loading-hint">Loading catalog…</p>

    <div v-else-if="catalog && !hasResults" class="empty-state" data-testid="empty-state">
      <p>No abilities match the current search and filters.</p>
    </div>

    <div v-else-if="catalog" class="catalog-body">
      <section
        v-for="section in classSections"
        :key="section.key"
        class="class-section"
        data-testid="class-section"
        :data-class-slug="section.classSlug"
      >
        <button
          type="button"
          class="section-toggle"
          :aria-expanded="expandedClasses.has(section.key) ? 'true' : 'false'"
          :aria-label="`${section.className}, ${section.specGroups.reduce((n, g) => n + g.entries.length, 0)} abilities`"
          @click="toggleClass(section.key)"
        >
          <WowIcon
            v-if="section.iconName"
            :icon-name="section.iconName"
            :alt="''"
            :width="24"
            :height="24"
            class="class-icon"
          />
          <span v-else class="class-icon-fallback" aria-hidden="true" />
          <span class="section-heading">
            <span class="section-title">{{ section.className }}</span>
            <span class="section-count">{{
              section.specGroups.reduce((n, g) => n + g.entries.length, 0)
            }}</span>
          </span>
          <DisclosureChevron :expanded="expandedClasses.has(section.key)" />
        </button>

        <div v-if="expandedClasses.has(section.key)" class="spec-list">
          <div v-for="group in section.specGroups" :key="group.key" class="spec-group">
            <button
              type="button"
              class="spec-toggle"
              :aria-expanded="expandedSpecs.has(group.key) ? 'true' : 'false'"
              :aria-label="`${group.specName}, ${group.entries.length} abilities`"
              @click="toggleSpec(group.key)"
            >
              <WowIcon
                v-if="group.iconName"
                :icon-name="group.iconName"
                :alt="''"
                :width="20"
                :height="20"
                class="spec-icon"
              />
              <span v-else class="spec-icon-fallback" aria-hidden="true" />
              <span class="section-heading">
                <span class="section-title">{{ group.specName }}</span>
                <span class="section-count">{{ group.entries.length }}</span>
              </span>
              <DisclosureChevron :expanded="expandedSpecs.has(group.key)" />
            </button>

            <div v-if="expandedSpecs.has(group.key)" class="ability-list">
              <article
                v-for="entry in group.entries"
                :id="`ability-${entry.rule.canonicalKey}`"
                :key="entry.rule.canonicalKey"
                class="ability-row"
                data-testid="ability-row"
                tabindex="-1"
              >
                <AbilityCard
                  :entry="entry"
                  :pending-manual-edit="manualEditsByKey[entry.rule.canonicalKey] ?? null"
                  @edit="openManualEdit(entry.rule.canonicalKey)"
                  @edit-draft="openManualEdit(entry.rule.canonicalKey)"
                  @discard-edit="discardManualEdit(entry.rule.canonicalKey)"
                  @exclude="excludeFromMplus(entry.rule.canonicalKey)"
                />
              </article>
            </div>
          </div>
        </div>
      </section>

      <section
        v-for="section in sharedSections"
        :key="section.key"
        class="class-section shared-section"
        data-testid="class-section"
        :data-section="section.key"
      >
        <button
          type="button"
          class="section-toggle"
          :aria-expanded="expandedShared.has(section.key) ? 'true' : 'false'"
          :aria-label="`${section.title}, ${section.entries.length} abilities`"
          @click="toggleShared(section.key)"
        >
          <span class="section-heading">
            <span class="section-title">{{ section.title }}</span>
            <span class="section-count">{{ section.entries.length }}</span>
          </span>
          <DisclosureChevron :expanded="expandedShared.has(section.key)" />
        </button>

        <div v-if="expandedShared.has(section.key)" class="ability-list">
          <article
            v-for="entry in section.entries"
            :id="`ability-${entry.rule.canonicalKey}`"
            :key="entry.rule.canonicalKey"
            class="ability-row"
            data-testid="ability-row"
            tabindex="-1"
          >
            <AbilityCard
              :entry="entry"
              :pending-manual-edit="manualEditsByKey[entry.rule.canonicalKey] ?? null"
              @edit="openManualEdit(entry.rule.canonicalKey)"
              @edit-draft="openManualEdit(entry.rule.canonicalKey)"
              @discard-edit="discardManualEdit(entry.rule.canonicalKey)"
              @exclude="excludeFromMplus(entry.rule.canonicalKey)"
            />
          </article>
        </div>
      </section>

      <nav v-if="catalog.pagination.totalPages > 1" class="pagination" aria-label="Catalog pagination">
        <button
          type="button"
          class="btn"
          :disabled="catalog.pagination.page <= 1"
          @click="onPageChange(catalog.pagination.page - 1)"
        >
          Previous
        </button>
        <span class="page-info">
          Page {{ catalog.pagination.page }} of {{ catalog.pagination.totalPages }}
          ({{ catalog.pagination.total }} abilities)
        </span>
        <button
          type="button"
          class="btn"
          :disabled="catalog.pagination.page >= catalog.pagination.totalPages"
          @click="onPageChange(catalog.pagination.page + 1)"
        >
          Next
        </button>
      </nav>
    </div>

    <AbilityCatalogManualEditModal
      :open="manualEditOpen"
      :canonical-key="manualEditCanonicalKey"
      @close="manualEditOpen = false"
      @saved="onManualEditSaved"
    />
  </section>
</template>

<style scoped>
.muted {
  color: var(--muted);
}

.sticky-bar {
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  padding: var(--space-3) var(--space-4) var(--space-4);
  margin: 0 0 var(--space-4);
  overflow: visible;
}

.search-row,
.filters {
  display: grid;
  gap: var(--space-3);
}

.filters {
  grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
  align-items: end;
}

label,
.search-label {
  display: grid;
  gap: 0.25rem;
  font-weight: 600;
  font-size: 0.85rem;
}

input,
select {
  font: inherit;
  padding: 0.45rem 0.6rem;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--panel-2);
  color: var(--fg);
  min-width: 0;
}

input:focus-visible,
select:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.loading-hint {
  padding: 1rem 0;
}

.empty-state {
  border: 1px dashed var(--border);
  border-radius: 8px;
  padding: 2rem 1rem;
  text-align: center;
  color: var(--muted);
}

.catalog-body {
  display: grid;
  gap: 0.75rem;
  min-width: 0;
}

.class-section {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  overflow: visible;
  min-width: 0;
  padding: 0.35rem 0.65rem 0.5rem;
}

.section-toggle,
.spec-toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.45rem 0.2rem;
  border: none;
  background: transparent;
  color: var(--fg);
  font: inherit;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.section-toggle:focus-visible,
.spec-toggle:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  z-index: 1;
  position: relative;
  border-radius: 4px;
}

.spec-toggle {
  padding-left: 0.35rem;
  font-weight: 500;
}

.class-icon,
.class-icon-fallback,
.spec-icon,
.spec-icon-fallback {
  width: 24px;
  height: 24px;
  border-radius: 4px;
  flex-shrink: 0;
}

.spec-icon,
.spec-icon-fallback {
  width: 20px;
  height: 20px;
}

.class-icon-fallback,
.spec-icon-fallback {
  background: var(--border);
}

.section-heading {
  display: inline-flex;
  align-items: baseline;
  gap: 0.45rem;
  flex: 1;
  min-width: 0;
}

.workflow-panel {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: var(--space-4);
  margin-bottom: var(--space-4);
}

.workflow-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}

.workflow-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  gap: var(--space-3);
}

.workflow-grid h2 {
  font-size: 0.95rem;
  margin: 0 0 0.35rem;
}

.explorer-heading {
  margin-top: var(--space-4);
}

.btn {
  padding: 0.35rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  cursor: pointer;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.section-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.section-count {
  color: var(--muted);
  font-size: 0.85rem;
  font-weight: 500;
  flex-shrink: 0;
}

.spec-list {
  display: grid;
  gap: 0.15rem;
  padding-left: 0.5rem;
  min-width: 0;
}

.ability-list {
  display: grid;
  gap: 0.35rem;
  padding: 0.25rem 0 0.5rem 0.35rem;
  min-width: 0;
}

.ability-row {
  min-width: 0;
  scroll-margin-top: 6rem;
}

.ability-row:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 8px;
}

.pagination {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem 0;
}

.page-info {
  color: var(--muted);
  font-size: 0.9rem;
}

@media (max-width: 767px) {
  .sticky-bar {
    padding-left: var(--space-3);
    padding-right: var(--space-3);
  }

  .filters {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
