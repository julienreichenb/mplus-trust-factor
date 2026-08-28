import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { SIMC_SPELLQUERY_EXPORT_SCHEMA, type SimcSpellQueryExport } from "../sources/simc.js";
import type { ScopedInventory } from "../types.js";
import { SIMC_EXTRACTOR_VERSION, SIMC_SPELLQUERY_EXPRESSIONS, simcArgsForQuery } from "./simc-plan.js";
import {
  assertLiveSimcIdentity,
  liveQueryArgs,
  parseSimcBinaryBanner,
  type SimcBinaryIdentity,
} from "./simc-identity.js";
import { bindingsFromParsedSpell, parseSpellQueryXml, resolveSpellCooldownSeconds, SpellQueryXmlError } from "./simc-xml.js";
import { classifySpecScope } from "../scope-classify.js";

export class SimcExtractionError extends Error {
  readonly code: string;
  readonly stdout?: string;
  readonly stderr?: string;
  constructor(code: string, message: string, extra?: { stdout?: string; stderr?: string }) {
    super(message);
    this.name = "SimcExtractionError";
    this.code = code;
    this.stdout = extra?.stdout;
    this.stderr = extra?.stderr;
  }
}

export interface ProcessRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type ProcessRunner = (input: {
  command: string;
  args: string[];
  cwd?: string;
}) => Promise<ProcessRunResult>;

export const defaultProcessRunner: ProcessRunner = (input) =>
  new Promise((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (err) => {
      reject(
        new SimcExtractionError(
          "MISSING_BINARY",
          `SimC binary could not be started (${input.command}): ${err.message}`,
        ),
      );
    });
    child.on("close", (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });

export interface SimcExtractInput {
  simcBin: string;
  /**
   * Optional CI/assertion pin. Never the source of truth — binary self-identification is.
   * @deprecated Prefer `expectedSimcRevision`.
   */
  simcRevision?: string;
  /** Optional expected revision assertion (full SHA preferred). */
  expectedSimcRevision?: string;
  simcBranch?: string;
  retrievedAt?: string;
  runner?: ProcessRunner;
  workDir?: string;
}

function slugKey(classSlug: string | null, spec: string | undefined): string {
  return `${classSlug ?? ""}/${spec ?? ""}`;
}

export async function extractSimcSpellQuerySnapshot(
  input: SimcExtractInput,
): Promise<SimcSpellQueryExport> {
  if (!input.simcBin?.trim()) {
    throw new SimcExtractionError("MISSING_BINARY", "SimC binary path is required (--simc-bin)");
  }
  if (!existsSync(input.simcBin)) {
    throw new SimcExtractionError("MISSING_BINARY", `SimC binary not found: ${input.simcBin}`);
  }

  const expectedRevision =
    input.expectedSimcRevision?.trim() || input.simcRevision?.trim() || null;

  const runner = input.runner ?? defaultProcessRunner;
  const workDir = input.workDir ?? mkdtempSync(join(tmpdir(), "mplus-simc-extract-"));
  const ownedWorkDir = !input.workDir;
  const spellsById = new Map<number, SimcSpellQueryExport["spells"][number]>();
  const inventories: ScopedInventory[] = [];
  const queries: string[] = [];
  const startedAt = Date.now();
  let rawXmlBytes = 0;
  let processCount = 0;

  processCount += 1;
  const provenanceXml = join(workDir, "provenance.xml");
  const probe = await runner({
    command: input.simcBin,
    args: liveQueryArgs([
      "spell_query=spell.id=1",
      `spell_query_xml_output_file=${provenanceXml}`,
    ]),
  });
  if (probe.exitCode !== 0) {
    throw new SimcExtractionError(
      "PROCESS_FAILED",
      `SimC provenance probe exited ${probe.exitCode}`,
      { stdout: probe.stdout, stderr: probe.stderr },
    );
  }
  const identity: SimcBinaryIdentity = parseSimcBinaryBanner(
    `${probe.stdout}\n${probe.stderr}`,
    input.simcBin,
  );
  let revisionIdentity;
  try {
    ({ revision: revisionIdentity } = assertLiveSimcIdentity(identity, {
      expectedRevision,
    }));
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code: string }).code)
        : "REVISION_MISMATCH";
    throw new SimcExtractionError(code, error instanceof Error ? error.message : String(error), {
      stdout: probe.stdout,
      stderr: probe.stderr,
    });
  }

  try {
    for (const expression of SIMC_SPELLQUERY_EXPRESSIONS) {
      const xmlPath = join(workDir, `${expression}.xml`);
      const result = await runner({
        command: input.simcBin,
        args: simcArgsForQuery(expression, xmlPath),
      });
      processCount += 1;
      if (result.exitCode !== 0) {
        throw new SimcExtractionError(
          "PROCESS_FAILED",
          `SimC ${expression} exited ${result.exitCode}`,
          { stdout: result.stdout, stderr: result.stderr },
        );
      }
      if (/\bptr\s*=\s*1\b/i.test(`${result.stdout}\n${result.stderr}`)) {
        throw new SimcExtractionError(
          "PTR_DATA_REJECTED",
          `SimC ${expression} output indicates ptr=1`,
          { stdout: result.stdout, stderr: result.stderr },
        );
      }
      if (!existsSync(xmlPath) || statSync(xmlPath).size === 0) {
        throw new SimcExtractionError(
          "PARTIAL_OUTPUT",
          `SimC ${expression} produced no XML at ${xmlPath}`,
          { stdout: result.stdout, stderr: result.stderr },
        );
      }
      queries.push(expression);
      const xmlText = readFileSync(xmlPath, "utf8");
      rawXmlBytes += Buffer.byteLength(xmlText, "utf8");
      let parsed;
      try {
        parsed = parseSpellQueryXml(xmlText);
      } catch (error) {
        const message = error instanceof SpellQueryXmlError ? error.message : String(error);
        throw new SimcExtractionError("MALFORMED_XML", `${expression}: ${message}`, {
          stdout: result.stdout,
          stderr: result.stderr,
        });
      }

      const classSeen = new Set<string>();
      const specSeen = new Set<string>();
      const raceSeen = new Set<string>();

      for (const spell of parsed) {
        const existing = spellsById.get(spell.spellId);
        const next = {
          spellId: spell.spellId,
          name: spell.name,
          classSlug: spell.classSlug,
          specSlugs: [...spell.specSlugs],
          raceSlugs: [...spell.raceSlugs],
          cooldownSeconds: resolveSpellCooldownSeconds(spell),
          charges: spell.charges,
          stacks: spell.maxStack,
          isPassive: spell.isPassive,
          catalogRelevant: spell.isPassive !== true,
          bindings: bindingsFromParsedSpell(spell),
          notes: [
            `query=${expression}`,
            ...(spell.maxStack != null && spell.maxStack > 1
              ? [`max_stack=${spell.maxStack} (not auto-classified as STACK_AURA)`]
              : []),
            ...(spell.description ? [`tooltip:${spell.description.slice(0, 160)}`] : []),
          ],
        };
        if (!existing) {
          spellsById.set(spell.spellId, next);
        } else {
          existing.specSlugs = [...new Set([...(existing.specSlugs ?? []), ...(next.specSlugs ?? [])])].sort();
          existing.raceSlugs = [...new Set([...(existing.raceSlugs ?? []), ...(next.raceSlugs ?? [])])].sort();
          existing.classSlug = existing.classSlug ?? next.classSlug;
          existing.cooldownSeconds = existing.cooldownSeconds ?? next.cooldownSeconds;
          existing.charges = existing.charges ?? next.charges;
          existing.stacks = existing.stacks ?? next.stacks;
          existing.isPassive = existing.isPassive ?? next.isPassive;
          existing.notes = [...new Set([...(existing.notes ?? []), ...(next.notes ?? [])])];
          const bindings = [...(existing.bindings ?? []), ...(next.bindings ?? [])];
          const seen = new Set<string>();
          existing.bindings = bindings.filter((b) => {
            const key = `${b.spellId}:${b.role}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        }
        if (spell.classSlug) classSeen.add(spell.classSlug);
        for (const spec of spell.specSlugs) {
          if (spell.classSlug) specSeen.add(slugKey(spell.classSlug, spec));
        }
        for (const race of spell.raceSlugs) raceSeen.add(race);
      }

      if (expression === "class_spell") {
        for (const cls of [...classSeen].sort()) {
          inventories.push({
            kind: "CLASS",
            classSlug: cls,
            completeness: "COMPLETE",
            queryClaim: "COMPLETE_FOR_QUERY",
            claimsCompleteToolkit: false,
            queryExpression: expression,
            scopeClassification: "PLAYABLE_CLASS",
          });
        }
      }
      if (expression === "spec_spell") {
        for (const key of [...specSeen].sort()) {
          const [classSlug, specSlug] = key.split("/");
          inventories.push({
            kind: "SPEC",
            classSlug,
            specSlug,
            completeness: "COMPLETE",
            queryClaim: "COMPLETE_FOR_QUERY",
            claimsCompleteToolkit: false,
            queryExpression: expression,
            scopeClassification: classifySpecScope(classSlug ?? null, specSlug ?? ""),
          });
        }
      }
      if (expression === "race_spell") {
        for (const race of [...raceSeen].sort()) {
          inventories.push({
            kind: "RACE",
            raceSlug: race,
            completeness: "COMPLETE",
            queryClaim: "COMPLETE_FOR_QUERY",
            claimsCompleteToolkit: false,
            queryExpression: expression,
            scopeClassification: "PLAYABLE_RACE",
          });
        }
      }
    }
  } finally {
    if (ownedWorkDir) {
      rmSync(workDir, { recursive: true, force: true });
    }
  }

  const spells = [...spellsById.values()].sort((a, b) => a.spellId - b.spellId);
  return {
    schemaVersion: SIMC_SPELLQUERY_EXPORT_SCHEMA,
    datasetKind: "PINNED",
    simcCommitSha: revisionIdentity.canonicalRevision,
    simcBranch: input.simcBranch ?? identity.gitBranch ?? undefined,
    extractorVersion: SIMC_EXTRACTOR_VERSION,
    retrievedAt: input.retrievedAt ?? new Date().toISOString(),
    sourceVersion: SIMC_EXTRACTOR_VERSION,
    inventories,
    spells,
    gameVersion: identity.wowBuild ?? undefined,
    validFromBuild: identity.wowBuild ?? undefined,
    binaryIdentity: {
      applicationVersion: identity.applicationVersion,
      wowBuild: identity.wowBuild,
      gitRevision: identity.gitRevision,
      dataMode: identity.dataMode,
      executablePath: identity.executablePath,
      binaryReportedRevision: revisionIdentity.binaryReportedRevision,
      resolvedFullRevision: revisionIdentity.resolvedFullRevision,
      revisionPrecision: revisionIdentity.revisionPrecision,
    },
    extractionStats: {
      processCount,
      durationMs: Date.now() - startedAt,
      rawXmlBytes,
    },
  };
}

export function simcQueryProvenance(): string[] {
  return [...SIMC_SPELLQUERY_EXPRESSIONS];
}
