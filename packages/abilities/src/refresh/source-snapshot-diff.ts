import type { SimcSpellQueryExport, SimcSpellQuerySpell } from "./sources/simc.js";
import type { SourceSnapshotDiffEntry, SourceSnapshotDiffReport, SourceSnapshotDiffStatus } from "./types.js";

function querySet(file: SimcSpellQueryExport): string {
  const queries = [
    ...new Set(
      file.inventories
        .map((i) => i.queryExpression)
        .filter((q): q is string => Boolean(q)),
    ),
  ].sort();
  return queries.join(",");
}

function comparable(previous: SimcSpellQueryExport, current: SimcSpellQueryExport): string | null {
  if (previous.schemaVersion !== current.schemaVersion) return "schemaVersion mismatch";
  if (querySet(previous) !== querySet(current) || (querySet(previous) === "" && querySet(current) === "")) {
    const prevQ = querySet(previous);
    const curQ = querySet(current);
    if (prevQ !== curQ) return "query/scope mismatch; REMOVED is not comparable";
  }
  if ((previous.binaryIdentity?.dataMode ?? "LIVE") !== (current.binaryIdentity?.dataMode ?? "LIVE")) {
    return "dataMode mismatch";
  }
  return null;
}

function key(spell: SimcSpellQuerySpell): number {
  return spell.spellId;
}

function metadataChanged(a: SimcSpellQuerySpell, b: SimcSpellQuerySpell): boolean {
  return a.cooldownSeconds !== b.cooldownSeconds || a.charges !== b.charges || a.isPassive !== b.isPassive || a.name !== b.name;
}

function applicabilityChanged(a: SimcSpellQuerySpell, b: SimcSpellQuerySpell): boolean {
  return (
    (a.classSlug ?? null) !== (b.classSlug ?? null) ||
    JSON.stringify([...(a.specSlugs ?? [])].sort()) !== JSON.stringify([...(b.specSlugs ?? [])].sort()) ||
    JSON.stringify([...(a.raceSlugs ?? [])].sort()) !== JSON.stringify([...(b.raceSlugs ?? [])].sort())
  );
}

function effectChanged(a: SimcSpellQuerySpell, b: SimcSpellQuerySpell): boolean {
  const ar = (a.bindings ?? []).map((x) => `${x.spellId}:${x.role}`).sort().join(",");
  const br = (b.bindings ?? []).map((x) => `${x.spellId}:${x.role}`).sort().join(",");
  return ar !== br;
}

export function diffSimcSourceSnapshots(input: {
  previous: SimcSpellQueryExport;
  current: SimcSpellQueryExport;
}): SourceSnapshotDiffReport {
  const reason = comparable(input.previous, input.current);
  const emptyTotals = (): Record<SourceSnapshotDiffStatus, number> => ({
    ADDED: 0,
    REMOVED: 0,
    METADATA_CHANGED: 0,
    APPLICABILITY_CHANGED: 0,
    EFFECT_CHANGED: 0,
    UNCHANGED: 0,
    NOT_COMPARABLE: 0,
  });
  if (reason) {
    const totals = emptyTotals();
    totals.NOT_COMPARABLE = 1;
    return {
      comparable: false,
      previousRevision: input.previous.simcCommitSha,
      currentRevision: input.current.simcCommitSha,
      entries: [
        {
          status: "NOT_COMPARABLE",
          spellId: 0,
          name: "scope",
          notes: [reason, "Absence cannot be treated as REMOVED."],
        },
      ],
      totals,
    };
  }
  const prev = new Map(input.previous.spells.map((s) => [key(s), s]));
  const cur = new Map(input.current.spells.map((s) => [key(s), s]));
  const entries: SourceSnapshotDiffEntry[] = [];
  for (const [id, spell] of cur) {
    const before = prev.get(id);
    if (!before) {
      entries.push({ status: "ADDED", spellId: id, name: spell.name, notes: ["Present in current query snapshot only."] });
      continue;
    }
    if (effectChanged(before, spell)) {
      entries.push({ status: "EFFECT_CHANGED", spellId: id, name: spell.name, notes: ["Bindings/effects changed between equivalent queries."] });
    } else if (applicabilityChanged(before, spell)) {
      entries.push({ status: "APPLICABILITY_CHANGED", spellId: id, name: spell.name, notes: ["Class/spec/race ownership changed."] });
    } else if (metadataChanged(before, spell)) {
      entries.push({ status: "METADATA_CHANGED", spellId: id, name: spell.name, notes: ["Cooldown/charges/passive/name changed."] });
    } else {
      entries.push({ status: "UNCHANGED", spellId: id, name: spell.name, notes: [] });
    }
  }
  for (const [id, spell] of prev) {
    if (!cur.has(id)) {
      entries.push({
        status: "REMOVED",
        spellId: id,
        name: spell.name,
        notes: ["Present in previous equivalent query snapshot and absent now. Not an AbilityRule delete."],
      });
    }
  }
  const totals = emptyTotals();
  for (const e of entries) totals[e.status] += 1;
  return {
    comparable: true,
    previousRevision: input.previous.simcCommitSha,
    currentRevision: input.current.simcCommitSha,
    entries: entries.sort((a, b) => a.spellId - b.spellId || a.status.localeCompare(b.status)),
    totals,
  };
}

export function removalReviewFromTemporalDiff(
  temporal: SourceSnapshotDiffReport | undefined,
  currentRuleSpellIds: Set<number>,
): number[] {
  if (!temporal?.comparable) return [];
  return temporal.entries
    .filter((e) => e.status === "REMOVED" && currentRuleSpellIds.has(e.spellId))
    .map((e) => e.spellId);
}
