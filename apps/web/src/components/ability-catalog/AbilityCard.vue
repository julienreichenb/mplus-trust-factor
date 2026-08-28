<script setup lang="ts">
import type { AdminAbilityEntry } from "@mplus/abilities";
import SpellWowIcon from "./SpellWowIcon.vue";
import DisclosureChevron from "./DisclosureChevron.vue";
import { wowheadSpellUrl } from "../../integrations/wowhead/urls";
import { computed, ref, watch } from "vue";

const props = defineProps<{
  entry: AdminAbilityEntry;
  /** When true, open the collapse (e.g. deep-link target). */
  open?: boolean;
  pendingManualEdit?: {
    canonicalKey: string;
    draftRuleId: string;
    version: number;
    status: string;
    name: string;
  } | null;
}>();

defineEmits<{
  edit: [];
  editDraft: [];
  discardEdit: [];
}>();

const detailsRef = ref<HTMLDetailsElement | null>(null);
const expanded = ref(false);

const spellId = computed(() => props.entry.rule.spellIds[0] ?? null);
const spellUrl = computed(() => (spellId.value != null ? wowheadSpellUrl(spellId.value) : null));
const iconName = computed(
  () => props.entry.external.iconName ?? props.entry.rule.iconName ?? null,
);

function formatCooldown(seconds: number | undefined): string {
  if (seconds == null) return "—";
  if (seconds >= 60) return `${Math.round(seconds / 60)}m`;
  return `${seconds}s`;
}

function badgeClass(badge: string): string {
  if (badge === "validation-error") return "badge badge-error";
  if (badge === "verified") return "badge badge-ok";
  if (badge === "uncertain") return "badge badge-warn";
  return "badge";
}

function onToggle(event: Event): void {
  const el = event.target as HTMLDetailsElement;
  expanded.value = el.open;
}

watch(
  () => props.open,
  (shouldOpen) => {
    if (!shouldOpen || !detailsRef.value) return;
    detailsRef.value.open = true;
    expanded.value = true;
  },
  { immediate: true },
);
</script>

<template>
  <details
    ref="detailsRef"
    class="ability-card"
    data-testid="ability-card"
    @toggle="onToggle"
  >
    <summary class="ability-summary">
      <a
        v-if="spellId && spellUrl"
        class="spell-icon-link"
        :href="spellUrl"
        target="_blank"
        rel="noopener noreferrer"
        :data-wowhead="`spell=${spellId}`"
        :aria-label="`${entry.rule.name} spell tooltip`"
        data-testid="spell-icon-tooltip"
        @click.stop
      >
        <SpellWowIcon
          :icon-name="iconName"
          :spell-id="spellId"
          :alt="''"
          :width="28"
          :height="28"
          class="spell-icon"
        />
      </a>
      <span
        v-else
        class="spell-icon-link spell-icon-link--static"
        role="img"
        :aria-label="entry.rule.name"
        @click.stop
      >
        <SpellWowIcon
          :icon-name="iconName"
          :spell-id="spellId"
          :alt="''"
          :width="28"
          :height="28"
          class="spell-icon"
        />
      </span>

      <span class="ability-summary-main">
        <span class="ability-name">{{ entry.rule.name }}</span>
        <span class="ability-summary-meta">
          <a
            v-if="spellId && spellUrl"
            :href="spellUrl"
            target="_blank"
            rel="noopener noreferrer"
            :data-wowhead="`spell=${spellId}`"
            class="wowhead-link spell-id"
            data-testid="ability-spell-id"
            @click.stop
          >
            {{ spellId }}
          </a>
          <span v-else class="spell-id muted">—</span>
          <span class="cooldown" :title="`Cooldown ${formatCooldown(entry.rule.cooldownSeconds)}`">
            {{ formatCooldown(entry.rule.cooldownSeconds) }}
          </span>
        </span>
      </span>

      <DisclosureChevron :expanded="expanded" />
    </summary>

    <div class="ability-body">
      <div class="ability-actions" data-testid="ability-actions">
        <span
          v-if="pendingManualEdit"
          class="badge badge-pending"
          data-testid="pending-manual-edit"
        >
          Pending edit
        </span>
        <button
          v-if="pendingManualEdit"
          type="button"
          class="btn-link"
          data-testid="catalog-edit-draft"
          @click.stop="$emit('editDraft')"
        >
          Edit draft
        </button>
        <button
          v-if="pendingManualEdit"
          type="button"
          class="btn-link"
          data-testid="catalog-discard-edit"
          @click.stop="$emit('discardEdit')"
        >
          Discard edit
        </button>
        <button
          v-else
          type="button"
          class="btn-link"
          data-testid="catalog-rule-edit"
          @click.stop="$emit('edit')"
        >
          Edit
        </button>
      </div>
      <div v-if="entry.badges.length" class="badges">
        <span v-for="badge in entry.badges" :key="badge" :class="badgeClass(badge)">{{ badge }}</span>
      </div>
      <dl class="ability-meta">
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
          <dd>{{ entry.rule.roles.join(", ") || "—" }}</dd>
        </div>
        <div>
          <dt>Provenance</dt>
          <dd>{{ entry.rule.provenance.source }} — {{ entry.rule.provenance.gameVersion }}</dd>
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
  </details>
</template>

<style scoped>
.ability-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-2);
  min-width: 0;
}

.ability-summary {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.45rem 0.65rem;
  cursor: pointer;
  list-style: none;
  min-width: 0;
}

.ability-summary::-webkit-details-marker {
  display: none;
}

.ability-summary:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
  border-radius: 8px;
}

.spell-icon {
  width: 28px;
  height: 28px;
}

.spell-icon-link {
  display: inline-flex;
  flex-shrink: 0;
  border-radius: 4px;
  line-height: 0;
  text-decoration: none;
  color: inherit;
}

.spell-icon-link:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}

.spell-icon-link--static {
  cursor: default;
}

.ability-summary-main {
  display: flex;
  flex: 1;
  align-items: baseline;
  gap: 0.65rem 1rem;
  min-width: 0;
  flex-wrap: wrap;
}

.ability-name {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ability-summary-meta {
  display: inline-flex;
  align-items: center;
  gap: 0.75rem;
  color: var(--muted);
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.spell-id {
  font-family: ui-monospace, monospace;
}

.cooldown {
  font-weight: 600;
  color: var(--fg);
  min-width: 2.25rem;
  text-align: right;
}

.ability-body {
  padding: 0 0.65rem 0.65rem 2.85rem;
  min-width: 0;
}

.ability-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
  margin-bottom: 0.45rem;
}

.badge-pending {
  background: color-mix(in srgb, var(--warn) 25%, transparent);
  color: var(--warn);
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  padding: 0.15rem 0.4rem;
  border-radius: 4px;
}

.btn-link {
  border: none;
  background: none;
  color: var(--accent);
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  padding: 0;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.btn-link:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.badges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin-bottom: 0.4rem;
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
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 1.1rem;
  margin: 0;
  font-size: 0.82rem;
}

.ability-meta > div {
  display: inline-flex;
  align-items: baseline;
  gap: 0.35rem;
  min-width: 0;
}

.ability-meta dt {
  color: var(--muted);
  font-weight: 600;
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.ability-meta dd {
  margin: 0;
  word-break: break-word;
}

@media (min-width: 900px) {
  .ability-meta {
    flex-wrap: nowrap;
    overflow-x: auto;
    padding-bottom: 0.15rem;
  }

  .ability-meta > div {
    flex: 0 0 auto;
    white-space: nowrap;
  }

  .ability-meta dd {
    word-break: normal;
  }
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

.muted {
  color: var(--muted);
}

.notes {
  margin: 0.45rem 0 0;
  font-size: 0.85rem;
}

.entry-issues {
  margin: 0.45rem 0 0;
  padding-left: 1.1rem;
  color: var(--danger);
  font-size: 0.85rem;
}
</style>
