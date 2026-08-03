/**
 * Artifact writers / summary.md builder for the Scoring V2 live character probe.
 */

import type {
  DimensionExecutable,
  OverallVerdict,
  SlotHydrationSummary,
} from "./classify.js";

export interface ProbeSummaryHeader {
  character: string;
  activeSeason: string;
  dungeonCount: number;
  selectedSlotCount: number;
  expectedSlotCount: number;
  fullyHydratedSlots: number;
  performanceExecutable: DimensionExecutable;
  survivalExecutable: DimensionExecutable;
  utilityExecutable: DimensionExecutable;
  experienceExecutable: DimensionExecutable;
  overallVerdict: OverallVerdict;
}

export function buildSummaryMarkdown(input: {
  header: ProbeSummaryHeader;
  missingDungeonSlots: Array<{
    dungeonSlug: string;
    missingSlotIndexes: Array<0 | 1>;
    reason: string;
  }>;
  slots: SlotHydrationSummary[];
  wclRequests: number;
  estimatedWclPoints: number | null;
  datasetCoverageNotes: string[];
  factSetCoverageNotes: string[];
  performance: Record<string, unknown>;
  survival: Record<string, unknown>;
  utility: Record<string, unknown>;
  experience: Record<string, unknown>;
  confirmations: string[];
}): string {
  const h = input.header;
  const lines: string[] = [
    `# Scoring V2 live character probe`,
    ``,
    `- Character: ${h.character}`,
    `- Active season: ${h.activeSeason}`,
    `- Dungeon count: ${h.dungeonCount}`,
    `- Selected slot count out of ${h.expectedSlotCount}: ${h.selectedSlotCount}`,
    `- Fully hydrated slots: ${h.fullyHydratedSlots}`,
    `- Performance executable: ${h.performanceExecutable}`,
    `- Survival executable: ${h.survivalExecutable}`,
    `- Utility executable: ${h.utilityExecutable}`,
    `- Experience executable: ${h.experienceExecutable}`,
    `- Overall verdict: ${h.overallVerdict}`,
    ``,
    `## Missing dungeon slots`,
    ``,
  ];

  if (input.missingDungeonSlots.length === 0) {
    lines.push(`None — all ${h.expectedSlotCount} slots selected.`);
  } else {
    for (const row of input.missingDungeonSlots) {
      lines.push(
        `- ${row.dungeonSlug}: missing slot(s) ${row.missingSlotIndexes.join(", ")} (${row.reason})`,
      );
    }
  }

  lines.push(
    ``,
    `## WCL cost`,
    ``,
    `- Total requests: ${input.wclRequests}`,
    `- Estimated points: ${input.estimatedWclPoints ?? "unknown"}`,
    ``,
    `## Dataset coverage`,
    ``,
  );
  for (const note of input.datasetCoverageNotes) lines.push(`- ${note}`);

  lines.push(``, `## Fact-set coverage`, ``);
  for (const note of input.factSetCoverageNotes) lines.push(`- ${note}`);

  lines.push(
    ``,
    `## Dimension results`,
    ``,
    `### Performance`,
    "```json",
    JSON.stringify(input.performance, null, 2),
    "```",
    ``,
    `### Survival`,
    "```json",
    JSON.stringify(input.survival, null, 2),
    "```",
    ``,
    `### Utility`,
    "```json",
    JSON.stringify(input.utility, null, 2),
    "```",
    ``,
    `### Experience`,
    "```json",
    JSON.stringify(input.experience, null, 2),
    "```",
    ``,
    `## Selected slots`,
    ``,
  );

  for (const slot of input.slots) {
    lines.push(
      `- ${slot.dungeonSlug}:${slot.slotIndex} state=${slot.state} hydrated=${slot.fullyHydrated} wclValid=${slot.wclReportValid}` +
        (slot.reportCode
          ? ` report=${slot.reportCode} fight=${slot.fightId} rev=${slot.reportRevision}`
          : "") +
        (slot.missingReason ? ` reason=${slot.missingReason}` : ""),
    );
  }

  lines.push(``, `## Confirmations`, ``);
  for (const c of input.confirmations) lines.push(`- ${c}`);
  lines.push(``);
  return lines.join("\n");
}
