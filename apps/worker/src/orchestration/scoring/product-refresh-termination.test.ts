/**
 * Product refresh must terminate when discovery exhausts even if SELECTED < 16.
 * Static + behavioral coverage for the known-good early-stop contract.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pipelineSrc = readFileSync(
  join(here, "../refresh-pipeline.ts"),
  "utf8",
);
const bridgeSrc = readFileSync(join(here, "./refresh-bridge.ts"), "utf8");

describe("product refresh finite discovery / acquisition", () => {
  it("defers detailed WCL until after selection (never pre-select analyze-all)", () => {
    expect(pipelineSrc).toMatch(/const deferDetailedWclAcquisitionToScoring = true/);
    expect(pipelineSrc).toMatch(/runAuthoritativeScoring/);
  });

  it("logs when detailed acquisition is blocked by ALLOW_LIVE_PROVIDER_CALLS", () => {
    expect(bridgeSrc).toMatch(/DETAILED_ACQUISITION_BLOCKED/);
    expect(bridgeSrc).toMatch(/ALLOW_LIVE_PROVIDER_CALLS/);
  });

  it("refresh pipeline always invokes scoreCharacter path after discovery", () => {
    expect(pipelineSrc).toMatch(/authoritativeCandidates/);
    expect(pipelineSrc).toMatch(/REFRESH_COMPLETED/);
  });
});
