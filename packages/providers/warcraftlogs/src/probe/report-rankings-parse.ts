/**
 * Pure parser for WCL Report.rankings JSON (probe / discovery only).
 * Preserves percentile 0 — never treat 0 as missing.
 */
import {
  extractFriendlyPlayerActorIds,
  nameRealmMatches,
  type FightFriendlyPlayerEntry,
} from "../discovery/fight-ownership.js";
import { parseJsonScalar } from "./performance-probe-logic.js";

export interface ReportActorRef {
  id: number;
  name: string;
  type: string;
  subType?: string | null;
  server?: string | null;
}

export interface FightRankingRow {
  fightId: number | null;
  /** Report-local actor id after alignment; null until aligned. */
  actorId: number | null;
  /** WCL global character id from rankings JSON `id` (not fight actor id). */
  wclCharacterId: number | null;
  name: string | null;
  server: string | null;
  spec: string | null;
  className: string | null;
  role: string | null;
  metric: string | null;
  amount: number | null;
  rankPercent: number | null;
  bracketPercent: number | null;
  genericPercentile: number | null;
  /** Probe diagnostics only. 0 is preserved when present. */
  percentileDiagnostics: Record<string, unknown>;
  alignment: "name_server" | "unaligned" | "ambiguous";
  extraKeys: string[];
}

export interface ParsedFightRankings {
  fightId: number | null;
  rows: FightRankingRow[];
  rawShape: string;
  roleBuckets: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/** 0 is a valid percentile. */
export function readFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

const PERCENTILE_DIAGNOSTIC_KEYS = [
  "bracket",
  "bracketData",
  "best",
  "totalParses",
  "duration",
  "itemLevel",
  "size",
  "guildName",
] as const;

function pickPercentileDiagnostics(node: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of PERCENTILE_DIAGNOSTIC_KEYS) {
    if (Object.prototype.hasOwnProperty.call(node, key)) {
      out[key] = node[key];
    }
  }
  return out;
}

function serverName(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (isRecord(value)) {
    return readString(value.name) ?? readString(value.slug);
  }
  return null;
}

function collectCharacterNodes(root: unknown): Array<{ node: Record<string, unknown>; role: string | null; fightId: number | null }> {
  const out: Array<{ node: Record<string, unknown>; role: string | null; fightId: number | null }> = [];

  const visit = (value: unknown, role: string | null, fightId: number | null): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, role, fightId);
      return;
    }
    if (!isRecord(value)) return;

    const nextFight =
      readFiniteNumber(value.fightID) ?? readFiniteNumber(value.fightId) ?? fightId;

    if (isRecord(value.roles)) {
      for (const [roleKey, bucket] of Object.entries(value.roles)) {
        visit(bucket, roleKey, nextFight);
      }
      return;
    }
    if (Array.isArray(value.characters)) {
      for (const row of value.characters) {
        if (isRecord(row)) out.push({ node: row, role, fightId: nextFight });
      }
      return;
    }
    if (Array.isArray(value.rankings)) {
      visit(value.rankings, role, nextFight);
      return;
    }
    if (Array.isArray(value.data)) {
      visit(value.data, role, nextFight);
      return;
    }

    const looksLikePlayer =
      (typeof value.id === "number" || typeof value.name === "string") &&
      ("bracketPercent" in value || "rankPercent" in value || "percentile" in value || "amount" in value);
    if (looksLikePlayer) {
      out.push({ node: value, role, fightId: nextFight });
    }
  };

  visit(root, null, null);
  return out;
}

function describeShape(root: unknown): string {
  if (root == null) return "null";
  if (Array.isArray(root)) return `array(len=${root.length})`;
  if (!isRecord(root)) return typeof root;
  const keys = Object.keys(root).sort();
  return `object{${keys.join(",")}}`;
}

export function parseReportRankingsJson(input: {
  rankings: unknown;
  fightId?: number | null;
}): ParsedFightRankings {
  const parsed = parseJsonScalar(input.rankings);
  const collected = collectCharacterNodes(parsed);
  const roleBuckets = [
    ...new Set(collected.map((c) => c.role).filter((r): r is string => Boolean(r))),
  ];
  const rows: FightRankingRow[] = collected.map((c) => {
    const wclCharacterId = readFiniteNumber(c.node.id);
    return {
      fightId: c.fightId ?? input.fightId ?? null,
      actorId: null,
      wclCharacterId: wclCharacterId != null && Number.isInteger(wclCharacterId) ? wclCharacterId : null,
      name: readString(c.node.name),
      server: serverName(c.node.server),
      spec: readString(c.node.spec) ?? readString(c.node.specName),
      className: readString(c.node.class) ?? readString(c.node.className),
      role: c.role,
      metric: readString(c.node.metric),
      amount: readFiniteNumber(c.node.amount),
      rankPercent: readFiniteNumber(c.node.rankPercent),
      bracketPercent: readFiniteNumber(c.node.bracketPercent),
      genericPercentile: readFiniteNumber(c.node.percentile),
      percentileDiagnostics: pickPercentileDiagnostics(c.node),
      alignment: "unaligned",
      extraKeys: Object.keys(c.node).sort(),
    };
  });
  return {
    fightId: input.fightId ?? rows[0]?.fightId ?? null,
    rows,
    rawShape: describeShape(parsed),
    roleBuckets,
  };
}

export function alignRankingRowsToFightActors(input: {
  rows: FightRankingRow[];
  actors: ReportActorRef[];
  friendlyPlayers: unknown;
}): FightRankingRow[] {
  const friendlyIds = new Set(
    extractFriendlyPlayerActorIds(input.friendlyPlayers as FightFriendlyPlayerEntry[] | null),
  );
  const fightActors = input.actors.filter((a) => a.type === "Player" && friendlyIds.has(a.id));
  return input.rows.map((row) => {
    // rankings.characters[].id is a WCL global character id, never a report actor id.
    if (row.name && row.server) {
      const matches = fightActors.filter((a) => nameRealmMatches(a.name, a.server, row.name!, row.server!));
      if (matches.length === 1) {
        const actor = matches[0]!;
        return {
          ...row,
          actorId: actor.id,
          alignment: "name_server",
          name: row.name ?? actor.name,
          server: row.server ?? actor.server ?? null,
        };
      }
      if (matches.length > 1) {
        return { ...row, actorId: null, alignment: "ambiguous" };
      }
    }
    return { ...row, actorId: null, alignment: "unaligned" };
  });
}

export interface SelectedFightRankings {
  rows: FightRankingRow[];
  ambiguousActorIds: number[];
  duplicateWclCharacterIds: number[];
}

/**
 * Persistable friendly-player rankings: unique report actor, unique WCL character id.
 * Ambiguous matches are dropped rather than guessed.
 */
export function selectAlignedFriendlyRankings(input: {
  rankings: unknown;
  actors: ReportActorRef[];
  friendlyPlayers: unknown;
  fightId?: number | null;
}): SelectedFightRankings {
  let parsed: ParsedFightRankings;
  try {
    parsed = parseReportRankingsJson({ rankings: input.rankings, fightId: input.fightId });
  } catch {
    return { rows: [], ambiguousActorIds: [], duplicateWclCharacterIds: [] };
  }
  const aligned = alignRankingRowsToFightActors({
    rows: parsed.rows,
    actors: input.actors,
    friendlyPlayers: input.friendlyPlayers,
  });
  const byActor = new Map<number, FightRankingRow[]>();
  const ambiguousActorIds: number[] = [];
  for (const row of aligned) {
    if (row.alignment === "ambiguous") continue;
    if (row.actorId == null) continue;
    const list = byActor.get(row.actorId) ?? [];
    list.push(row);
    byActor.set(row.actorId, list);
  }
  const uniqueByActor: FightRankingRow[] = [];
  for (const [actorId, rows] of byActor) {
    if (rows.length !== 1) {
      ambiguousActorIds.push(actorId);
      continue;
    }
    uniqueByActor.push(rows[0]!);
  }
  const byWcl = new Map<number, FightRankingRow[]>();
  for (const row of uniqueByActor) {
    if (row.wclCharacterId == null) continue;
    const list = byWcl.get(row.wclCharacterId) ?? [];
    list.push(row);
    byWcl.set(row.wclCharacterId, list);
  }
  const duplicateWclCharacterIds: number[] = [];
  const dropActors = new Set<number>();
  for (const [wclId, rows] of byWcl) {
    if (rows.length <= 1) continue;
    duplicateWclCharacterIds.push(wclId);
    for (const row of rows) {
      if (row.actorId != null) dropActors.add(row.actorId);
    }
  }
  return {
    rows: uniqueByActor.filter((r) => r.actorId == null || !dropActors.has(r.actorId)),
    ambiguousActorIds,
    duplicateWclCharacterIds,
  };
}

export function friendlyActorsMissingRankings(input: {
  rows: FightRankingRow[];
  actors: ReportActorRef[];
  friendlyPlayers: unknown;
}): ReportActorRef[] {
  const friendlyIds = new Set(
    extractFriendlyPlayerActorIds(input.friendlyPlayers as FightFriendlyPlayerEntry[] | null),
  );
  const rankedIds = new Set(input.rows.map((r) => r.actorId).filter((id): id is number => id != null));
  return input.actors.filter((a) => a.type === "Player" && friendlyIds.has(a.id) && !rankedIds.has(a.id));
}
