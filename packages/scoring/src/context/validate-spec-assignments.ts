import type { MetaTier } from "@mplus/contracts";
import { findSpecDefinition } from "@mplus/abilities";

export function validateSpecAssignments(
  raw: unknown,
):
  | { ok: true; assignments: Array<{ classSlug: string; specSlug: string; tier: MetaTier }> }
  | { ok: false; issues: Array<{ path: string; message: string }> } {
  const issues: Array<{ path: string; message: string }> = [];
  if (!Array.isArray(raw)) {
    return { ok: false, issues: [{ path: "specAssignments", message: "must be an array" }] };
  }
  const assignments: Array<{ classSlug: string; specSlug: string; tier: MetaTier }> = [];
  raw.forEach((entry, index) => {
    const path = `specAssignments[${index}]`;
    if (!entry || typeof entry !== "object") {
      issues.push({ path, message: "assignment must be an object" });
      return;
    }
    const rec = entry as Record<string, unknown>;
    const classSlug = typeof rec.classSlug === "string" ? rec.classSlug : "";
    const specSlug = typeof rec.specSlug === "string" ? rec.specSlug : "";
    const tier = rec.tier;
    if (!findSpecDefinition(classSlug, specSlug)) {
      issues.push({ path, message: "unknown canonical specialization" });
      return;
    }
    if (tier !== 1 && tier !== 2 && tier !== 3 && tier !== 4 && tier !== 5) {
      issues.push({ path: `${path}.tier`, message: "tier must be 1..5" });
      return;
    }
    assignments.push({ classSlug, specSlug, tier });
  });
  const seen = new Set<string>();
  for (const [index, assignment] of assignments.entries()) {
    const key = `${assignment.classSlug.trim().toLowerCase()}::${assignment.specSlug.trim().toLowerCase()}`;
    if (seen.has(key)) {
      issues.push({
        path: `specAssignments[${index}]`,
        message: "duplicate canonical specialization",
      });
    }
    seen.add(key);
  }
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, assignments };
}
