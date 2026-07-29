<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { AdminAbilityEntry } from "@mplus/abilities";
import { api } from "../api/client";
import type { AdminAbilityCatalogResponse } from "../api/types";
import StatusBanner from "../components/common/StatusBanner.vue";
import { loadWowheadTooltipScript, refreshWowheadTooltips } from "../integrations/wowhead/tooltips";
import { wowheadSpellUrl } from "../integrations/wowhead/urls";
import { classIconUrl } from "../lib/wowClass";

const SPELL_ICON_FALLBACK =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 56"><rect width="56" height="56" fill="#3a3a42" rx="4"/></svg>',
  );

const CATEGORY_OPTIONS = [
  "INTERRUPT",
  "HARD_CC",
  "SOFT_CC",
  "DISPEL",
  "PURGE",
  "DEFENSIVE_MAJOR",
  "DEFENSIVE_MINOR",
  "IMMUNITY",
  "SELF_HEAL",
  "EXTERNAL_DEFENSIVE",
  "GROUP_UTILITY",
  "MOVEMENT_UTILITY",
  "BATTLE_REZ",
  "BLOODLUST",
  "CONSUMABLE",
] as const;

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
  specSlug: string;
  specName: string;
  entries: AdminAbilityEntry[];
}

interface ClassSection {
  key: string;
  classSlug: string;
  className: string;
  iconUrl: string | null;
  specGroups: SpecGroup[];
}

interface SharedSection {
  key: string;
  title: string;
  entries: AdminAbilityEntry[];
}

// TODO before production: protect `/admin/ability-catalog` with the future admin auth system.
const catalog = ref<AdminAbilityCatalogResponse | null>(null);
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
    expandAllVisible();
    await nextTick();
    refreshWowheadTooltips();
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    error.value = (err as Error).message;
  } finally {
    loading.value = false;
  }
}

function expandAllVisible(): void {
  expandedClasses.value = new Set(classSections.value.map((s) => s.key));
  expandedSpecs.value = new Set(classSections.value.flatMap((s) => s.specGroups.map((g) => g.key)));
  expandedShared.value = new Set(sharedSections.value.map((s) => s.key));
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
  const el = document.getElementById(`ability-${canonicalKey}`);
  el?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function primarySpellId(entry: AdminAbilityEntry): number | null {
  return entry.rule.spellIds[0] ?? null;
}

function spellIconSrc(entry: AdminAbilityEntry): string {
  return entry.external.iconUrl ?? SPELL_ICON_FALLBACK;
}

function onIconError(event: Event): void {
  const img = event.target as HTMLImageElement;
  if (img.src !== SPELL_ICON_FALLBACK) {
    img.src = SPELL_ICON_FALLBACK;
  }
}

function badgeClass(badge: string): string {
  if (badge === "validation-error") return "badge badge-error";
  if (badge === "verified") return "badge badge-ok";
  if (badge === "uncertain") return "badge badge-warn";
  return "badge";
}

function formatCooldown(seconds: number | undefined): string {
  if (seconds == null) return "�";
  if (seconds >= 60) return `${Math.round(seconds / 60)}m`;
  return `${seconds}s`;
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
          specSlug: spec.specSlug,
          specName: spec.specName,
          entries: matched,
        });
      }
    }

    const classWide = classEntries.filter((e) => !assigned.has(e.rule.canonicalKey));
    if (classWide.length) {
      specGroups.unshift({
        key: `${cls.classSlug}:all-specs`,
        specSlug: "",
        specName: "All specs",
        entries: classWide,
      });
    }

    sections.push({
      key: cls.classSlug,
      classSlug: cls.classSlug,
      className: cls.className,
      iconUrl: classIconUrl(cls.classSlug),
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

const classFilterOptions = computed(() => catalog.value?.classes ?? []);

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

onMounted(() => {
  applyRouteQuery();
  void loadCatalog();
  void loadWowheadTooltipScript().catch(() => {
    /* progressive enhancement */
  });
});
</script>

<template>
  <!-- TODO before production: protect this page with the future admin authentication/authorization system. -->
  <section data-testid="ability-catalog-page">
    <h1>Ability catalog explorer</h1>
    <p class="muted">
      Read-only development view of the canonical retail ability registry - search, filter, and inspect
      validation coverage. Currently unprotected.
    </p>

      <StatusBanner v-if="error" tone="error">{{ error }}</StatusBanner>

      <div v-if="catalog" class="summary-grid" data-testid="catalog-summary">
        <article class="summary-card">
          <span class="summary-label">Catalog version</span>
          <strong>{{ catalog.catalogSummary.catalogVersion }}</strong>
        </article>
        <article class="summary-card">
          <span class="summary-label">Classes</span>
          <strong>{{ catalog.catalogSummary.classesCovered }}</strong>
        </article>
        <article class="summary-card">
          <span class="summary-label">Specs</span>
          <strong>{{ catalog.catalogSummary.specializationsCovered }}</strong>
        </article>
        <article class="summary-card">
          <span class="summary-label">Rules</span>
          <strong>{{ catalog.catalogSummary.canonicalRules }}</strong>
        </article>
        <article class="summary-card">
          <span class="summary-label">Spell IDs</span>
          <strong>{{ catalog.catalogSummary.spellIds }}</strong>
        </article>
        <article class="summary-card">
          <span class="summary-label">Aliases</span>
          <strong>{{ catalog.catalogSummary.aliases }}</strong>
        </article>
        <article class="summary-card" :class="{ 'has-errors': catalog.validationSummary.errorCount > 0 }">
          <span class="summary-label">Validation errors</span>
          <strong>{{ catalog.validationSummary.errorCount }}</strong>
        </article>
        <article class="summary-card">
          <span class="summary-label">Warnings</span>
          <strong>{{ catalog.validationSummary.warningCount }}</strong>
        </article>
      </div>

      <div
        v-if="catalog && catalog.validationSummary.issues.length"
        class="validation-panel"
        data-testid="validation-summary"
      >
        <h2>Validation issues</h2>
        <ul class="validation-list">
          <li v-for="(issue, idx) in catalog.validationSummary.issues.slice(0, 40)" :key="idx">
            <button
              type="button"
              class="btn link issue-link"
              :data-severity="issue.severity"
              @click="scrollToAbility(issue.canonicalKey)"
            >
              <span class="issue-severity">{{ issue.severity }}</span>
              {{ issue.message }}
              <span v-if="issue.canonicalKey" class="issue-key">({{ issue.canonicalKey }})</span>
            </button>
          </li>
        </ul>
        <p v-if="catalog.validationSummary.issues.length > 40" class="muted">
          Showing first 40 of {{ catalog.validationSummary.issues.length }} issues.
        </p>
      </div>

      <div class="sticky-bar">
        <div class="search-row">
          <label class="search-label">
            Search
            <input
              v-model="searchInput"
              type="search"
              placeholder="Name, spell ID, canonical key�"
              data-testid="catalog-search"
              autocomplete="off"
            />
          </label>
        </div>

        <div class="filters" data-testid="catalog-filters">
          <label>
            Class
            <select v-model="classSlug" @change="onFilterChange">
              <option value="">All classes</option>
              <option v-for="cls in classFilterOptions" :key="cls.classSlug" :value="cls.classSlug">
                {{ cls.className }}
              </option>
            </select>
          </label>
          <label>
            Role
            <select v-model="role" @change="onFilterChange">
              <option value="">Any role</option>
              <option v-for="r in ROLE_OPTIONS" :key="r" :value="r">{{ r }}</option>
            </select>
          </label>
          <label>
            Category
            <select v-model="category" @change="onFilterChange">
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
            <select v-model="validationState" @change="onFilterChange">
              <option v-for="preset in VALIDATION_PRESETS" :key="preset.value" :value="preset.value">
                {{ preset.label }}
              </option>
            </select>
          </label>
        </div>
      </div>

      <p v-if="loading" class="muted loading-hint">Loading catalog�</p>

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
          <button type="button" class="section-toggle" @click="toggleClass(section.key)">
            <img
              v-if="section.iconUrl"
              :src="section.iconUrl"
              :alt="`${section.className} icon`"
              class="class-icon"
              width="24"
              height="24"
              loading="lazy"
            />
            <span v-else class="class-icon-fallback" aria-hidden="true" />
            <span class="section-title">{{ section.className }}</span>
            <span class="section-count">{{
              section.specGroups.reduce((n, g) => n + g.entries.length, 0)
            }}</span>
            <span class="chevron" :data-expanded="expandedClasses.has(section.key) ? 'true' : 'false'">?</span>
          </button>

          <div v-if="expandedClasses.has(section.key)" class="spec-list">
            <div v-for="group in section.specGroups" :key="group.key" class="spec-group">
              <button type="button" class="spec-toggle" @click="toggleSpec(group.key)">
                <span>{{ group.specName }}</span>
                <span class="section-count">{{ group.entries.length }}</span>
                <span class="chevron" :data-expanded="expandedSpecs.has(group.key) ? 'true' : 'false'">?</span>
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
                  <div class="ability-card">
                    <img
                      :src="spellIconSrc(entry)"
                      :alt="`${entry.rule.name} icon`"
                      class="spell-icon"
                      width="40"
                      height="40"
                      loading="lazy"
                      @error="onIconError"
                    />
                    <div class="ability-main">
                      <div class="ability-header">
                        <h3 class="ability-name">{{ entry.rule.name }}</h3>
                        <div class="badges">
                          <span v-for="badge in entry.badges" :key="badge" :class="badgeClass(badge)">{{
                            badge
                          }}</span>
                        </div>
                      </div>
                      <dl class="ability-meta">
                        <div>
                          <dt>Spell ID</dt>
                          <dd>
                            <a
                              v-if="primarySpellId(entry) && wowheadSpellUrl(primarySpellId(entry)!)"
                              :href="wowheadSpellUrl(primarySpellId(entry)!)!"
                              target="_blank"
                              rel="noopener noreferrer"
                              :data-wowhead="`spell=${primarySpellId(entry)}`"
                              class="wowhead-link"
                            >
                              {{ primarySpellId(entry) }}
                            </a>
                            <span v-else>�</span>
                          </dd>
                        </div>
                        <div v-if="entry.rule.aliases?.length">
                          <dt>Aliases</dt>
                          <dd>{{ entry.rule.aliases.join(", ") }}</dd>
                        </div>
                        <div>
                          <dt>Key</dt>
                          <dd class="mono">{{ entry.rule.canonicalKey }}</dd>
                        </div>
                        <div>
                          <dt>Category</dt>
                          <dd>{{ entry.rule.category }}</dd>
                        </div>
                        <div>
                          <dt>Ownership</dt>
                          <dd>{{ entry.rule.sourceOwnership }}</dd>
                        </div>
                        <div>
                          <dt>Availability</dt>
                          <dd>{{ entry.rule.availability }}</dd>
                        </div>
                        <div>
                          <dt>Roles</dt>
                          <dd>{{ entry.rule.roles.join(", ") || "�" }}</dd>
                        </div>
                        <div>
                          <dt>Cooldown</dt>
                          <dd>{{ formatCooldown(entry.rule.cooldownSeconds) }}</dd>
                        </div>
                        <div>
                          <dt>Provenance</dt>
                          <dd>
                            {{ entry.rule.provenance.source }} � {{ entry.rule.provenance.gameVersion }}
                          </dd>
                        </div>
                      </dl>
                      <p v-if="entry.rule.provenance.notes" class="notes muted">
                        {{ entry.rule.provenance.notes }}
                      </p>
                      <ul v-if="entry.validationIssues.length" class="entry-issues">
                        <li
                          v-for="(issue, i) in entry.validationIssues"
                          :key="i"
                          :data-severity="issue.severity"
                        >
                          {{ issue.message }}
                        </li>
                      </ul>
                    </div>
                  </div>
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
          <button type="button" class="section-toggle" @click="toggleShared(section.key)">
            <span class="section-title">{{ section.title }}</span>
            <span class="section-count">{{ section.entries.length }}</span>
            <span class="chevron" :data-expanded="expandedShared.has(section.key) ? 'true' : 'false'">?</span>
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
              <div class="ability-card">
                <img
                  :src="spellIconSrc(entry)"
                  :alt="`${entry.rule.name} icon`"
                  class="spell-icon"
                  width="40"
                  height="40"
                  loading="lazy"
                  @error="onIconError"
                />
                <div class="ability-main">
                  <div class="ability-header">
                    <h3 class="ability-name">{{ entry.rule.name }}</h3>
                    <div class="badges">
                      <span v-for="badge in entry.badges" :key="badge" :class="badgeClass(badge)">{{
                        badge
                      }}</span>
                    </div>
                  </div>
                  <dl class="ability-meta">
                    <div>
                      <dt>Spell ID</dt>
                      <dd>
                        <a
                          v-if="primarySpellId(entry) && wowheadSpellUrl(primarySpellId(entry)!)"
                          :href="wowheadSpellUrl(primarySpellId(entry)!)!"
                          target="_blank"
                          rel="noopener noreferrer"
                          :data-wowhead="`spell=${primarySpellId(entry)}`"
                          class="wowhead-link"
                        >
                          {{ primarySpellId(entry) }}
                        </a>
                        <span v-else>�</span>
                      </dd>
                    </div>
                    <div v-if="entry.rule.aliases?.length">
                      <dt>Aliases</dt>
                      <dd>{{ entry.rule.aliases.join(", ") }}</dd>
                    </div>
                    <div>
                      <dt>Key</dt>
                      <dd class="mono">{{ entry.rule.canonicalKey }}</dd>
                    </div>
                    <div>
                      <dt>Category</dt>
                      <dd>{{ entry.rule.category }}</dd>
                    </div>
                    <div>
                      <dt>Ownership</dt>
                      <dd>{{ entry.rule.sourceOwnership }}</dd>
                    </div>
                    <div>
                      <dt>Availability</dt>
                      <dd>{{ entry.rule.availability }}</dd>
                    </div>
                    <div>
                      <dt>Roles</dt>
                      <dd>{{ entry.rule.roles.join(", ") || "�" }}</dd>
                    </div>
                    <div>
                      <dt>Cooldown</dt>
                      <dd>{{ formatCooldown(entry.rule.cooldownSeconds) }}</dd>
                    </div>
                    <div>
                      <dt>Provenance</dt>
                      <dd>{{ entry.rule.provenance.source }} � {{ entry.rule.provenance.gameVersion }}</dd>
                    </div>
                  </dl>
                  <p v-if="entry.rule.provenance.notes" class="notes muted">
                    {{ entry.rule.provenance.notes }}
                  </p>
                  <ul v-if="entry.validationIssues.length" class="entry-issues">
                    <li v-for="(issue, i) in entry.validationIssues" :key="i" :data-severity="issue.severity">
                      {{ issue.message }}
                    </li>
                  </ul>
                </div>
              </div>
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
  </section>
</template>

<style scoped>
.muted {
  color: var(--muted);
}

.error {
  color: var(--danger);
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
  gap: 0.65rem;
  margin: 1rem 0;
}

.summary-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.65rem 0.75rem;
  background: var(--panel);
  display: grid;
  gap: 0.2rem;
}

.summary-card.has-errors strong {
  color: var(--danger);
}

.summary-label {
  font-size: 0.75rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.validation-panel {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.85rem 1rem;
  background: var(--panel);
  margin-bottom: 1rem;
}

.validation-list {
  list-style: none;
  padding: 0;
  margin: 0.5rem 0 0;
  display: grid;
  gap: 0.35rem;
  max-height: 12rem;
  overflow-y: auto;
}

.issue-link {
  text-align: left;
  width: 100%;
  font-weight: 500;
}

.issue-severity {
  text-transform: uppercase;
  font-size: 0.7rem;
  font-weight: 700;
  margin-right: 0.35rem;
}

.issue-link[data-severity="error"] .issue-severity {
  color: var(--danger);
}

.issue-link[data-severity="warning"] .issue-severity {
  color: var(--warn);
}

.issue-key {
  color: var(--muted);
  font-size: 0.85em;
}

.sticky-bar {
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  padding: 0.75rem 0 1rem;
  margin-bottom: 1rem;
}

.search-row,
.filters {
  display: grid;
  gap: 0.65rem;
}

.filters {
  grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
}

label {
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
  overflow: hidden;
  min-width: 0;
}

.section-toggle,
.spec-toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.65rem 0.85rem;
  border: none;
  background: var(--panel-2);
  color: var(--fg);
  font: inherit;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.spec-toggle {
  padding-left: 1.5rem;
  background: var(--panel);
  border-top: 1px solid var(--border);
  font-weight: 500;
}

.class-icon,
.class-icon-fallback {
  width: 24px;
  height: 24px;
  border-radius: 4px;
  flex-shrink: 0;
}

.class-icon-fallback {
  background: var(--border);
}

.section-title {
  flex: 1;
  min-width: 0;
}

.section-count {
  color: var(--muted);
  font-size: 0.85rem;
}

.chevron {
  transition: transform 0.15s ease;
  color: var(--muted);
}

.chevron[data-expanded="true"] {
  transform: rotate(90deg);
}

.ability-list {
  display: grid;
  gap: 0.5rem;
  padding: 0.65rem;
  min-width: 0;
}

.ability-row {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-2);
  min-width: 0;
  scroll-margin-top: 6rem;
}

.ability-row:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.ability-card {
  display: flex;
  gap: 0.75rem;
  padding: 0.75rem;
  min-width: 0;
}

.spell-icon {
  width: 40px;
  height: 40px;
  border-radius: 4px;
  flex-shrink: 0;
  object-fit: cover;
  background: var(--border);
}

.ability-main {
  flex: 1;
  min-width: 0;
}

.ability-header {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.5rem;
  margin-bottom: 0.35rem;
}

.ability-name {
  margin: 0;
  font-size: 1rem;
}

.badges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.badge {
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  padding: 0.15rem 0.4rem;
  border-radius: 4px;
  background: var(--border);
  color: var(--muted);
}

.badge-ok {
  background: color-mix(in srgb, var(--ok) 25%, transparent);
  color: var(--ok);
}

.badge-warn {
  background: color-mix(in srgb, var(--warn) 25%, transparent);
  color: var(--warn);
}

.badge-error {
  background: color-mix(in srgb, var(--danger) 25%, transparent);
  color: var(--danger);
}

.ability-meta {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
  gap: 0.35rem 0.75rem;
  margin: 0;
  font-size: 0.85rem;
}

.ability-meta dt {
  color: var(--muted);
  font-weight: 600;
  font-size: 0.7rem;
  text-transform: uppercase;
}

.ability-meta dd {
  margin: 0;
  word-break: break-word;
}

.mono {
  font-family: ui-monospace, monospace;
  font-size: 0.8em;
}

.wowhead-link {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.wowhead-link:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.entry-issues {
  margin: 0.5rem 0 0;
  padding-left: 1.1rem;
  color: var(--danger);
  font-size: 0.85rem;
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
</style>
