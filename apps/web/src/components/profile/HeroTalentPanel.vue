<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { SelectedTalentDTO, TalentSummary, TalentTreeKind } from "../../api/types";
import { wowheadSpellUrl } from "../../integrations/wowhead/urls";
import { resolveWowheadSpellIconUrls } from "../../integrations/wowhead/spellIcons";
import {
  loadWowheadTooltipScript,
  refreshWowheadTooltips,
} from "../../integrations/wowhead/tooltips";
import { mergeSelectedTalentsForDisplay } from "../../lib/talentDisplay";

const props = defineProps<{
  talents: TalentSummary | null | undefined;
  locked?: boolean;
}>();

const resolvedIcons = ref<Record<number, string>>({});

const TREE_ORDER: TalentTreeKind[] = ["CLASS", "SPEC", "HERO", "UNKNOWN"];

const selectedTalents = computed(() =>
  mergeSelectedTalentsForDisplay(props.talents?.selectedTalents ?? []),
);

const talentGroups = computed(() => {
  const groups: Array<{ tree: TalentTreeKind; label: string; talents: SelectedTalentDTO[] }> = [];
  for (const tree of TREE_ORDER) {
    const talents = selectedTalents.value.filter((talent) => talent.tree === tree);
    if (talents.length === 0) continue;
    groups.push({ tree, label: treeLabel(tree), talents });
  }
  return groups;
});

watch(
  selectedTalents,
  (talents) => {
    if (talents.length === 0) return;
    void loadWowheadTooltipScript({ iconizeLinks: false })
      .then((status) => {
        if (status === "ready") refreshWowheadTooltips();
      })
      .catch(() => {
        /* plain links remain usable */
      });

    const missingSpellIds = talents
      .filter((talent) => !talent.iconUrl && talent.spellId != null)
      .map((talent) => talent.spellId!)
      .filter((spellId) => resolvedIcons.value[spellId] == null);
    if (missingSpellIds.length === 0) return;
    void resolveWowheadSpellIconUrls(missingSpellIds).then((map) => {
      if (map.size === 0) return;
      const next = { ...resolvedIcons.value };
      for (const [spellId, url] of map) next[spellId] = url;
      resolvedIcons.value = next;
    });
  },
  { immediate: true },
);

function treeLabel(tree: TalentTreeKind): string {
  if (tree === "CLASS") return "Class";
  if (tree === "SPEC") return "Specialization";
  if (tree === "HERO") {
    const heroName = props.talents?.heroTalentName?.trim();
    return heroName ? `Hero · ${heroName}` : "Hero";
  }
  return "Other";
}

function spellHref(talent: SelectedTalentDTO): string | null {
  return talent.spellId != null ? wowheadSpellUrl(talent.spellId) : null;
}

function iconFor(talent: SelectedTalentDTO): string | null {
  if (talent.iconUrl) return talent.iconUrl;
  if (talent.spellId != null) return resolvedIcons.value[talent.spellId] ?? null;
  return null;
}
</script>

<template>
  <div class="hero-talent" data-testid="hero-talent">
    <p v-if="locked" class="muted">Talent details are locked by entitlement.</p>
    <template v-else-if="!talents?.loadoutCode?.trim() && !selectedTalents.length">
      <p class="muted">No talent loadout in this snapshot.</p>
    </template>
    <template v-else>
      <div v-if="talentGroups.length" class="hero-talent__trees" aria-label="Selected talents">
        <section
          v-for="group in talentGroups"
          :key="group.tree"
          class="hero-talent__tree"
          :aria-label="`${group.label} talents`"
        >
          <h3 class="hero-talent__tree-title">{{ group.label }}</h3>
          <ul class="hero-talent__nodes">
            <li v-for="(talent, index) in group.talents" :key="`${talent.id ?? talent.spellId}-${index}`">
              <a
                v-if="spellHref(talent)"
                class="hero-talent__node"
                :href="spellHref(talent)!"
                target="_blank"
                rel="noopener noreferrer"
                :data-wowhead="talent.spellId != null ? `spell=${talent.spellId}` : undefined"
                :title="talent.name ?? 'Talent'"
                :aria-label="talent.name ?? `Talent ${talent.spellId}`"
              >
                <img
                  v-if="iconFor(talent)"
                  class="hero-talent__icon"
                  :src="iconFor(talent)!"
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
                <span
                  v-else
                  class="hero-talent__icon hero-talent__icon--empty"
                  aria-hidden="true"
                />
                <span v-if="talent.rank != null && talent.rank > 1" class="hero-talent__rank">{{
                  talent.rank
                }}</span>
              </a>
              <div
                v-else
                class="hero-talent__node hero-talent__node--static"
                :title="talent.name ?? 'Talent'"
              >
                <img
                  v-if="iconFor(talent)"
                  class="hero-talent__icon"
                  :src="iconFor(talent)!"
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
                <span v-else class="hero-talent__icon hero-talent__icon--empty" aria-hidden="true" />
                <span v-if="talent.rank != null && talent.rank > 1" class="hero-talent__rank">{{
                  talent.rank
                }}</span>
              </div>
            </li>
          </ul>
        </section>
      </div>
      <p v-else class="muted">
        Loadout code is available, but selected talent nodes were not present in this snapshot.
        Refresh the character after logging in-game if the Armory tree is empty.
      </p>
    </template>
  </div>
</template>

<style scoped>
.hero-talent {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
}

.muted {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.hero-talent__trees {
  display: grid;
  gap: var(--space-3);
}

.hero-talent__tree-title {
  margin: 0 0 var(--space-2);
  font-family: var(--font-data);
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.hero-talent__nodes {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.hero-talent__node {
  position: relative;
  display: block;
  width: 1.75rem;
  height: 1.75rem;
  overflow: hidden;
  border-radius: var(--radius-control);
  border: 1px solid rgb(255 255 255 / 16%);
  background-color: rgb(13 13 15 / 55%);
  background-image: none !important;
  background-repeat: no-repeat;
  box-shadow:
    0 4px 12px rgb(0 0 0 / 28%),
    inset 0 1px 0 rgb(255 255 255 / 8%);
  text-decoration: none;
  transition:
    border-color var(--duration-fast),
    transform var(--duration-fast);
}

.hero-talent__node--static {
  cursor: default;
}

.hero-talent__node:hover,
.hero-talent__node:focus-visible {
  border-color: var(--color-gold-300);
  transform: translateY(-1px);
  outline: none;
}

.hero-talent__icon {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: inherit;
}

.hero-talent__node :deep(img.iconsmall),
.hero-talent__node :deep(img:not(.hero-talent__icon)) {
  display: none !important;
}

.hero-talent__icon--empty {
  background:
    linear-gradient(145deg, rgb(244 213 141 / 18%), transparent 55%),
    var(--color-iron-800);
}

.hero-talent__rank {
  position: absolute;
  right: -0.15rem;
  bottom: -0.15rem;
  min-width: 0.85rem;
  height: 0.85rem;
  padding: 0 0.15rem;
  border-radius: 999px;
  background: var(--color-obsidian-900);
  border: 1px solid rgb(244 213 141 / 45%);
  color: var(--color-gold-300);
  font-family: var(--font-data);
  font-size: 0.55rem;
  font-weight: 700;
  line-height: 0.85rem;
  text-align: center;
}
</style>
