/**
 * Refresh must score with season WCL identity, not the current Blizzard logout spec.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = fileURLToPath(new URL(".", import.meta.url));
const refreshPipelineSrc = readFileSync(resolve(here, "../refresh-pipeline.ts"), "utf8");
const recalculateSrc = readFileSync(resolve(here, "../recalculate-score.ts"), "utf8");

describe("season scoring identity plumbing", () => {
  it("refresh-pipeline resolves season identity before authoritative scoring", () => {
    const frozenIdx = refreshPipelineSrc.indexOf("const frozenIdentity = resolveFrozenCharacterIdentity(");
    const seasonIdx = refreshPipelineSrc.indexOf("const seasonScoringIdentity = resolveSeasonScoringIdentity(");
    const scoringIdx = refreshPipelineSrc.indexOf("const scoringOutcome = await runAuthoritativeScoring(");
    expect(frozenIdx).toBeGreaterThan(0);
    expect(seasonIdx).toBeGreaterThan(frozenIdx);
    expect(scoringIdx).toBeGreaterThan(seasonIdx);
    expect(refreshPipelineSrc).toMatch(/role:\s*seasonScoringIdentity\.role/);
    expect(refreshPipelineSrc).toMatch(/classSlug:\s*seasonScoringIdentity\.classSlug/);
    expect(refreshPipelineSrc).toMatch(/specSlug:\s*seasonScoringIdentity\.specSlug/);
    expect(refreshPipelineSrc).not.toMatch(
      /runAuthoritativeScoring\(\{[\s\S]*role:\s*frozenIdentity\.role/,
    );
  });

  it("refresh-pipeline warm-hit uses season identity and skips healers", () => {
    expect(refreshPipelineSrc).toMatch(/seasonIdentityAllowsDamageWarmHit\(seasonScoringIdentity\)/);
    expect(refreshPipelineSrc).toMatch(/targetSpecSlug:\s*seasonScoringIdentity\.specSlug/);
    expect(refreshPipelineSrc).not.toMatch(
      /frozenIdentity\.role === "DPS" \|\| frozenIdentity\.role === "TANK"/,
    );
  });

  it("refresh-pipeline does not persist season spec onto Character.activeSpec", () => {
    const seasonIdx = refreshPipelineSrc.indexOf("const seasonScoringIdentity = resolveSeasonScoringIdentity(");
    const afterSeason = refreshPipelineSrc.slice(seasonIdx);
    expect(afterSeason).not.toMatch(/applyProviderProfile\(/);
    expect(afterSeason).not.toMatch(/activeSpecSlug:\s*seasonScoringIdentity/);
  });

  it("recalculate reuses persisted aggregate evidence without a new WCL call", () => {
    expect(recalculateSrc).toMatch(/wclSeasonEvidenceFromPersistedAggregate/);
    expect(recalculateSrc).toMatch(/resolveSeasonScoringIdentity/);
    expect(recalculateSrc).toMatch(/findCompatibleForReplay/);
    expect(recalculateSrc).not.toMatch(/discoverCharacterSummary/);
    expect(recalculateSrc).not.toMatch(/fetchCharacterPerformanceAggregate/);
  });
});
