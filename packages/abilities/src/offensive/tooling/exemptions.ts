/**
 * Explicit per-spec exemptions from the "at least one reviewed offensive cooldown"
 * validation gate. Tooling-only — not a production catalog.
 *
 * Invalid exemption reasons (rejected by policy):
 * - "not yet implemented"
 * - "not observed in the test fight"
 * - "UNCERTAIN supportState" alone
 * - missing spell-ID verification alone
 */
export interface OffensiveCoverageExemption {
  classSlug: string;
  specSlug: string;
  reason: string;
  reviewStatus: "EXEMPT";
  documentedAt: string;
}

export const OFFENSIVE_COVERAGE_EXEMPTIONS: OffensiveCoverageExemption[] = [
  {
    classSlug: "shaman",
    specSlug: "restoration",
    reason:
      "Semantic: Restoration Shaman has no intentional personal damage cooldown in the Midnight toolkit. Ascendance (114052) and Healing Tide Totem are healing-primary activations; they do not materially increase damage throughput for a bounded offensive window. Class-shared Bloodlust is utility, not a personal offensive CD.",
    reviewStatus: "EXEMPT",
    documentedAt: "2026-08-05",
  },
];

export function exemptionFor(
  classSlug: string,
  specSlug: string,
): OffensiveCoverageExemption | undefined {
  return OFFENSIVE_COVERAGE_EXEMPTIONS.find(
    (e) => e.classSlug === classSlug && e.specSlug === specSlug,
  );
}
