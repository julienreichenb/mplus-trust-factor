import type { SelectedTalentDTO } from "../api/types";

/**
 * Normalize selected talents for icon-grid display:
 * - drop nodes that cannot show a Wowhead tooltip (no spellId)
 * - merge same-name nodes within a tree (multi-rank / apex talents
 *   often arrive as one Blizzard entry per rank with distinct spell ids)
 */
export function mergeSelectedTalentsForDisplay(
  talents: SelectedTalentDTO[],
): SelectedTalentDTO[] {
  const usable = talents.filter((talent) => talent.spellId != null);
  const groups = new Map<string, SelectedTalentDTO[]>();
  const order: string[] = [];

  for (const talent of usable) {
    const nameKey = talent.name?.trim().toLowerCase();
    const key =
      nameKey && nameKey.length > 0
        ? `${talent.tree}|${nameKey}`
        : `spell:${talent.spellId}`;
    const existing = groups.get(key);
    if (existing) {
      existing.push(talent);
      continue;
    }
    groups.set(key, [talent]);
    order.push(key);
  }

  return order.map((key) => {
    const entries = groups.get(key)!;
    if (entries.length === 1) return entries[0]!;

    // Prefer the highest-rank (then highest id) node for tooltip / icon.
    const primary = [...entries].sort((a, b) => {
      const rankDelta = (b.rank ?? 0) - (a.rank ?? 0);
      if (rankDelta !== 0) return rankDelta;
      return (b.id ?? 0) - (a.id ?? 0);
    })[0]!;

    return {
      ...primary,
      // Each selected Blizzard node is one invested point in this named talent.
      rank: entries.length,
      iconUrl: entries.find((entry) => entry.iconUrl)?.iconUrl ?? primary.iconUrl,
    };
  });
}
