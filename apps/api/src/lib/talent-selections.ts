import type { SelectedTalentDTO, TalentTreeKind } from "@mplus/contracts";

type RawLoadout = {
  is_active?: boolean;
  talent_loadout_code?: string;
  selected_class_talents?: unknown[];
  selected_spec_talents?: unknown[];
  selected_hero_talents?: unknown[];
  selected_hero_talent_tree?: { id?: number; name?: string };
};

type RawSpecEntry = {
  specialization?: { id?: number; name?: string };
  loadouts?: RawLoadout[];
};

function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function mapSelectedNode(raw: unknown, tree: TalentTreeKind): SelectedTalentDTO | null {
  if (!raw || typeof raw !== "object") return null;
  const node = raw as {
    id?: unknown;
    rank?: unknown;
    tooltip?: {
      talent?: { id?: unknown; name?: unknown };
      spell_tooltip?: { spell?: { id?: unknown; name?: unknown } };
    };
  };
  const talentId = positiveInt(node.tooltip?.talent?.id) ?? positiveInt(node.id);
  const spellId = positiveInt(node.tooltip?.spell_tooltip?.spell?.id);
  const name =
    readString(node.tooltip?.talent?.name) ??
    readString(node.tooltip?.spell_tooltip?.spell?.name);
  const rank =
    typeof node.rank === "number" && Number.isFinite(node.rank) && node.rank > 0
      ? Math.round(node.rank)
      : null;
  if (talentId == null && spellId == null && !name) return null;
  return {
    id: talentId,
    name,
    spellId,
    rank,
    tree,
    iconUrl: null,
  };
}

function mapTree(rawNodes: unknown[] | undefined, tree: TalentTreeKind): SelectedTalentDTO[] {
  if (!Array.isArray(rawNodes)) return [];
  return rawNodes
    .map((node) => mapSelectedNode(node, tree))
    .filter((node): node is SelectedTalentDTO => node != null);
}

/** Prefer `is_active` loadout, else first entry. */
export function pickActiveLoadout(loadouts: RawLoadout[] | undefined): RawLoadout | null {
  if (!Array.isArray(loadouts) || loadouts.length === 0) return null;
  return loadouts.find((entry) => entry.is_active === true) ?? loadouts[0] ?? null;
}

/**
 * Extract selected Class / Spec / Hero talents from a Blizzard specializations payload
 * (or the stored `{ specializations, activeSpecialization }` snapshot blob).
 */
export function extractSelectedTalents(talentsBlob: unknown): SelectedTalentDTO[] {
  if (!talentsBlob || typeof talentsBlob !== "object") return [];
  const root = talentsBlob as {
    specializations?: RawSpecEntry[];
    activeSpecialization?: { id?: number; name?: string };
    selectedTalents?: SelectedTalentDTO[];
  };

  // Prefer already-enriched list from ingest when present.
  if (Array.isArray(root.selectedTalents) && root.selectedTalents.length > 0) {
    return root.selectedTalents.filter((t) => t && typeof t === "object");
  }

  const specs = Array.isArray(root.specializations) ? root.specializations : [];
  const activeId = root.activeSpecialization?.id;
  const activeEntry =
    (activeId != null
      ? specs.find((entry) => entry.specialization?.id === activeId)
      : null) ?? specs[0] ?? null;
  if (!activeEntry) return [];

  const loadout = pickActiveLoadout(activeEntry.loadouts);
  if (!loadout) return [];

  const selected = [
    ...mapTree(loadout.selected_class_talents, "CLASS"),
    ...mapTree(loadout.selected_spec_talents, "SPEC"),
    ...mapTree(loadout.selected_hero_talents, "HERO"),
  ];

  // De-dupe by spellId then talent id (hero nodes can appear in spec lists historically).
  const seen = new Set<string>();
  const unique: SelectedTalentDTO[] = [];
  for (const talent of selected) {
    const key = talent.spellId != null ? `s:${talent.spellId}` : `t:${talent.id ?? talent.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(talent);
  }
  return unique;
}

export function loadoutCodeFromTalentsBlob(talentsBlob: unknown): string | null {
  if (!talentsBlob || typeof talentsBlob !== "object") return null;
  const root = talentsBlob as {
    specializations?: RawSpecEntry[];
    activeSpecialization?: { id?: number };
  };
  const specs = Array.isArray(root.specializations) ? root.specializations : [];
  const activeId = root.activeSpecialization?.id;
  const activeEntry =
    (activeId != null
      ? specs.find((entry) => entry.specialization?.id === activeId)
      : null) ?? specs[0] ?? null;
  const code = pickActiveLoadout(activeEntry?.loadouts)?.talent_loadout_code;
  return typeof code === "string" && code.trim() ? code.trim() : null;
}

/** Active hero tree name from loadout or root `activeHeroTalentTree` / Blizzard field. */
export function heroTalentNameFromTalentsBlob(talentsBlob: unknown): string | null {
  if (!talentsBlob || typeof talentsBlob !== "object") return null;
  const root = talentsBlob as {
    specializations?: RawSpecEntry[];
    activeSpecialization?: { id?: number };
    activeHeroTalentTree?: { id?: number; name?: string };
    heroTalentName?: string | null;
  };

  const direct = readString(root.heroTalentName) ?? readString(root.activeHeroTalentTree?.name);
  if (direct) return direct;

  const specs = Array.isArray(root.specializations) ? root.specializations : [];
  const activeId = root.activeSpecialization?.id;
  const activeEntry =
    (activeId != null
      ? specs.find((entry) => entry.specialization?.id === activeId)
      : null) ?? specs[0] ?? null;
  return readString(pickActiveLoadout(activeEntry?.loadouts)?.selected_hero_talent_tree?.name);
}
