<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import {
  DRAFT_ABILITY_CATEGORIES,
  DRAFT_AVAILABILITIES,
  RETAIL_CLASS_MATRIX,
  getAllRegisteredRules,
  dimensionTagsForRule,
  projectCurrentRuleBindings,
  type AbilityRule,
} from "@mplus/abilities";
import { api } from "../api/client";
import { ApiClientError } from "../api/live-client";
import type {
  AbilityCatalogReviewBatchSummary,
  AbilityCatalogReviewItemSummary,
} from "../api/types";
import StatusBanner from "../components/common/StatusBanner.vue";
import SpellWowIcon from "../components/ability-catalog/SpellWowIcon.vue";
import WowIcon from "../components/ability-catalog/WowIcon.vue";
import { loadWowheadTooltipScript, refreshWowheadTooltips } from "../integrations/wowhead/tooltips";
import { wowheadSpellUrl } from "../integrations/wowhead/urls";
import { classColor } from "../lib/wowClass";
import { classIconName, raceIconName, specIconName } from "../lib/wowIcons";

type BindingRow = { spellId: number; role: string };

const props = withDefaults(
  defineProps<{
    /** When true, hide page chrome (used inside Ability catalog console tabs). */
    embedded?: boolean;
  }>(),
  { embedded: false },
);

const error = ref<string | null>(null);
const loading = ref(true);
const saving = ref(false);
const batches = ref<AbilityCatalogReviewBatchSummary[]>([]);
const selectedBatchId = ref<string | null>(null);
const items = ref<AbilityCatalogReviewItemSummary[]>([]);
const selectedItemId = ref<string | null>(null);
const selectedItem = ref<AbilityCatalogReviewItemSummary | null>(null);
const decisionNote = ref("");
const changeDecisionOpen = ref(false);
const technicalOpen = ref(false);
const mobileShowDetail = ref(false);

const filters = ref({
  kind: "",
  decisionState: "pending",
  draftStatus: "",
  classSlug: "",
  specSlug: "",
  raceSlug: "",
  category: "",
  spellId: "",
  search: "",
});

const draftForm = ref({
  category: "",
  availability: "",
});

const KIND_LABELS: Record<string, string> = {
  NEW_ABILITY_CANDIDATE: "New ability",
  SPELL_BINDING_REVIEW: "Spell binding",
  TOPOLOGY_REVIEW: "Topology",
  REMOVAL_REVIEW: "Removal review",
};

const ELIGIBILITY_LABELS: Record<string, string> = {
  STRONG_REVIEW_CANDIDATE: "Strong evidence",
  WEAK_REVIEW_CANDIDATE: "Weak evidence",
  EXCLUDED_STRUCTURALLY: "Structurally excluded",
  UNCLASSIFIED: "Unclassified",
};

const DRAFT_STATUS_LABELS: Record<string, string> = {
  NEEDS_METADATA: "Incomplete",
  READY_FOR_PUBLISH_REVIEW: "Complete",
};

const DECISION_LABELS: Record<string, string> = {
  ACCEPT: "Accepted",
  ACCEPT_PROPOSED: "Accepted proposed",
  KEEP_CURRENT: "Kept current",
  REJECT: "Rejected",
  EXCLUDE: "Excluded",
  DEFER: "Deferred",
  CONFIRM_REMOVAL: "Removal confirmed",
};

const MPLUS_RELEVANCE_LABELS: Record<string, string> = {
  INCLUDED: "Included",
  EXCLUDED: "Excluded",
  UNCLASSIFIED: "Needs classification",
};

const BINDING_ROLE_LABELS: Record<string, string> = {
  PRIMARY_ACTIVATION: "Primary activation",
  CAST_ALIAS: "Cast alias",
  ACTIVATION_AURA: "Activation aura",
  STACK_AURA: "Stack aura",
  TRIGGERED_EFFECT: "Triggered effect",
  SUMMON: "Summon",
};

const selectedBatch = computed(() => batches.value.find((b) => b.id === selectedBatchId.value) ?? null);
const selectedIndex = computed(() =>
  selectedItemId.value ? items.value.findIndex((i) => i.id === selectedItemId.value) : -1,
);

const classOptions = computed(() =>
  RETAIL_CLASS_MATRIX.map((c) => ({ value: c.slug, label: c.name ?? c.slug })),
);
const categoryOptions = DRAFT_ABILITY_CATEGORIES.map((v) => ({ value: v, label: v }));
const availabilityOptions = DRAFT_AVAILABILITIES.map((v) => ({ value: v, label: v }));

const showReviewForm = computed(() => {
  const kind = selectedItem.value?.kind;
  return kind === "NEW_ABILITY_CANDIDATE" || kind === "SPELL_BINDING_REVIEW";
});

const showNewAbilityDecisionActions = computed(() => {
  if (selectedItem.value?.kind !== "NEW_ABILITY_CANDIDATE") return false;
  if (!selectedItem.value.decisionAction) return true;
  return changeDecisionOpen.value;
});

const isNewAbilityAccepted = computed(
  () =>
    selectedItem.value?.kind === "NEW_ABILITY_CANDIDATE" &&
    selectedItem.value.decisionAction === "ACCEPT",
);

const showBindingDecisionActions = computed(() => {
  if (selectedItem.value?.kind !== "SPELL_BINDING_REVIEW") return false;
  if (!selectedItem.value.decisionAction) return true;
  return changeDecisionOpen.value;
});

const batchKindSummary = computed(() => {
  const s = selectedBatch.value?.summaryCounts ?? {};
  return [
    { key: "new", label: "New", count: Number(s.newAbilityCandidates ?? 0) },
    { key: "bind", label: "Binding", count: Number(s.spellBindingReviews ?? 0) },
    { key: "topo", label: "Topology", count: Number(s.topologyReviews ?? 0) },
    { key: "rem", label: "Removal", count: Number(s.removalReviews ?? 0) },
  ].filter((row) => row.count > 0);
});

const batchProgressLine = computed(() => {
  const d = selectedBatch.value?.decisionCounts;
  if (!d) return "";
  const parts = [
    `${d.pending} pending`,
    `${d.accepted} accepted`,
    `${d.deferred} deferred`,
  ];
  if (d.rejected > 0) parts.push(`${d.rejected} rejected`);
  const kinds = batchKindSummary.value.map((row) => `${row.count} ${row.label.toLowerCase()}`);
  return [...parts, ...kinds].join(" · ");
});

const activeFilterChips = computed(() => {
  const chips: Array<{ key: keyof typeof filters.value; label: string }> = [];
  if (filters.value.search) chips.push({ key: "search", label: `Search: ${filters.value.search}` });
  if (filters.value.kind) chips.push({ key: "kind", label: kindLabel(filters.value.kind) });
  if (filters.value.classSlug) {
    chips.push({ key: "classSlug", label: classLabel(filters.value.classSlug) });
  }
  if (filters.value.decisionState && filters.value.decisionState !== "pending") {
    chips.push({
      key: "decisionState",
      label: `Status: ${filters.value.decisionState}`,
    });
  }
  if (filters.value.specSlug) chips.push({ key: "specSlug", label: `Spec: ${filters.value.specSlug}` });
  if (filters.value.raceSlug) chips.push({ key: "raceSlug", label: `Race: ${filters.value.raceSlug}` });
  if (filters.value.category) chips.push({ key: "category", label: filters.value.category });
  if (filters.value.spellId) chips.push({ key: "spellId", label: `Spell ${filters.value.spellId}` });
  if (filters.value.draftStatus) {
    chips.push({ key: "draftStatus", label: draftStatusLabel(filters.value.draftStatus) });
  }
  return chips;
});

const whyBullets = computed(() => {
  const item = selectedItem.value;
  if (!item) return [] as string[];
  const evidence = asRecord(item.evidence);
  const provenance = asRecord(item.sourceProvenance);
  const bullets: string[] = [];
  if (item.eligibilityState) {
    bullets.push(eligibilityLabel(item.eligibilityState));
  }
  const reasons = Array.isArray(evidence.eligibilityReasons)
    ? (evidence.eligibilityReasons as string[])
    : [];
  for (const reason of reasons) {
    bullets.push(humanizeToken(String(reason)));
  }
  if (item.classSlug) bullets.push(`Class: ${classLabel(item.classSlug)}`);
  if (item.specSlugs?.length) {
    bullets.push(`Specialization: ${item.specSlugs.map((s) => specLabel(item.classSlug, s)).join(", ")}`);
  }
  if (item.raceSlugs?.length) {
    bullets.push(`Race: ${item.raceSlugs.join(", ")}`);
  }
  const racial = asRecord(evidence.racialVariant);
  if (racial.validity) {
    bullets.push(`Variant validity: ${humanizeToken(String(racial.validity))}`);
  }
  if (Array.isArray(racial.currentRetailIds) && racial.currentRetailIds.length) {
    bullets.push(`Current Retail IDs: ${(racial.currentRetailIds as number[]).join(", ")}`);
  }
  if (Array.isArray(racial.ambiguousIds) && racial.ambiguousIds.length) {
    bullets.push(`Competing IDs (ambiguous validity): ${(racial.ambiguousIds as number[]).join(", ")}`);
  }
  if (Array.isArray(racial.historicalIdsExcluded) && racial.historicalIdsExcluded.length) {
    bullets.push(
      `Historical IDs excluded: ${(racial.historicalIdsExcluded as number[]).length} older variant(s)`,
    );
  }
  const source =
    typeof provenance.source === "string"
      ? provenance.source
      : Array.isArray(provenance.snapshots)
        ? "External sources"
        : null;
  if (source) bullets.push(`Source: ${humanizeToken(source)}`);
  if (item.kind === "NEW_ABILITY_CANDIDATE" && !item.matchedCanonicalKey) {
    bullets.push("Not present in the current catalog");
  }
  if (item.reviewReason) bullets.push(`Review reason: ${humanizeToken(item.reviewReason)}`);
  return [...new Set(bullets)];
});

const whyBlurb = computed(() => {
  const item = selectedItem.value;
  if (!item) return "";
  if (item.kind === "NEW_ABILITY_CANDIDATE") {
    const owner = itemOwnershipLine(item);
    const present = item.matchedCanonicalKey
      ? `it may need curation against ${item.matchedCanonicalKey}`
      : "it is not present in the current M+ Trust Factor catalog";
    return `External sources report this as ${owner || "an ability"}, but ${present}.`;
  }
  if (item.kind === "SPELL_BINDING_REVIEW") {
    return "Spell binding roles differ between the current catalog entry and the external source.";
  }
  if (item.kind === "TOPOLOGY_REVIEW") {
    return "An official playable topology identity appears in external sources but is unknown to the local Retail topology table.";
  }
  if (item.kind === "REMOVAL_REVIEW") {
    return "A current catalog ability was not observed in the scoped external inventory and may need removal review.";
  }
  return humanizeToken(item.reviewReason || "Review required.");
});

const comparisonRows = computed(() => {
  // Kept for binding/topology compact CURRENT summaries only (not a separate Proposed column).
  const item = selectedItem.value;
  if (!item) return [] as Array<{ label: string; current: string }>;
  const evidence = asRecord(item.evidence);
  const row = (label: string, current: string) => ({ label, current });

  if (item.kind === "NEW_ABILITY_CANDIDATE") {
    return [
      row(
        "Presence",
        item.matchedCanonicalKey ? `Matched ${item.matchedCanonicalKey}` : "Not present in catalog",
      ),
    ];
  }

  if (item.kind === "SPELL_BINDING_REVIEW") {
    const changes = Array.isArray(evidence.bindingChanges)
      ? (evidence.bindingChanges as Array<{
          spellId: number;
          currentRoles?: string[];
          candidateRoles?: string[];
        }>)
      : [];
    if (!changes.length) {
      return [row("Bindings", "Not reported")];
    }
    return changes.map((change) =>
      row(`Spell ${change.spellId}`, formatRoleList(change.currentRoles) || "—"),
    );
  }

  if (item.kind === "TOPOLOGY_REVIEW") {
    return [row("Identity", "Not present in local topology")];
  }

  return [row("Catalog entry", item.matchedCanonicalKey ?? "Present")];
});

const currentCatalogRule = computed(() => {
  const item = selectedItem.value;
  if (!item) return null;
  const evidence = asRecord(item.evidence);
  const current = asRecord(evidence.currentRule);
  if (!item.matchedCanonicalKey && Object.keys(current).length === 0) return null;
  return {
    canonicalKey: item.matchedCanonicalKey ?? (typeof current.canonicalKey === "string" ? current.canonicalKey : null),
    name: typeof current.name === "string" ? current.name : null,
    category: typeof current.category === "string" ? current.category : null,
    classSlug: typeof current.classSlug === "string" ? current.classSlug : item.classSlug,
    specSlugs: Array.isArray(current.specSlugs)
      ? (current.specSlugs as string[])
      : item.specSlugs,
    raceSlugs: Array.isArray(current.raceSlugs)
      ? (current.raceSlugs as string[])
      : item.raceSlugs,
    cooldownSeconds:
      current.cooldownSeconds != null ? Number(current.cooldownSeconds) : null,
    bindings: Array.isArray(current.bindings) ? (current.bindings as BindingRow[]) : [],
  };
});

const resolvedCatalogRule = computed((): AbilityRule | null => {
  const key = selectedItem.value?.matchedCanonicalKey;
  if (!key) return null;
  return getAllRegisteredRules().find((rule) => rule.canonicalKey === key) ?? null;
});

const bindingReviewCurrentRows = computed(() => {
  const rule = resolvedCatalogRule.value;
  if (!rule || selectedItem.value?.kind !== "SPELL_BINDING_REVIEW") return [];
  const bindings = projectCurrentRuleBindings(rule).map((b) => ({
    spellId: b.spellId,
    role: b.role,
  }));
  const primary = bindings.find((b) => b.role === "PRIMARY_ACTIVATION");
  const otherBindings = bindings.filter(
    (b) => b.role !== "PRIMARY_ACTIVATION" || b.spellId !== primary?.spellId,
  );
  const applicability = [
    rule.classSlug ? classLabel(rule.classSlug) : null,
    rule.specSlugs?.length
      ? rule.specSlugs.map((s) => specLabel(rule.classSlug, s)).join(", ")
      : null,
    rule.raceSlugs?.length ? rule.raceSlugs.map(raceLabel).join(", ") : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return [
    { label: "Category", value: rule.category },
    {
      label: "Dimension tags",
      value: dimensionTagsForRule(rule).map(dimensionTagLabel).join(", ") || "—",
    },
    { label: "Availability", value: rule.availability },
    { label: "Class / specs / races", value: applicability || "—" },
    {
      label: "Primary activation",
      value: primary ? formatBindingCell(primary.spellId, primary.role) : "—",
    },
    {
      label: "Other bindings / aliases",
      value: otherBindings.length ? formatBindings(otherBindings) : "—",
    },
    { label: "Source ownership", value: rule.sourceOwnership },
  ];
});

const bindingChangeRows = computed(() => {
  const item = selectedItem.value;
  if (!item || item.kind !== "SPELL_BINDING_REVIEW") return [];
  const evidence = asRecord(item.evidence);
  const changes = Array.isArray(evidence.bindingChanges)
    ? (evidence.bindingChanges as Array<{
        spellId: number;
        currentRoles?: string[];
        candidateRoles?: string[];
      }>)
    : [];
  return changes.map((change) => {
    const currentRoles = [...(change.currentRoles ?? [])].sort();
    const candidateRoles = [...(change.candidateRoles ?? [])].sort();
    const differs =
      currentRoles.join("|") !== candidateRoles.join("|") ||
      currentRoles.length !== candidateRoles.length;
    return {
      spellId: change.spellId,
      bindingLabel: `Spell ${change.spellId}`,
      current: formatRoleList(change.currentRoles) || "—",
      proposed: formatRoleList(change.candidateRoles) || "—",
      differs,
    };
  });
});

const draftIncomplete = computed(
  () => selectedItem.value?.draftStatus === "NEEDS_METADATA",
);

const canAcceptReview = computed(
  () => selectedItem.value?.draftValidation?.readyForPublishReview === true,
);

const sourceLines = computed(() => {
  const batch = selectedBatch.value;
  if (!batch) return [] as string[];
  const lines: string[] = [];
  if (batch.simcRevision) {
    lines.push(`SimulationCraft · ${String(batch.simcRevision).slice(0, 12)}`);
  }
  if (batch.wowBuild) lines.push(`WoW build ${batch.wowBuild}`);
  if (batch.blizzardNamespace) lines.push(`Blizzard · ${batch.blizzardNamespace}`);
  return lines;
});

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const reviewSourceFacts = computed(() => {
  const item = selectedItem.value;
  if (!item) return null;
  const draft = asRecord(item.draftRule);
  const evidence = asRecord(item.evidence);
  const provenance = asRecord(draft.provenance);
  const spellIds = Array.isArray(draft.spellIds)
    ? (draft.spellIds as number[])
    : item.primarySpellId != null
      ? [item.primarySpellId]
      : [];
  const bindings = Array.isArray(draft.bindings)
    ? (draft.bindings as BindingRow[])
    : item.kind === "SPELL_BINDING_REVIEW" && proposedBindingsFromEvidence(item).length > 0
      ? proposedBindingsFromEvidence(item)
      : item.primarySpellId != null
        ? [{ spellId: item.primarySpellId, role: "PRIMARY_ACTIVATION" }]
        : [];
  return {
    canonicalKey: String(draft.canonicalKey ?? item.matchedCanonicalKey ?? ""),
    name: String(draft.name ?? item.name),
    spellIds,
    bindings,
    classSlug: (draft.classSlug ?? item.classSlug) as string | null,
    specSlugs: (Array.isArray(draft.specSlugs) ? draft.specSlugs : item.specSlugs) as string[],
    raceSlugs: (Array.isArray(draft.raceSlugs) ? draft.raceSlugs : item.raceSlugs) as string[],
    category: draft.category ? String(draft.category) : null,
    dimensionTags: Array.isArray(draft.dimensionTags) ? (draft.dimensionTags as string[]) : [],
    availability: draft.availability ? String(draft.availability) : null,
    cooldownSeconds:
      draft.cooldownSeconds != null
        ? Number(draft.cooldownSeconds)
        : evidence.cooldownSeconds != null
          ? Number(evidence.cooldownSeconds)
          : null,
    charges:
      draft.charges != null
        ? Number(draft.charges)
        : evidence.charges != null
          ? Number(evidence.charges)
          : null,
    sourceOwnership: draft.sourceOwnership ? String(draft.sourceOwnership) : null,
    provenanceSource: provenance.source ? String(provenance.source) : null,
    validFromBuild: String(
      draft.validityBuild ?? provenance.validFromBuild ?? selectedBatch.value?.wowBuild ?? "",
    ),
    validToBuild: provenance.validToBuild ? String(provenance.validToBuild) : null,
  };
});

function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? humanizeToken(kind);
}

function kindBadgeTone(kind: string): "new" | "changed" {
  return kind === "NEW_ABILITY_CANDIDATE" ? "new" : "changed";
}

function itemClassSpecIcon(item: AbilityCatalogReviewItemSummary): string | null {
  if (item.raceSlugs?.length && !item.classSlug) {
    return raceIconName(item.raceSlugs[0]!) ?? null;
  }
  if (!item.classSlug) {
    if (item.raceSlugs?.length === 1) return raceIconName(item.raceSlugs[0]!) ?? null;
    return null;
  }
  if (item.specSlugs?.length === 1) {
    return specIconName(item.classSlug, item.specSlugs[0]!);
  }
  return classIconName(item.classSlug);
}

function itemWowheadUrl(item: AbilityCatalogReviewItemSummary): string | null {
  if (item.wowheadUrl) return item.wowheadUrl;
  if (item.primarySpellId) return wowheadSpellUrl(item.primarySpellId);
  return null;
}

async function refreshSpellTooltips(): Promise<void> {
  await nextTick();
  refreshWowheadTooltips();
}

function eligibilityLabel(state: string): string {
  return ELIGIBILITY_LABELS[state] ?? humanizeToken(state);
}

function draftStatusLabel(status: string): string {
  return DRAFT_STATUS_LABELS[status] ?? humanizeToken(status);
}

function decisionLabel(action: string): string {
  return DECISION_LABELS[action] ?? humanizeToken(action);
}

function mplusRelevanceLabel(state: string | null | undefined): string {
  if (!state) return "";
  return MPLUS_RELEVANCE_LABELS[state] ?? humanizeToken(state);
}

function humanizeToken(value: string): string {
  return value
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function dimensionTagLabel(tag: string): string {
  return humanizeToken(tag);
}

function classLabel(slug: string | null | undefined): string {
  if (!slug) return "—";
  return classOptions.value.find((c) => c.value === slug)?.label ?? slug;
}

function specLabel(classSlug: string | null | undefined, specSlug: string): string {
  const cls = RETAIL_CLASS_MATRIX.find((c) => c.slug === classSlug);
  const spec = cls?.specs?.find((s) => s.slug === specSlug);
  return spec?.name ?? specSlug;
}

function raceLabel(slug: string): string {
  return humanizeToken(slug);
}

function itemOwnershipLine(item: AbilityCatalogReviewItemSummary): string {
  if (item.raceSlugs?.length && !item.classSlug) {
    return item.raceSlugs.map(raceLabel).join(" · ");
  }
  const parts: string[] = [];
  if (item.classSlug) parts.push(classLabel(item.classSlug));
  if (item.specSlugs?.length) {
    parts.push(item.specSlugs.map((s) => specLabel(item.classSlug, s)).join(", "));
  }
  return parts.join(" · ");
}

function isRacialItem(item: AbilityCatalogReviewItemSummary): boolean {
  return Boolean(item.raceSlugs?.length && !item.classSlug);
}

function itemCardStyle(item: AbilityCatalogReviewItemSummary): Record<string, string> | undefined {
  if (isRacialItem(item) || !item.classSlug) return undefined;
  return { "--item-class-color": classColor(item.classSlug) };
}

function formatRoleList(roles: string[] | undefined): string {
  if (!roles?.length) return "";
  return roles.map((r) => BINDING_ROLE_LABELS[r] ?? humanizeToken(r)).join(" · ");
}

function formatBindings(rows: BindingRow[]): string {
  if (!rows.length) return "";
  return rows
    .map((b) => formatBindingCell(b.spellId, b.role))
    .join("; ");
}

function formatBindingCell(spellId: number, role: string): string {
  return `${BINDING_ROLE_LABELS[role] ?? humanizeToken(role)} · ${spellId}`;
}

function batchOptionLabel(batch: AbilityCatalogReviewBatchSummary): string {
  const rev = batch.simcRevision ? String(batch.simcRevision).slice(0, 7) : "?";
  const when = batch.createdAt
    ? new Date(batch.createdAt).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
  const plan = batch.reviewPlanDigest ? String(batch.reviewPlanDigest).slice(0, 8) : null;
  const parts = [
    `SimC ${rev}`,
    batch.wowBuild ? `WoW ${batch.wowBuild}` : null,
    plan ? `plan ${plan}` : null,
    batch.status !== "OPEN" ? batch.status : null,
    when || null,
  ].filter(Boolean);
  return parts.join(" · ");
}

function clearFilter(key: keyof typeof filters.value) {
  if (key === "decisionState") filters.value.decisionState = "pending";
  else filters.value[key] = "";
}

function proposedBindingsFromEvidence(item: AbilityCatalogReviewItemSummary): BindingRow[] {
  const evidence = asRecord(item.evidence);
  const changes = Array.isArray(evidence.bindingChanges) ? evidence.bindingChanges : [];
  const rows: BindingRow[] = [];
  for (const change of changes as Array<{ spellId: number; candidateRoles?: string[] }>) {
    for (const role of change.candidateRoles ?? []) {
      rows.push({ spellId: change.spellId, role });
    }
  }
  return rows;
}

function openChangeDecision() {
  changeDecisionOpen.value = true;
}

function canShortcutAccept(item: AbilityCatalogReviewItemSummary): boolean {
  return (
    item.kind === "NEW_ABILITY_CANDIDATE" ||
    item.kind === "SPELL_BINDING_REVIEW" ||
    item.kind === "TOPOLOGY_REVIEW" ||
    item.kind === "REMOVAL_REVIEW"
  );
}

function canShortcutReject(item: AbilityCatalogReviewItemSummary): boolean {
  return item.kind === "NEW_ABILITY_CANDIDATE" || item.kind === "TOPOLOGY_REVIEW";
}

async function shortcutAccept(): Promise<void> {
  const item = selectedItem.value;
  if (!item || saving.value || !canShortcutAccept(item)) return;
  if (item.kind === "NEW_ABILITY_CANDIDATE") await decide("ACCEPT");
  else if (item.kind === "SPELL_BINDING_REVIEW") await decide("ACCEPT_PROPOSED");
  else if (item.kind === "TOPOLOGY_REVIEW") await decide("ACCEPT");
  else if (item.kind === "REMOVAL_REVIEW") await decide("CONFIRM_REMOVAL");
}

async function shortcutReject(): Promise<void> {
  const item = selectedItem.value;
  if (!item || saving.value || !canShortcutReject(item)) return;
  if (item.kind === "NEW_ABILITY_CANDIDATE") await decide("EXCLUDE");
  else await decide("REJECT");
}

async function shortcutDefer(): Promise<void> {
  if (!selectedItem.value || saving.value) return;
  await decide("DEFER");
}

function isEditableKeyTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

function onDecisionKeydown(event: KeyboardEvent): void {
  if (!selectedItem.value || saving.value) return;
  if (!event.getModifierState("CapsLock")) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (isEditableKeyTarget(event.target)) return;

  if (event.key === "Enter") {
    event.preventDefault();
    void shortcutAccept();
    return;
  }
  if (event.key === "Backspace") {
    event.preventDefault();
    void shortcutReject();
    return;
  }
  if (event.key === " " || event.code === "Space") {
    event.preventDefault();
    void shortcutDefer();
  }
}

function populateDraftForm(item: AbilityCatalogReviewItemSummary) {
  const draft = asRecord(item.draftRule);
  const evidence = asRecord(item.evidence);
  draftForm.value = {
    category: String(draft.category ?? ""),
    availability: String(
      draft.availability ??
        (item.raceSlugs.length > 0 && !item.classSlug
          ? "SHARED"
          : evidence.ownershipKind === "PET_TALENT_TREE"
            ? "PET_DEPENDENT"
            : ""),
    ),
  };
}

function businessMetadataPayload(): {
  category: string | null;
  availability: string | null;
} {
  return {
    category: draftForm.value.category || null,
    availability: draftForm.value.availability || null,
  };
}

async function saveReview() {
  if (!selectedItem.value || !showReviewForm.value) return;
  saving.value = true;
  error.value = null;
  try {
    let updated: AbilityCatalogReviewItemSummary;
    const businessMetadata = businessMetadataPayload();
    if (!selectedItem.value.draftRule) {
      updated = await api.ensureAbilityCatalogDraft(selectedItem.value.id, {
        businessMetadata,
      });
    } else {
      const version = Number(
        (selectedItem.value.draftRule as { version?: number }).version ?? 0,
      );
      updated = await api.updateAbilityCatalogDraft(selectedItem.value.id, {
        expectedVersion: version,
        businessMetadata,
      });
    }
    selectedItem.value = updated;
    populateDraftForm(updated);
    await refreshDraftValidation();
    await loadBatches();
  } catch (e) {
    error.value = formatError(e);
    await refreshDraftValidation();
  } finally {
    saving.value = false;
  }
}

async function acceptReview() {
  if (!selectedItem.value) return;
  if (showReviewForm.value) {
    await refreshDraftValidation();
    if (!selectedItem.value?.draftValidation?.readyForPublishReview) {
      await saveReview();
      await refreshDraftValidation();
    }
  }
  if (!selectedItem.value?.draftValidation?.readyForPublishReview) {
    error.value = "Complete required fields before accepting.";
    return;
  }
  if (selectedItem.value.kind === "NEW_ABILITY_CANDIDATE") {
    await decide("ACCEPT");
    changeDecisionOpen.value = false;
  } else if (selectedItem.value.kind === "SPELL_BINDING_REVIEW") {
    await decide("ACCEPT_PROPOSED");
    changeDecisionOpen.value = false;
  }
}

async function refreshDraftValidation() {
  if (!selectedItem.value || !showReviewForm.value) return;
  try {
    const res = await api.validateAbilityCatalogDraft(selectedItem.value.id, {
      businessMetadata: businessMetadataPayload(),
    });
    if (selectedItem.value) {
      selectedItem.value = {
        ...selectedItem.value,
        draftStatus: res.validation.status,
        draftValidation: res.validation,
      };
    }
  } catch {
    // Validation preview is best-effort; accept/save still enforce server rules.
  }
}

function formatError(e: unknown): string {
  if (e instanceof ApiClientError) {
    if (e.status === 409) {
      return `Conflict (409): ${e.message}. Reload the item and retry.`;
    }
    return e.message;
  }
  return e instanceof Error ? e.message : "Request failed";
}

async function loadBatches() {
  loading.value = true;
  error.value = null;
  try {
    const res = await api.listAbilityCatalogReviewBatches();
    batches.value = res.batches;
    if (!selectedBatchId.value && res.batches[0]) {
      selectedBatchId.value = res.batches[0].id;
    }
    if (selectedBatchId.value) await loadItems({ preserveSelection: true });
  } catch (e) {
    error.value = formatError(e);
  } finally {
    loading.value = false;
  }
}

async function onBatchChange() {
  selectedItemId.value = null;
  selectedItem.value = null;
  mobileShowDetail.value = false;
  await loadItems();
}

async function loadItems(opts: { preserveSelection?: boolean } = {}) {
  if (!selectedBatchId.value) return;
  error.value = null;
  try {
    const spellIdNum = filters.value.spellId ? Number(filters.value.spellId) : undefined;
    const res = await api.listAbilityCatalogReviewItems(selectedBatchId.value, {
      kind: filters.value.kind || undefined,
      decisionState: filters.value.decisionState || undefined,
      draftStatus: filters.value.draftStatus || undefined,
      classSlug: filters.value.classSlug || undefined,
      specSlug: filters.value.specSlug || undefined,
      raceSlug: filters.value.raceSlug || undefined,
      category: filters.value.category || undefined,
      spellId: Number.isInteger(spellIdNum) ? String(spellIdNum) : undefined,
      search: filters.value.search || undefined,
      pageSize: "200",
    });
    items.value = res.items;
    const keepId = opts.preserveSelection ? selectedItemId.value : null;
    const next =
      (keepId && items.value.find((i) => i.id === keepId)) ||
      items.value[0] ||
      null;
    if (next) {
      await selectItem(next.id, { openMobile: false });
    } else {
      selectedItemId.value = null;
      selectedItem.value = null;
    }
    await refreshSpellTooltips();
  } catch (e) {
    error.value = formatError(e);
  }
}

async function selectItem(id: string, opts: { openMobile?: boolean } = {}) {
  selectedItemId.value = id;
  error.value = null;
  technicalOpen.value = false;
  changeDecisionOpen.value = false;
  if (opts.openMobile !== false) mobileShowDetail.value = true;
  try {
    const item = await api.getAbilityCatalogReviewItem(id);
    selectedItem.value = item;
    populateDraftForm(item);
    await refreshDraftValidation();
    await refreshSpellTooltips();
  } catch (e) {
    error.value = formatError(e);
  }
}

async function navigateNextPending() {
  const idx = selectedIndex.value;
  const next = items.value.find((item, i) => i > idx && item.decisionAction == null);
  if (next) await selectItem(next.id);
  else {
    const first = items.value.find((item) => item.decisionAction == null);
    if (first) await selectItem(first.id);
  }
}

async function decide(action: string) {
  if (!selectedItem.value) return;
  const needsDraftAcceptValidation =
    (action === "ACCEPT" && selectedItem.value.kind === "NEW_ABILITY_CANDIDATE") ||
    action === "ACCEPT_PROPOSED";
  if (needsDraftAcceptValidation) {
    await refreshDraftValidation();
    if (!selectedItem.value?.draftValidation?.readyForPublishReview) {
      error.value = "Complete required fields before accepting.";
      return;
    }
  }
  saving.value = true;
  error.value = null;
  try {
    const needsBusinessMetadata =
      action === "ACCEPT" ||
      action === "ACCEPT_PROPOSED";
    const updated = await api.decideAbilityCatalogReviewItem(selectedItem.value.id, {
      expectedVersion: selectedItem.value.version,
      action,
      note: decisionNote.value || undefined,
      businessMetadata: needsBusinessMetadata ? businessMetadataPayload() : undefined,
    });
    selectedItem.value = updated;
    populateDraftForm(updated);
    await loadBatches();
    await loadItems({ preserveSelection: true });
    const advance =
      action === "REJECT" ||
      action === "EXCLUDE" ||
      action === "DEFER" ||
      action === "KEEP_CURRENT" ||
      action === "CONFIRM_REMOVAL";
    if (advance) {
      await navigateNextPending();
    }
  } catch (e) {
    error.value = formatError(e);
    await refreshDraftValidation();
  } finally {
    saving.value = false;
  }
}

watch(
  () => filters.value,
  () => {
    void loadItems({ preserveSelection: true });
  },
  { deep: true },
);

watch(
  () => [draftForm.value.category, draftForm.value.availability],
  () => {
    void refreshDraftValidation();
  },
);

onMounted(() => {
  void loadBatches();
  window.addEventListener("keydown", onDecisionKeydown);
  void loadWowheadTooltipScript({ iconizeLinks: false }).then((status) => {
    if (status === "ready") refreshWowheadTooltips();
  });
});

onUnmounted(() => {
  window.removeEventListener("keydown", onDecisionKeydown);
});
</script>

<template>
  <section
    class="review-page"
    :class="{
      'review-page--embedded': props.embedded,
      'review-page--with-dock': Boolean(selectedItem),
    }"
    data-testid="ability-catalog-review-page"
  >
    <header v-if="!props.embedded" class="review-page__header">
      <h1>Ability catalog review</h1>
      <p>Review refresh proposals and curate abilities for the next release. Runtime catalog is never published from here.</p>
    </header>

    <StatusBanner v-if="error" tone="error" :message="error" />
    <p v-if="loading" class="muted">Loading review batches…</p>

    <template v-if="!loading && !batches.length">
      <p class="empty-state" data-testid="review-empty-batches">No catalog changes require review.</p>
    </template>

    <div v-else-if="batches.length" class="review-page__body">
      <div class="batch-bar" data-testid="review-batch-selector">
        <label class="batch-bar__label">
          <span class="sr-only">Review batch</span>
          <select
            v-model="selectedBatchId"
            class="admin-control batch-bar__select"
            @change="onBatchChange"
          >
            <option v-for="batch in batches" :key="batch.id" :value="batch.id">
              {{ batchOptionLabel(batch) }}
            </option>
          </select>
        </label>
        <p
          v-if="selectedBatch"
          class="batch-bar__progress"
          data-testid="review-batch-progress"
        >
          {{ batchProgressLine }}
        </p>
      </div>

      <div class="toolbar">
        <details class="filters-panel" data-testid="review-filters">
          <summary class="filters-panel__summary">
            Filters
            <span v-if="activeFilterChips.length" class="filters-panel__count">{{
              activeFilterChips.length
            }}</span>
          </summary>
          <div class="filters">
            <label>
              Search
              <input
                v-model="filters.search"
                class="admin-control"
                type="search"
                placeholder="Name or key"
              />
            </label>
            <label>
              Type
              <select v-model="filters.kind" class="admin-control">
                <option value="">All</option>
                <option value="NEW_ABILITY_CANDIDATE">New ability</option>
                <option value="SPELL_BINDING_REVIEW">Spell binding</option>
                <option value="TOPOLOGY_REVIEW">Topology</option>
                <option value="REMOVAL_REVIEW">Removal review</option>
              </select>
            </label>
            <label>
              Class
              <select v-model="filters.classSlug" class="admin-control">
                <option value="">All</option>
                <option v-for="c in classOptions" :key="c.value" :value="c.value">{{
                  c.label
                }}</option>
              </select>
            </label>
            <label>
              Status
              <select v-model="filters.decisionState" class="admin-control">
                <option value="pending">Pending</option>
                <option value="accepted">Accepted</option>
                <option value="rejected">Rejected</option>
                <option value="deferred">Deferred</option>
                <option value="decided">Decided</option>
                <option value="">All</option>
              </select>
            </label>
            <label>
              Spec
              <input v-model="filters.specSlug" class="admin-control" type="text" placeholder="slug" />
            </label>
            <label>
              Race
              <input v-model="filters.raceSlug" class="admin-control" type="text" placeholder="slug" />
            </label>
            <label>
              Category
              <select v-model="filters.category" class="admin-control">
                <option value="">All</option>
                <option v-for="c in categoryOptions" :key="c.value" :value="c.value">{{
                  c.label
                }}</option>
              </select>
            </label>
            <label>
              Spell ID
              <input v-model="filters.spellId" class="admin-control" type="number" min="1" />
            </label>
            <label>
              Draft status
              <select v-model="filters.draftStatus" class="admin-control">
                <option value="">All</option>
            <option value="NEEDS_METADATA">Incomplete</option>
            <option value="READY_FOR_PUBLISH_REVIEW">Complete</option>
              </select>
            </label>
          </div>
        </details>
        <button
          v-if="mobileShowDetail"
          type="button"
          class="btn secondary mobile-back"
          @click="mobileShowDetail = false"
        >
          Back to list
        </button>
      </div>

      <div v-if="activeFilterChips.length" class="filter-chips">
        <button
          v-for="chip in activeFilterChips"
          :key="chip.key"
          type="button"
          class="filter-chip"
          @click="clearFilter(chip.key)"
        >
          {{ chip.label }} ×
        </button>
      </div>

      <div class="split" :class="{ 'split--detail': mobileShowDetail }">
        <ul
          class="item-list"
          data-testid="review-item-list"
          :class="{ 'item-list--hidden-mobile': mobileShowDetail }"
        >
          <li v-if="!items.length" class="empty-state">
            {{
              selectedBatch?.decisionCounts.pending === 0
                ? "Review complete."
                : "No items match the current filters."
            }}
          </li>
          <li
            v-for="item in items"
            :key="item.id"
            class="item-card"
            :class="{ 'item-card--active': item.id === selectedItemId }"
          >
            <div
              class="item-card__select"
              :class="{ 'item-card__select--class': Boolean(itemCardStyle(item)) }"
              :style="itemCardStyle(item)"
              role="button"
              tabindex="0"
              @click="selectItem(item.id)"
              @keydown.enter.prevent="selectItem(item.id)"
              @keydown.space.prevent="selectItem(item.id)"
            >
              <div class="item-card__row item-card__row--title">
                <a
                  v-if="item.primarySpellId && itemWowheadUrl(item)"
                  class="item-card__spell"
                  :href="itemWowheadUrl(item)!"
                  target="_blank"
                  rel="noopener noreferrer"
                  :data-wowhead="`spell=${item.primarySpellId}`"
                  :aria-label="`${item.name} on Wowhead`"
                  @click.stop
                >
                  <SpellWowIcon
                    :spell-id="item.primarySpellId"
                    :alt="item.name"
                    :width="28"
                    :height="28"
                  />
                </a>
                <span v-else class="item-card__spell item-card__spell--placeholder" aria-hidden="true" />
                <strong class="item-card__name">{{ item.name }}</strong>
                <span class="badge" :class="`badge--${kindBadgeTone(item.kind)}`">{{
                  kindLabel(item.kind)
                }}</span>
              </div>
              <div class="item-card__row item-card__row--meta">
                <WowIcon
                  v-if="itemClassSpecIcon(item)"
                  class="item-card__spec"
                  :icon-name="itemClassSpecIcon(item)"
                  :alt="itemOwnershipLine(item)"
                  :width="18"
                  :height="18"
                />
                <span class="item-card__meta">{{ itemOwnershipLine(item) || "—" }}</span>
                <span v-if="item.mplusRelevance" class="badge badge--mplus">{{
                  mplusRelevanceLabel(item.mplusRelevance)
                }}</span>
                <span v-if="item.decisionAction" class="badge badge--done">{{
                  decisionLabel(item.decisionAction)
                }}</span>
              </div>
            </div>
          </li>
        </ul>

        <article
          v-if="selectedItem"
          class="detail"
          data-testid="review-item-detail"
          :class="{ 'detail--hidden-mobile': !mobileShowDetail }"
        >
          <header class="detail__header">
            <div class="detail__header-main">
              <h2>{{ selectedItem.name }}</h2>
              <p class="detail__subtitle">
                {{ itemOwnershipLine(selectedItem) || "—" }}
                <span v-if="selectedItem.primarySpellId"> · Spell ID {{ selectedItem.primarySpellId }}</span>
              </p>
              <div class="detail__badges">
                <span class="badge">{{ kindLabel(selectedItem.kind) }}</span>
                <span v-if="selectedItem.mplusRelevance" class="badge badge--mplus">{{
                  mplusRelevanceLabel(selectedItem.mplusRelevance)
                }}</span>
                <span v-if="selectedItem.eligibilityState" class="badge badge--evidence">{{
                  eligibilityLabel(selectedItem.eligibilityState)
                }}</span>
                <span
                  v-if="draftIncomplete"
                  class="badge badge--draft"
                  data-testid="draft-status"
                >Incomplete</span>
              </div>
            </div>
            <a
              v-if="selectedItem.primarySpellId && itemWowheadUrl(selectedItem)"
              class="spell-icon-link"
              :href="itemWowheadUrl(selectedItem)!"
              target="_blank"
              rel="noopener noreferrer"
              :data-wowhead="`spell=${selectedItem.primarySpellId}`"
              :aria-label="`${selectedItem.name} on Wowhead`"
              data-testid="review-spell-icon"
            >
              <SpellWowIcon
                :spell-id="selectedItem.primarySpellId"
                :alt="selectedItem.name"
                :width="96"
                :height="96"
              />
            </a>
          </header>

          <section
            v-if="selectedItem.kind === 'SPELL_BINDING_REVIEW'"
            class="panel panel--binding-summary"
            data-testid="panel-binding-summary"
          >
            <h3 class="panel__title">Spell binding review</h3>
            <p class="muted panel__intro">
              What this ability means in the scoring catalog today, and which spell binding the
              refresh is asking you to reconsider.
            </p>

            <div class="binding-summary-block" data-testid="panel-binding-current-rule">
              <h4 class="binding-summary-block__title">Current catalog rule</h4>
              <table v-if="bindingReviewCurrentRows.length" class="review-summary-table">
                <tbody>
                  <tr v-for="row in bindingReviewCurrentRows" :key="row.label">
                    <th scope="row">{{ row.label }}</th>
                    <td>{{ row.value }}</td>
                  </tr>
                </tbody>
              </table>
              <p v-else class="muted">No matching catalog rule found for this item.</p>
            </div>

            <div class="binding-summary-block" data-testid="panel-binding-change">
              <h4 class="binding-summary-block__title">Binding change</h4>
              <table v-if="bindingChangeRows.length" class="review-summary-table review-summary-table--compare">
                <thead>
                  <tr>
                    <th scope="col">Binding</th>
                    <th scope="col">Current</th>
                    <th scope="col">Observed / proposed</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="row in bindingChangeRows"
                    :key="row.spellId"
                    :class="{ 'review-summary-table__row--diff': row.differs }"
                  >
                    <th scope="row">{{ row.bindingLabel }}</th>
                    <td :class="{ 'review-summary-table__cell--diff': row.differs }">{{ row.current }}</td>
                    <td :class="{ 'review-summary-table__cell--diff': row.differs }">{{ row.proposed }}</td>
                  </tr>
                </tbody>
              </table>
              <p v-else class="muted">No binding changes reported.</p>
            </div>
          </section>

          <section class="panel panel--ability" data-testid="panel-ability-details">
            <h3>Ability details</h3>

            <div
              v-if="selectedItem.kind !== 'SPELL_BINDING_REVIEW'"
              class="ability-block"
              data-testid="panel-compare"
            >
              <h4 class="ability-block__title">Current</h4>
              <template v-if="selectedItem.kind === 'NEW_ABILITY_CANDIDATE' && !currentCatalogRule">
                <p class="muted">Not present in catalog</p>
              </template>
              <dl v-else-if="currentCatalogRule" class="ability-dl">
                <div v-if="currentCatalogRule.canonicalKey">
                  <dt>Canonical key</dt>
                  <dd>{{ currentCatalogRule.canonicalKey }}</dd>
                </div>
                <div v-if="currentCatalogRule.name">
                  <dt>Name</dt>
                  <dd>{{ currentCatalogRule.name }}</dd>
                </div>
                <div v-if="currentCatalogRule.category">
                  <dt>Category</dt>
                  <dd>{{ currentCatalogRule.category }}</dd>
                </div>
                <div v-if="currentCatalogRule.classSlug || currentCatalogRule.specSlugs?.length">
                  <dt>Applicability</dt>
                  <dd>
                    {{
                      [
                        currentCatalogRule.classSlug
                          ? classLabel(currentCatalogRule.classSlug)
                          : null,
                        currentCatalogRule.specSlugs?.length
                          ? currentCatalogRule.specSlugs
                              .map((s) => specLabel(currentCatalogRule!.classSlug, s))
                              .join(", ")
                          : null,
                        currentCatalogRule.raceSlugs?.length
                          ? currentCatalogRule.raceSlugs.map(raceLabel).join(", ")
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"
                    }}
                  </dd>
                </div>
                <div v-if="currentCatalogRule.cooldownSeconds != null">
                  <dt>Cooldown</dt>
                  <dd>{{ currentCatalogRule.cooldownSeconds }}s</dd>
                </div>
                <div v-if="currentCatalogRule.bindings.length">
                  <dt>Bindings</dt>
                  <dd>{{ formatBindings(currentCatalogRule.bindings) }}</dd>
                </div>
              </dl>
              <dl v-else class="ability-dl">
                <div v-for="row in comparisonRows" :key="row.label">
                  <dt>{{ row.label }}</dt>
                  <dd>{{ row.current }}</dd>
                </div>
              </dl>
            </div>

            <div class="ability-block ability-block--review" data-testid="panel-review">
              <h4 class="ability-block__title">Review</h4>
              <template v-if="showReviewForm">
                <p v-if="draftIncomplete" class="muted" data-status="review">
                  Incomplete — finish required fields before accepting.
                  <span class="sr-only" data-testid="draft-status-raw">{{
                    selectedItem.draftStatus
                  }}</span>
                </p>
                <ul
                  v-if="selectedItem.draftValidation?.reasonCodes?.length"
                  data-testid="draft-reason-codes"
                  class="reason-codes"
                >
                  <li v-for="code in selectedItem.draftValidation.reasonCodes" :key="code">
                    {{ humanizeToken(code) }}
                    <span class="sr-only">{{ code }}</span>
                  </li>
                </ul>

                <div class="draft-editor" data-testid="draft-editor">
                  <dl v-if="reviewSourceFacts" class="ability-dl ability-dl--readonly">
                    <div v-if="reviewSourceFacts.canonicalKey">
                      <dt>Canonical key</dt>
                      <dd data-testid="draft-canonical-key">{{ reviewSourceFacts.canonicalKey }}</dd>
                    </div>
                    <div>
                      <dt>Display name</dt>
                      <dd>{{ reviewSourceFacts.name }}</dd>
                    </div>
                    <div v-if="reviewSourceFacts.spellIds.length">
                      <dt>Spell IDs</dt>
                      <dd>{{ reviewSourceFacts.spellIds.join(", ") }}</dd>
                    </div>
                    <div
                      v-if="reviewSourceFacts.classSlug || reviewSourceFacts.specSlugs.length || reviewSourceFacts.raceSlugs.length"
                    >
                      <dt>Applicability</dt>
                      <dd>
                        {{
                          [
                            reviewSourceFacts.classSlug
                              ? classLabel(reviewSourceFacts.classSlug)
                              : null,
                            reviewSourceFacts.specSlugs.length
                              ? reviewSourceFacts.specSlugs
                                  .map((s) => specLabel(reviewSourceFacts!.classSlug, s))
                                  .join(", ")
                              : null,
                            reviewSourceFacts.raceSlugs.length
                              ? reviewSourceFacts.raceSlugs.map(raceLabel).join(", ")
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "—"
                        }}
                      </dd>
                    </div>
                    <div v-if="reviewSourceFacts.cooldownSeconds != null">
                      <dt>Cooldown</dt>
                      <dd>{{ reviewSourceFacts.cooldownSeconds }}s</dd>
                    </div>
                    <div v-if="reviewSourceFacts.charges != null">
                      <dt>Charges</dt>
                      <dd>{{ reviewSourceFacts.charges }}</dd>
                    </div>
                    <div v-if="reviewSourceFacts.sourceOwnership">
                      <dt>Source ownership</dt>
                      <dd>{{ reviewSourceFacts.sourceOwnership }}</dd>
                    </div>
                    <div v-if="reviewSourceFacts.bindings.length">
                      <dt>Bindings</dt>
                      <dd>{{ formatBindings(reviewSourceFacts.bindings) }}</dd>
                    </div>
                    <div v-if="reviewSourceFacts.dimensionTags.length">
                      <dt>Dimensions</dt>
                      <dd>{{ reviewSourceFacts.dimensionTags.map(dimensionTagLabel).join(", ") }}</dd>
                    </div>
                    <div v-if="reviewSourceFacts.provenanceSource">
                      <dt>Provenance</dt>
                      <dd>
                        {{ reviewSourceFacts.provenanceSource }}
                        <span v-if="reviewSourceFacts.validFromBuild">
                          · from build {{ reviewSourceFacts.validFromBuild }}
                        </span>
                        <span v-if="reviewSourceFacts.validToBuild">
                          · to build {{ reviewSourceFacts.validToBuild }}
                        </span>
                      </dd>
                    </div>
                  </dl>

                  <label>
                    Category *
                    <select
                      v-model="draftForm.category"
                      class="admin-control"
                      data-testid="draft-category"
                      required
                    >
                      <option value="">— explicit choice required —</option>
                      <option v-for="c in categoryOptions" :key="c.value" :value="c.value">
                        {{ c.label }}
                      </option>
                    </select>
                  </label>
                  <p
                    v-if="!draftForm.category"
                    class="field-hint field-hint--warn"
                    data-testid="category-required-hint"
                  >
                    Category is required before this ability can be accepted.
                  </p>
                  <label>
                    Availability
                    <select
                      v-model="draftForm.availability"
                      class="admin-control"
                      data-testid="draft-availability"
                    >
                      <option value="">—</option>
                      <option v-for="a in availabilityOptions" :key="a.value" :value="a.value">
                        {{ a.label }}
                      </option>
                    </select>
                  </label>
                </div>
              </template>
              <p v-else-if="selectedItem.kind === 'TOPOLOGY_REVIEW'" class="muted">
                Topology accept records the external identity for the next release. No ability
                fields to edit here.
              </p>
            </div>
          </section>

          <details class="panel panel--collapse" data-testid="panel-why">
            <summary>Why is this being reviewed?</summary>
            <div class="panel--collapse__body">
              <p>{{ whyBlurb }}</p>
              <ul v-if="whyBullets.length" class="evidence-list">
                <li v-for="(bullet, idx) in whyBullets" :key="idx">{{ bullet }}</li>
              </ul>
            </div>
          </details>

          <details
            class="panel panel--collapse"
            data-testid="panel-technical"
            :open="technicalOpen"
            @toggle="technicalOpen = ($event.target as HTMLDetailsElement).open"
          >
            <summary>Technical details</summary>
            <div class="panel--collapse__body technical__body">
              <p class="muted">Raw enums and source payloads for debugging.</p>
              <pre data-testid="panel-current">{{
                JSON.stringify(
                  {
                    kind: selectedItem.kind,
                    eligibilityState: selectedItem.eligibilityState,
                    reviewReason: selectedItem.reviewReason,
                    matchedCanonicalKey: selectedItem.matchedCanonicalKey,
                    currentEvidence: asRecord(selectedItem.evidence).currentRule ?? null,
                  },
                  null,
                  2,
                )
              }}</pre>
              <pre data-testid="panel-external">{{
                JSON.stringify(
                  {
                    evidence: selectedItem.evidence,
                    sourceProvenance: selectedItem.sourceProvenance,
                    draftRule: selectedItem.draftRule,
                    draftTopology: selectedItem.draftTopology,
                    draftValidation: selectedItem.draftValidation,
                    version: selectedItem.version,
                  },
                  null,
                  2,
                )
              }}</pre>
              <div data-testid="panel-audit">
                <h4>Decision history</h4>
                <ul v-if="selectedItem.decisionEvents?.length" class="audit-list">
                  <li v-for="ev in selectedItem.decisionEvents" :key="ev.id">
                    <strong>{{ ev.createdAt }}</strong>
                    · {{ ev.actorType }}
                    <span v-if="ev.actorUserId"> · {{ ev.actorUserId }}</span>
                    <span v-if="ev.note"> · {{ ev.note }}</span>
                    <pre>{{ JSON.stringify({ previous: ev.previousState, next: ev.newState }, null, 2) }}</pre>
                  </li>
                </ul>
                <p v-else class="muted">No decision events yet.</p>
              </div>
            </div>
          </details>

          <footer v-if="sourceLines.length" class="sources" data-testid="review-sources">
            <span v-for="(line, idx) in sourceLines" :key="line">
              <span v-if="idx > 0" class="sources__sep" aria-hidden="true">·</span>{{ line }}
            </span>
          </footer>
        </article>
        <p v-else class="empty muted">Select a review item.</p>
      </div>
    </div>

    <footer
      v-if="selectedItem"
      class="decision-dock"
      data-testid="panel-decision"
      aria-label="Decision actions"
    >
      <label class="decision-dock__note">
        <span class="sr-only">Note</span>
        <input
          v-model="decisionNote"
          class="admin-control"
          type="text"
          placeholder="Decision note (optional)"
          autocomplete="off"
        />
      </label>
      <div class="decision-dock__actions">
        <template v-if="selectedItem.kind === 'NEW_ABILITY_CANDIDATE'">
          <button
            type="button"
            class="btn secondary"
            :disabled="saving"
            data-testid="save-review"
            @click="saveReview"
          >
            Save
          </button>
          <template v-if="showNewAbilityDecisionActions">
            <button type="button" class="btn danger" :disabled="saving" @click="decide('EXCLUDE')">
              <span class="btn-stack">
                <span>Exclude</span>
                <span class="btn-stack__hint">Caps+Back</span>
              </span>
            </button>
            <button type="button" class="btn secondary" :disabled="saving" @click="decide('DEFER')">
              <span class="btn-stack">
                <span>Defer</span>
                <span class="btn-stack__hint">Caps+Space</span>
              </span>
            </button>
            <button
              type="button"
              class="btn primary"
              :disabled="saving || !canAcceptReview"
              data-testid="decide-accept"
              @click="acceptReview"
            >
              <span class="btn-stack">
                <span>Accept</span>
                <span class="btn-stack__hint">Caps+Enter</span>
              </span>
            </button>
          </template>
          <template v-else>
            <button
              type="button"
              class="btn secondary"
              :disabled="saving"
              data-testid="change-decision"
              @click="openChangeDecision"
            >
              Change decision
            </button>
          </template>
        </template>
        <template v-else-if="selectedItem.kind === 'SPELL_BINDING_REVIEW'">
          <button
            type="button"
            class="btn secondary"
            :disabled="saving"
            data-testid="save-review"
            @click="saveReview"
          >
            Save
          </button>
          <template v-if="showBindingDecisionActions">
            <button
              type="button"
              class="btn secondary"
              :disabled="saving"
              data-testid="decide-keep-current"
              @click="decide('KEEP_CURRENT')"
            >
              Keep current
            </button>
            <button type="button" class="btn secondary" :disabled="saving" @click="decide('DEFER')">
              <span class="btn-stack">
                <span>Defer</span>
                <span class="btn-stack__hint">Caps+Space</span>
              </span>
            </button>
            <button
              type="button"
              class="btn primary"
              :disabled="saving || !canAcceptReview"
              data-testid="decide-accept"
              @click="acceptReview"
            >
              <span class="btn-stack">
                <span>Accept</span>
                <span class="btn-stack__hint">Caps+Enter</span>
              </span>
            </button>
          </template>
          <template v-else>
            <button
              type="button"
              class="btn secondary"
              :disabled="saving"
              data-testid="change-decision"
              @click="openChangeDecision"
            >
              Change decision
            </button>
          </template>
        </template>
        <template v-else-if="selectedItem.kind === 'TOPOLOGY_REVIEW'">
          <button type="button" class="btn danger" :disabled="saving" @click="decide('REJECT')">
            <span class="btn-stack">
              <span>Reject</span>
              <span class="btn-stack__hint">Caps+Back</span>
            </span>
          </button>
          <button type="button" class="btn secondary" :disabled="saving" @click="decide('DEFER')">
            <span class="btn-stack">
              <span>Defer</span>
              <span class="btn-stack__hint">Caps+Space</span>
            </span>
          </button>
          <button
            type="button"
            class="btn primary"
            :disabled="saving"
            data-testid="decide-topology-accept"
            @click="decide('ACCEPT')"
          >
            <span class="btn-stack">
              <span>Accept</span>
              <span class="btn-stack__hint">Caps+Enter</span>
            </span>
          </button>
        </template>
        <template v-else-if="selectedItem.kind === 'REMOVAL_REVIEW'">
          <button type="button" class="btn secondary" :disabled="saving" @click="decide('KEEP_CURRENT')">
            Keep current
          </button>
          <button type="button" class="btn secondary" :disabled="saving" @click="decide('DEFER')">
            <span class="btn-stack">
              <span>Defer</span>
              <span class="btn-stack__hint">Caps+Space</span>
            </span>
          </button>
          <button
            type="button"
            class="btn danger"
            :disabled="saving"
            @click="decide('CONFIRM_REMOVAL')"
          >
            <span class="btn-stack">
              <span>Confirm removal</span>
              <span class="btn-stack__hint">Caps+Enter</span>
            </span>
          </button>
        </template>
      </div>
      <p v-if="selectedItem.decisionAction" class="decision-dock__status muted">
        Current: <strong>{{ decisionLabel(selectedItem.decisionAction) }}</strong>
        <span v-if="isNewAbilityAccepted && draftIncomplete" class="decision-dock__draft">
          · Incomplete
        </span>
      </p>
    </footer>
  </section>
</template>

<style scoped>
.review-page {
  display: grid;
  gap: var(--space-4);
  color: var(--color-text);
}
.review-page:not(.review-page--embedded) {
  padding: var(--space-4);
}
.review-page--with-dock {
  padding-bottom: 5.5rem;
}
.review-page__header h1 {
  margin: 0 0 0.35rem;
  font-size: 1.35rem;
  font-weight: 650;
}
.review-page__header p,
.muted,
.empty,
.empty-state {
  color: var(--color-text-muted);
  margin: 0;
}
.batch-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.85rem;
  padding: 0.35rem 0;
}
.batch-bar__label {
  flex: 1 1 16rem;
  min-width: 0;
  margin: 0;
}
.batch-bar__select {
  width: 100%;
}
.batch-bar__progress {
  margin: 0;
  flex: 0 1 auto;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  white-space: nowrap;
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 0.5rem;
}
.filters-panel {
  flex: 1 1 12rem;
  min-width: 0;
  margin-bottom: 0.45rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-surface);
}
.filters-panel__summary {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  cursor: pointer;
  list-style: none;
  padding: 0.4rem 0.65rem;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  user-select: none;
}
.filters-panel__summary::-webkit-details-marker {
  display: none;
}
.filters-panel__summary::before {
  content: "▸";
  font-size: 0.7rem;
  line-height: 1;
}
.filters-panel[open] > .filters-panel__summary::before {
  content: "▾";
}
.filters-panel__count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.25rem;
  height: 1.25rem;
  padding: 0 0.35rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-gold-300) 22%, var(--color-bg));
  border: 1px solid color-mix(in srgb, var(--color-gold-300) 45%, var(--color-border));
  color: var(--color-text);
  font-size: var(--text-xs);
  font-weight: 600;
}
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
  align-items: end;
  padding: 0.15rem 0.65rem 0.65rem;
  border-top: 1px solid var(--color-border);
}
.filters label,
.draft-editor > label,
.panel > label {
  display: grid;
  gap: 0.35rem;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  min-width: 9rem;
  flex: 1 1 9rem;
  max-width: 14rem;
}
.badge,
.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 0.2rem 0.65rem;
  font-size: var(--text-xs);
  background: var(--color-bg);
  color: var(--color-text-muted);
  white-space: nowrap;
}
.badge--new {
  border-color: color-mix(in srgb, #3f8f6b 55%, var(--color-border));
  background: color-mix(in srgb, #3f8f6b 16%, var(--color-surface));
  color: #9bd4b5;
}
.badge--changed {
  border-color: color-mix(in srgb, #c9a227 55%, var(--color-border));
  background: color-mix(in srgb, #c9a227 16%, var(--color-surface));
  color: #e6d38a;
}
.badge--evidence {
  border-color: color-mix(in srgb, var(--color-gold-300) 55%, var(--color-border));
  color: var(--color-text);
}
.badge--done {
  border-color: color-mix(in srgb, #3f8f6b 45%, var(--color-border));
}
.badge--mplus {
  border-color: color-mix(in srgb, var(--color-gold-300) 45%, var(--color-border));
  color: var(--color-text);
}
.badge--draft {
  border-color: color-mix(in srgb, #c47b2c 45%, var(--color-border));
}
.filter-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.filter-chip {
  cursor: pointer;
  font: inherit;
}
.actions,
.bindings__header {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}
.decision-dock {
  position: fixed;
  left: 50%;
  right: auto;
  bottom: 1rem;
  z-index: 40;
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 0.75rem;
  width: min(56rem, calc(100vw - 2rem));
  max-width: calc(100vw - 2rem);
  transform: translateX(-50%);
  padding: 0.75rem 1rem;
  background: color-mix(in srgb, var(--color-bg-elevated) 94%, transparent);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  backdrop-filter: blur(10px);
  box-shadow: 0 10px 28px rgb(0 0 0 / 40%);
}
.decision-dock__note {
  flex: 1 1 auto;
  min-width: 14rem;
  max-width: none;
  margin: 0;
}
.decision-dock__note .admin-control {
  width: 100%;
}
.decision-dock__actions {
  display: flex;
  flex-wrap: nowrap;
  gap: 0.45rem;
  align-items: center;
  margin-left: auto;
}
.decision-dock__actions .btn-stack {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 0.05rem;
  line-height: 1.15;
}
.decision-dock__actions .btn-stack__hint {
  font-size: 0.62rem;
  font-weight: 500;
  letter-spacing: 0.02em;
  opacity: 0.72;
}
.decision-dock__status {
  margin: 0;
  font-size: var(--text-sm);
  white-space: nowrap;
}
@media (max-width: 960px) {
  .decision-dock {
    left: 1rem;
    right: 1rem;
    bottom: calc(0.75rem + env(safe-area-inset-bottom, 0px));
    width: auto;
    max-width: none;
    transform: none;
    flex-wrap: wrap;
  }
  .decision-dock__note {
    flex: 1 1 100%;
    max-width: none;
  }
  .decision-dock__actions {
    margin-left: 0;
    flex-wrap: wrap;
  }
  .review-page--with-dock {
    padding-bottom: 8rem;
  }
}
.split {
  display: grid;
  grid-template-columns: minmax(14rem, 18rem) 1fr;
  gap: 0.85rem;
  align-items: start;
}
.item-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.4rem;
  max-height: 70vh;
  overflow: auto;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--color-text-muted) 45%, transparent) transparent;
}
.item-list::-webkit-scrollbar {
  width: 5px;
}
.item-list::-webkit-scrollbar-track {
  background: transparent;
}
.item-list::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--color-text-muted) 40%, var(--color-border));
  border-radius: 999px;
}
.item-list::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--color-text-muted) 60%, var(--color-border));
}
.item-card__select {
  display: grid;
  gap: 0.35rem;
  width: 100%;
  text-align: left;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text);
  border-radius: var(--radius-control);
  cursor: pointer;
  padding: 0.55rem 0.65rem;
  font: inherit;
}
.item-card__select--class {
  border-color: color-mix(in srgb, var(--item-class-color) 55%, var(--color-border));
  background: color-mix(in srgb, var(--item-class-color) 14%, var(--color-surface));
  box-shadow: inset 3px 0 0 var(--item-class-color);
}
.item-card__select--class:hover {
  background: color-mix(in srgb, var(--item-class-color) 22%, var(--color-surface-hover));
}
.item-card--active .item-card__select--class {
  border-color: color-mix(in srgb, var(--item-class-color) 70%, var(--color-gold-300));
  background: color-mix(in srgb, var(--item-class-color) 20%, var(--color-surface-hover));
  box-shadow:
    inset 3px 0 0 var(--item-class-color),
    inset 0 0 0 1px color-mix(in srgb, var(--color-gold-300) 35%, transparent);
}
.item-card__row {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
}
.item-card__row--title .item-card__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.95rem;
}
.item-card__row--title .badge {
  margin-left: auto;
  flex-shrink: 0;
}
.item-card__spell {
  display: inline-flex;
  flex-shrink: 0;
  line-height: 0;
  border-radius: 4px;
  text-decoration: none;
  border: 1px solid var(--color-border);
  overflow: hidden;
  background: var(--color-bg);
}
.item-card__spell--placeholder {
  width: 28px;
  height: 28px;
  border-radius: 4px;
  background: var(--color-border);
}
.item-card__spec {
  flex-shrink: 0;
  display: inline-flex;
  line-height: 0;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  overflow: hidden;
  background: var(--color-bg);
}
.item-card__spec :deep(.wow-icon) {
  border-radius: 0;
}
.item-card__meta {
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.item-card__row--meta .badge {
  margin-left: auto;
}
.item-card__select:hover {
  background: var(--color-surface-hover);
}
.item-card--active .item-card__select {
  border-color: var(--color-gold-300);
  background: var(--color-surface-hover);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-gold-300) 35%, transparent);
}
.detail {
  border: 1px solid var(--color-border);
  background: var(--color-bg-elevated);
  border-radius: var(--radius-card);
  padding: 0.85rem 1rem;
  display: grid;
  gap: 0.85rem;
}
.detail__header {
  display: flex;
  gap: 0.85rem;
  align-items: stretch;
}
.detail__header-main {
  flex: 1;
  min-width: 0;
}
.detail__header h2 {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 650;
}
.detail__subtitle {
  margin: 0.25rem 0 0;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}
.detail__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.45rem;
}
.spell-icon-link {
  display: block;
  flex: 0 0 auto;
  align-self: stretch;
  aspect-ratio: 1;
  height: auto;
  min-height: 4.5rem;
  border-radius: var(--radius-control);
  overflow: hidden;
  line-height: 0;
  text-decoration: none;
  color: inherit;
}
.spell-icon-link:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
}
.spell-icon-link :deep(.wow-icon) {
  width: 100% !important;
  height: 100% !important;
}
.panel {
  border-top: 1px solid var(--color-border);
  padding-top: 0.75rem;
}
.panel h3 {
  margin: 0 0 0.5rem;
  font-size: 0.8rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}
.evidence-list,
.reason-codes,
.audit-list {
  margin: 0.5rem 0 0;
  padding-left: 1.1rem;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}
.field-hint {
  margin: 0.25rem 0 0.75rem;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}
.field-hint--warn {
  color: var(--color-warn, #b45309);
}
.compare-table-wrap {
  overflow-x: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-bg);
}
.panel--binding-summary {
  margin-top: 0.75rem;
}
.panel--binding-summary .panel__title {
  margin: 0 0 0.35rem;
  font-size: 1rem;
  font-weight: 650;
}
.panel--binding-summary .panel__intro {
  margin: 0 0 0.85rem;
  font-size: var(--text-sm);
}
.binding-summary-block + .binding-summary-block {
  margin-top: 0.85rem;
}
.binding-summary-block__title {
  margin: 0 0 0.45rem;
  font-size: 0.8rem;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}
.review-summary-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  overflow: hidden;
}
.review-summary-table th,
.review-summary-table td {
  padding: 0.4rem 0.55rem;
  text-align: left;
  vertical-align: top;
  border-bottom: 1px solid var(--color-border);
}
.review-summary-table tr:last-child th,
.review-summary-table tr:last-child td {
  border-bottom: none;
}
.review-summary-table th {
  font-weight: 600;
  color: var(--color-text-muted);
  background: color-mix(in srgb, var(--color-border) 35%, transparent);
}
.review-summary-table--compare thead th {
  font-size: 0.72rem;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}
.review-summary-table__row--diff th,
.review-summary-table__cell--diff {
  background: color-mix(in srgb, var(--color-warn, #f59e0b) 14%, transparent);
}
.ability-block {
  margin-top: 0.85rem;
  padding-top: 0.85rem;
  border-top: 1px solid var(--color-border);
}
.ability-block:first-of-type {
  margin-top: 0.5rem;
  padding-top: 0;
  border-top: none;
}
.ability-block__title {
  margin: 0 0 0.5rem;
  font-size: 0.8rem;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}
.ability-dl {
  display: grid;
  gap: 0.4rem;
  margin: 0;
}
.ability-dl > div {
  display: grid;
  grid-template-columns: minmax(6rem, 8.5rem) 1fr;
  gap: 0.5rem;
  font-size: var(--text-sm);
}
.ability-dl dt {
  margin: 0;
  color: var(--color-text-muted);
  font-weight: 500;
}
.ability-dl dd {
  margin: 0;
}
.compare-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}
.compare-table th,
.compare-table td {
  padding: 0.55rem 0.75rem;
  text-align: left;
  vertical-align: top;
  border-bottom: 1px solid var(--color-border);
}
.compare-table thead th {
  font-size: var(--text-xs);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}
.compare-table tbody th[scope="row"] {
  width: 7.5rem;
  font-weight: 600;
  color: var(--color-text-muted);
  background: color-mix(in srgb, var(--color-surface) 70%, transparent);
  white-space: nowrap;
}
.compare-table tbody tr:last-child th,
.compare-table tbody tr:last-child td {
  border-bottom: none;
}
.compare-table__row--changed td {
  background: color-mix(in srgb, var(--color-gold-300) 6%, transparent);
}
.compare-table__cell {
  display: inline-block;
  max-width: 100%;
  word-break: break-word;
}
.compare-table__cell--current {
  color: var(--color-text-muted);
}
.compare-table__cell--proposed {
  color: var(--color-text);
}
.compare-table__cell--diff {
  font-weight: 600;
  color: var(--color-gold-300);
}
.panel--collapse summary {
  cursor: pointer;
  list-style: none;
  font-size: 0.8rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  font-weight: 650;
}
.panel--collapse summary::-webkit-details-marker {
  display: none;
}
.panel--collapse summary::before {
  content: "▸";
  display: inline-block;
  margin-right: 0.4rem;
  transition: transform var(--duration-fast, 120ms) ease;
}
.panel--collapse[open] summary::before {
  transform: rotate(90deg);
}
.panel--collapse__body {
  margin-top: 0.65rem;
}
.panel--collapse__body > p {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text);
}
.draft-editor {
  display: grid;
  gap: 0.65rem;
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  margin-top: 0.65rem;
}
.tag-fieldset {
  grid-column: 1 / -1;
  margin: 0;
  padding: 0.65rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  display: grid;
  gap: 0.55rem;
  min-width: 0;
}
.tag-fieldset legend {
  padding: 0 0.15rem;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}
.tag-fieldset__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
  gap: 0.45rem;
}
.tag-toggle {
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
  margin: 0;
  min-width: 0;
  padding: 0.45rem 0.55rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-bg);
  font-size: var(--text-xs);
  line-height: 1.3;
  color: var(--color-text-muted);
  cursor: pointer;
  user-select: none;
}
.tag-toggle:hover:not(:has(.tag-toggle__input:disabled)) {
  border-color: color-mix(in srgb, var(--color-gold-300) 35%, var(--color-border));
  color: var(--color-text);
}
.tag-toggle--active,
.tag-toggle:has(.tag-toggle__input:checked) {
  border-color: color-mix(in srgb, var(--color-gold-300) 55%, var(--color-border));
  background: color-mix(in srgb, var(--color-gold-300) 12%, var(--color-surface));
  color: var(--color-text);
}
.tag-toggle__input {
  width: 0.95rem;
  height: 0.95rem;
  margin: 0.1rem 0 0;
  flex-shrink: 0;
  accent-color: var(--color-brand);
  cursor: pointer;
  color-scheme: dark;
}
.tag-toggle__input:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}
.tag-toggle__label {
  min-width: 0;
  word-break: break-word;
}
.bindings {
  grid-column: 1 / -1;
  display: grid;
  gap: 0.5rem;
}
.bindings__header h4 {
  margin: 0;
  margin-right: auto;
}
.binding-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: end;
}
.binding-row label {
  flex: 1 1 8rem;
  min-width: 8rem;
  max-width: 16rem;
}
.technical__body {
  display: grid;
  gap: 0.65rem;
}
.technical pre,
.audit-list pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  padding: 0.65rem 0.75rem;
  font-family: var(--font-data);
  font-size: var(--text-xs);
  line-height: 1.45;
  overflow: auto;
  max-height: 18rem;
}
.sources {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.15rem 0;
  border-top: 1px solid var(--color-border);
  padding-top: 0.5rem;
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  line-height: 1.35;
}
.sources__sep {
  margin: 0 0.4rem;
  opacity: 0.7;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.mobile-back {
  display: none;
}
@media (max-width: 960px) {
  .split {
    grid-template-columns: 1fr;
  }
  .item-list--hidden-mobile {
    display: none;
  }
  .detail--hidden-mobile {
    display: none;
  }
  .split:not(.split--detail) .detail {
    display: none;
  }
  .mobile-back {
    display: inline-flex;
  }
}
</style>
