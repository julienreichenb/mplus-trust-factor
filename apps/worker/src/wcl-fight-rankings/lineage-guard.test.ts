import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OPERATIONS } from "@mplus/provider-warcraftlogs";

describe("boost lineage / refresh ranking acquisition", () => {
  it("hydrate rankings targets CharacterScore.selectedRuns, not a Boost selector", () => {
    const src = readFileSync(new URL("./hydrate-rankings.cli.ts", import.meta.url), "utf8");
    expect(src).toContain("selectedRuns");
    expect(src).not.toContain("selectBoostAnalysisSample");
    expect(src).toContain("SCORING_SELECTION_LINEAGE_MISSING");
  });

  it("boost loader and probe do not import live WCL clients", () => {
    const loader = readFileSync(new URL("../boost-assessment/load-persisted-evidence.ts", import.meta.url), "utf8");
    const probe = readFileSync(new URL("../boost-assessment/probe.cli.ts", import.meta.url), "utf8");
    const assess = readFileSync(new URL("../boost-assessment/run-assessment.ts", import.meta.url), "utf8");
    for (const src of [loader, probe, assess]) {
      expect(src).not.toContain("LiveWarcraftLogsProvider");
      expect(src).not.toContain("createWarcraftLogsProvider");
      expect(src).not.toContain("@mplus/provider-blizzard");
      expect(src).not.toContain("@mplus/provider-raiderio");
    }
    expect(probe).toContain("CANONICAL PRIMARY RUNS");
    expect(probe).toContain("wclDamageDoneReportUrl");
    expect(probe).not.toContain("jfB7MKTmHQdwNycq");
    const urlHelper = readFileSync(new URL("../boost-assessment/wcl-report-url.ts", import.meta.url), "utf8");
    expect(urlHelper).toContain("type=damage-done");
  });

  it("production report operation requests rankings once with no second rankings op", () => {
    const q = OPERATIONS.ReportWithFightAndMasterData.query;
    expect([...q.matchAll(/\brankings\s*\(/g)]).toHaveLength(1);
    expect(q).toMatch(/compare:\s*Rankings/);
    expect(q).toMatch(/playerMetric:\s*dps/);
    expect(q).toMatch(/timeframe:\s*Today/);
    expect(q).not.toMatch(/compare:\s*Parses/);
    expect(OPERATIONS.ReportEvents.query).not.toMatch(/\brankings\s*\(/);
    const adapter = readFileSync(
      new URL("../orchestration/scoring/run-orchestration/live-capability-adapter.ts", import.meta.url),
      "utf8",
    );
    expect(adapter).toContain("OPERATIONS.ReportWithFightAndMasterData");
    expect(adapter).not.toContain("ReportFightRankingsProbe");
  });

  it("scoreCharacter maps Boost from orchestration manifest, not EvidenceManifest lookup", () => {
    const src = readFileSync(
      new URL("../orchestration/scoring/score-character.ts", import.meta.url),
      "utf8",
    );
    expect(src).toContain("buildBoostRunsFromOrchestration");
    expect(src).toContain("assessBoostSuspicionV1");
    expect(src).toContain("ensureRankingSnapshots");
    expect(src).not.toContain("LiveWarcraftLogsProvider");
    expect(src).not.toContain("loadBoostAssessmentEvidence");
    expect(src).not.toContain("selectBoostAnalysisSample");
  });
});
