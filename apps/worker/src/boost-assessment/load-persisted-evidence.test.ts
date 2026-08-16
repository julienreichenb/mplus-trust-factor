import { describe, expect, it, vi } from "vitest";
import { loadBoostAssessmentEvidence } from "./load-persisted-evidence.js";

describe("boost loader scoring selectedRuns", () => {
  it("uses CharacterScore.selectedRuns and does not invent extra fights", async () => {
    const selectedRuns = Array.from({ length: 16 }, (_, i) => ({
      slotId: `d${i % 8}:${Math.floor(i / 8)}`,
      dungeonSlug: `d${i % 8}`,
      slotIndex: Math.floor(i / 8),
      reportCode: `code${i}`,
      fightId: i + 1,
      reportRevision: 1,
      participantActorId: 4,
    }));
    const prisma = {
      character: { findUnique: vi.fn(async () => ({ id: "c1", region: { code: "EU" } })) },
      characterScore: {
        findFirst: vi.fn(async () => ({
          selectedRuns,
          dimensionDetails: {
            scoreContext: {
              contextRevisionKey: "rev",
              contextRevisionId: "rev",
              key: {
                status: "AVAILABLE",
                medianKeyLevel: 23,
                appliedAnchorPercentileBps: 9990,
                appliedAnchorPercentileLabel: "P99.9",
              },
            },
            canonicalScoringRunSelection: { selectedRuns: [] },
          },
        })),
      },
      evidenceManifest: { findFirst: vi.fn() },
      wclRunRaw: {
        findMany: vi.fn(async ({ where }: { where: { reportCode: string } }) => {
          const n = Number(String(where.reportCode).replace("code", ""));
          if (n >= 9) return [];
          return [
            {
              id: `raw-${n}`,
              reportCode: where.reportCode,
              fightId: n + 1,
              reportRevision: 1,
              acquisitionVersion: "capability-acquisition-plan-v2",
            },
          ];
        }),
      },
      wclFightRankingSnapshot: {
        findFirst: vi.fn(async ({ where }: { where: { rawRunId: string } }) => {
          const n = Number(where.rawRunId.slice(4));
          return {
            id: `snap-${n}`,
            contentHash: `h${n}`,
            entries: [
              { reportActorId: 4, bracketPercent: n === 0 ? 0 : 90, rankPercent: 99, name: "Own", wclCharacterId: 1, role: "dps" },
              { reportActorId: 7, bracketPercent: 80, rankPercent: 10, name: "Peer", wclCharacterId: 2, role: "dps" },
            ],
          };
        }),
      },
      characterRunDigest: { findMany: vi.fn(async () => []) },
      mythicRun: { findMany: vi.fn(async () => []) },
    };

    const loaded = await loadBoostAssessmentEvidence({
      prisma: prisma as never,
      characterId: "c1",
      seasonId: "season-1",
    });
    expect(loaded.lineage.source).toBe("character_score_selected_runs");
    expect(loaded.lineage.setsEqual).toBe(true);
    expect(loaded.runs).toHaveLength(16);
    expect(loaded.runs[0]?.wclCode).toBe("code0");
    expect(loaded.runs[0]?.wclFightId).toBe(1);
    expect(loaded.runs.filter((r) => r.subjectKeyParse != null)).toHaveLength(9);
    expect(loaded.runs[0]?.subjectKeyParse).toBe(0);
    expect(prisma.evidenceManifest.findFirst).not.toHaveBeenCalled();
  });

  it("does not fall back to MythicRun discovery when scoring lineage is missing", async () => {
    const prisma = {
      character: { findUnique: vi.fn(async () => ({ id: "c1", region: { code: "EU" } })) },
      characterScore: { findFirst: vi.fn(async () => null) },
      evidenceManifest: { findFirst: vi.fn(async () => null) },
      runParticipant: { findMany: vi.fn() },
    };
    const loaded = await loadBoostAssessmentEvidence({
      prisma: prisma as never,
      characterId: "c1",
      seasonId: "season-1",
    });
    expect(loaded.runs).toEqual([]);
    expect(loaded.lineage.source).toBe("missing");
    expect(prisma.runParticipant.findMany).not.toHaveBeenCalled();
  });
});
