import type {
  CanonicalDungeonEvidencePublicDTO,
  CanonicalEvidenceReportPublicDTO,
  RunCooldownTimelinePublicDTO,
  ScoreCalculationPublicDTO,
  ScoreExplainabilityV2PublicDTO,
  ScoringRunSelection,
} from "@mplus/contracts";

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const DIMENSION_LABELS: Record<string, string> = {
  performance: "Performance",
  survival: "Survival",
  utility: "Utility",
  experience: "Experience",
};

export function projectScoreCalculationPublic(input: {
  overallFormula?: string | null;
  role?: "DPS" | "TANK" | "HEALER" | null;
  effectiveWeights?: Partial<Record<string, number>> | null;
  dimensionScores?: Partial<Record<string, number | null>> | null;
  performanceMix?: ScoreCalculationPublicDTO["performanceMix"];
}): ScoreCalculationPublicDTO {
  const weights = input.effectiveWeights ?? {};
  const scores = input.dimensionScores ?? {};
  const keys = ["performance", "survival", "utility", "experience"];
  const components = keys
    .filter((key) => weights[key] != null || scores[key] != null)
    .map((key) => {
      const weight = readNumber(weights[key]);
      const score = readNumber(scores[key] ?? null);
      return {
        key,
        label: DIMENSION_LABELS[key] ?? key,
        score,
        effectiveWeight: weight,
        contribution: weight != null && score != null ? weight * score : null,
      };
    });

  return {
    overallFormula: input.overallFormula ?? null,
    role: input.role ?? null,
    components,
    performanceMix: input.performanceMix ?? null,
  };
}

function dungeonKey(slug: string | null | undefined): string {
  let key = (slug ?? "")
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "");
  if (key.startsWith("the") && key.length > 6) key = key.slice(3);
  return key;
}

function wclReportFightKey(url: string | null | undefined): string | null {
  if (!url) return null;
  const report = url.match(/warcraftlogs\.com\/reports\/([A-Za-z0-9]+)/i);
  if (!report?.[1]) return null;
  const fight = url.match(/[?&]fight=(\d+)/i);
  return fight?.[1] ? `${report[1].toLowerCase()}:${fight[1]}` : report[1].toLowerCase();
}

export function projectCanonicalDungeonEvidence(input: {
  scoringRunSelection?: ScoringRunSelection | null;
  explainabilityV2?: ScoreExplainabilityV2PublicDTO | null;
  wclUrlByRunId?: Record<string, string | null>;
  persistedEvidenceSlots?: CanonicalPersistedEvidenceSlot[];
  manifestSlots?: CanonicalManifestSlot[];
  digestFacts?: CanonicalDigestSlotFacts[];
  cooldownByFightKey?: Record<string, RunCooldownTimelinePublicDTO>;
}): CanonicalDungeonEvidencePublicDTO[] {
  const persisted = input.persistedEvidenceSlots ?? [];
  if (persisted.length > 0) {
    const v2Slots = input.explainabilityV2?.selectedRuns ?? [];
    const manifestBySlot = new Map(
      (input.manifestSlots ?? []).map((slot) => [
        `${dungeonKey(slot.dungeonSlug)}:${slot.slotIndex}`,
        slot,
      ]),
    );
    const manifestByFight = new Map<string, CanonicalManifestSlot>();
    for (const slot of input.manifestSlots ?? []) {
      const fightKey = fightIdentityKey(slot.reportCode, slot.fightId);
      if (fightKey) manifestByFight.set(fightKey, slot);
    }
    const selectionByDungeon = new Map(
      (input.scoringRunSelection?.selectedRuns ?? []).map((run) => [dungeonKey(run.dungeonSlug), run]),
    );
    const selectionByWcl = new Map<string, ScoringRunSelection["selectedRuns"][number]>();
    for (const run of input.scoringRunSelection?.selectedRuns ?? []) {
      const url = run.canonicalRunId ? input.wclUrlByRunId?.[run.canonicalRunId] ?? null : null;
      const key = wclReportFightKey(url);
      if (!key) continue;
      selectionByWcl.set(key, run);
      selectionByWcl.set(key.split(":")[0]!, run);
    }
    const digestByFight = new Map<string, CanonicalDigestSlotFacts>();
    for (const fact of input.digestFacts ?? []) {
      const key = fightIdentityKey(fact.reportCode, fact.fightId);
      if (key) digestByFight.set(key, fact);
    }
    const byDungeon = new Map<string, CanonicalDungeonEvidencePublicDTO>();
    const ordered = [...persisted].sort((a, b) => {
      if (a.dungeonSlug !== b.dungeonSlug) return a.dungeonSlug.localeCompare(b.dungeonSlug);
      return a.slotIndex - b.slotIndex;
    });
    for (const slot of ordered) {
      const slotKey = dungeonKey(slot.dungeonSlug);
      const persistedWclKey = wclReportFightKey(slot.wclUrl);
      const selection =
        selectionByDungeon.get(slotKey) ??
        (persistedWclKey ? selectionByWcl.get(persistedWclKey) : undefined) ??
        (persistedWclKey ? selectionByWcl.get(persistedWclKey.split(":")[0]!) : undefined);
      const v2Slot = v2Slots.find(
        (r) => dungeonKey(r.dungeonSlug) === slotKey && r.slotIndex === slot.slotIndex,
      );
      const fightKey = fightIdentityKey(slot.reportCode, slot.fightId);
      const manifestSlot =
        (fightKey ? manifestByFight.get(fightKey) : undefined) ??
        manifestBySlot.get(`${slotKey}:${slot.slotIndex}`);
      const digestFact = fightKey ? digestByFight.get(fightKey) : undefined;
      const name = slot.dungeonName?.trim() || selection?.dungeonName || slot.dungeonSlug;
      let row = byDungeon.get(slot.dungeonSlug);
      if (!row) {
        row = { dungeonSlug: slot.dungeonSlug, dungeonName: name, reports: [] };
        byDungeon.set(slot.dungeonSlug, row);
      }
      const usePrimarySelection = slot.slotIndex === 0;
      const identity: CanonicalEvidenceReportPublicDTO["identity"] =
        slot.slotIndex === 1 ? "SECONDARY" : "PRIMARY";
      row.reports.push({
        identity,
        keyLevel:
          slot.keyLevel ??
          digestFact?.keyLevel ??
          v2Slot?.keyLevel ??
          manifestSlot?.keyLevel ??
          (usePrimarySelection ? selection?.keyLevel ?? null : null),
        completedAt:
          slot.completedAt ??
          digestFact?.completedAt ??
          manifestSlot?.completedAt ??
          (usePrimarySelection ? selection?.completedAt ?? null : null),
        wclUrl: slot.wclUrl,
        cooldownTimeline:
          identity === "PRIMARY"
            ? ((fightKey ? input.cooldownByFightKey?.[fightKey] : undefined) ?? {
                status: "UNAVAILABLE",
                durationMs: null,
                events: [],
                truncated: false,
                totalEventCount: 0,
              })
            : null,
      });
    }
    return [...byDungeon.values()];
  }

  const v2 = input.explainabilityV2?.selectedRuns ?? [];
  const byDungeon = new Map<string, CanonicalDungeonEvidencePublicDTO>();

  const ensure = (slug: string, name: string): CanonicalDungeonEvidencePublicDTO => {
    let row = byDungeon.get(slug);
    if (!row) {
      row = { dungeonSlug: slug, dungeonName: name, reports: [] };
      byDungeon.set(slug, row);
    }
    return row;
  };

  if (v2.length > 0) {
    for (const slot of v2) {
      const identity: CanonicalEvidenceReportPublicDTO["identity"] =
        slot.slotIndex === 1 ? "SECONDARY" : "PRIMARY";
      const selection = input.scoringRunSelection?.selectedRuns.find(
        (r) => dungeonKey(r.dungeonSlug) === dungeonKey(slot.dungeonSlug),
      );
      const runId = identity === "PRIMARY" ? selection?.canonicalRunId ?? null : null;
      const completedAt = identity === "PRIMARY" ? selection?.completedAt ?? null : null;
      const wclUrl = runId ? input.wclUrlByRunId?.[runId] ?? null : null;
      const row = ensure(slot.dungeonSlug, selection?.dungeonName ?? slot.dungeonSlug);
      row.reports.push({
        identity,
        keyLevel: slot.keyLevel ?? (identity === "PRIMARY" ? selection?.keyLevel ?? null : null),
        completedAt,
        wclUrl: wclUrl ?? null,
        cooldownTimeline:
          identity === "PRIMARY"
            ? { status: "UNAVAILABLE", durationMs: null, events: [], truncated: false, totalEventCount: 0 }
            : null,
      });
    }
    return [...byDungeon.values()];
  }

  for (const run of input.scoringRunSelection?.selectedRuns ?? []) {
    const row = ensure(run.dungeonSlug, run.dungeonName);
    const wclUrl = run.canonicalRunId ? input.wclUrlByRunId?.[run.canonicalRunId] ?? null : null;
    row.reports.push({
      identity: "PRIMARY",
      keyLevel: run.keyLevel,
      completedAt: run.completedAt,
      wclUrl,
      cooldownTimeline: {
        status: "UNAVAILABLE",
        durationMs: null,
        events: [],
        truncated: false,
        totalEventCount: 0,
      },
    });
  }
  return [...byDungeon.values()];
}

export interface CanonicalPersistedEvidenceSlot {
  dungeonSlug: string;
  dungeonName?: string | null;
  slotIndex: 0 | 1;
  keyLevel: number | null;
  completedAt: string | null;
  wclUrl: string | null;
  /** Internal join only — never copied onto the public DTO. */
  reportCode?: string | null;
  fightId?: number | null;
  reportRevision?: number | null;
  participantActorId?: number | null;
}

export interface CanonicalManifestSlot {
  dungeonSlug: string;
  slotIndex: 0 | 1;
  keyLevel: number | null;
  completedAt?: string | null;
  reportCode?: string | null;
  fightId?: number | null;
}

export interface CanonicalDigestSlotFacts {
  reportCode: string;
  fightId: number;
  keyLevel: number | null;
  completedAt: string | null;
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function fightIdentityKey(reportCode: unknown, fightId: unknown): string | null {
  if (typeof reportCode !== "string" || reportCode.trim() === "") return null;
  const fight = readFiniteNumber(fightId);
  if (fight == null || !Number.isInteger(fight) || fight <= 0) return null;
  return `${reportCode.trim().toLowerCase()}:${fight}`;
}

export function canonicalFightIdentityKey(reportCode: unknown, fightId: unknown): string | null {
  return fightIdentityKey(reportCode, fightId);
}

function publicWclFightUrl(reportCode: unknown, fightId: unknown): string | null {
  if (typeof reportCode !== "string") return null;
  const code = reportCode.trim();
  if (!/^[A-Za-z0-9]+$/.test(code)) return null;
  const fight = readFiniteNumber(fightId);
  if (fight == null || !Number.isInteger(fight) || fight <= 0) return null;
  return `https://www.warcraftlogs.com/reports/${code}?fight=${fight}&type=damage-done`;
}

function readIso(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

function readKeyLevel(rec: Record<string, unknown>): number | null {
  const raw = rec.keyLevel ?? rec.keystoneLevel;
  const value = readFiniteNumber(raw);
  if (value == null || !Number.isInteger(value) || value <= 0) return null;
  return value;
}

function readSlotIndex(value: unknown, slotId?: unknown): 0 | 1 | null {
  if (value === 0 || value === 1) return value;
  if (value === "0") return 0;
  if (value === "1") return 1;
  if (typeof slotId === "string") {
    const tail = slotId.trim().match(/:([01])$/);
    if (tail?.[1] === "0") return 0;
    if (tail?.[1] === "1") return 1;
  }
  return null;
}

/**
 * Map persisted CharacterScore.selectedRuns digest slots to public evidence rows.
 * Builds WCL URLs from canonical reportCode+fightId; never returns those ids.
 */
export function parsePersistedCanonicalEvidenceSlots(raw: unknown): CanonicalPersistedEvidenceSlot[] {
  if (!Array.isArray(raw)) return [];
  const out: CanonicalPersistedEvidenceSlot[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const nested =
      rec.digest && typeof rec.digest === "object" ? (rec.digest as Record<string, unknown>) : rec;
    const dungeonSlug =
      typeof rec.dungeonSlug === "string"
        ? rec.dungeonSlug.trim()
        : typeof nested.dungeonSlug === "string"
          ? nested.dungeonSlug.trim()
          : "";
    if (!dungeonSlug) continue;
    const slotIndex = readSlotIndex(rec.slotIndex, rec.slotId);
    if (slotIndex == null) continue;
    const reportCode = rec.reportCode ?? nested.reportCode;
    const fightId = rec.fightId ?? nested.fightId;
    out.push({
      dungeonSlug,
      dungeonName: typeof rec.dungeonName === "string" ? rec.dungeonName : null,
      slotIndex,
      keyLevel: readKeyLevel(rec) ?? readKeyLevel(nested),
      completedAt:
        readIso(rec.completedAt) ??
        readIso(nested.completedAt) ??
        readIso(nested.startTimeMs) ??
        readIso(rec.startTimeMs),
      wclUrl: publicWclFightUrl(reportCode, fightId),
      reportCode: typeof reportCode === "string" ? reportCode.trim() : null,
      fightId: readFiniteNumber(fightId),
      reportRevision: readFiniteNumber(rec.reportRevision ?? nested.reportRevision),
      participantActorId: readFiniteNumber(rec.participantActorId ?? nested.participantActorId),
    });
  }
  return out;
}
