/**
 * Provider-free Utility evidence trace for one character's selected scoring runs.
 *
 * Reads only persisted DB rows (CharacterScore, CharacterRunDigest, WclRunRaw).
 * Never imports or calls Warcraft Logs / Blizzard / Raider.IO clients.
 *
 *   pnpm utility:trace-character --region EU --realm archimonde --character Wallidrixe
 */
import {
  getAllRegisteredRules,
  resolveAbilityCapability,
  resolveAbilityRuleBySpellId,
  ruleResolvableSpellIds,
  type AbilityRule,
} from "@mplus/abilities";
import { loadEnv } from "@mplus/config";
import {
  assertParticipantScoringDigestV1,
  parseWclRunRawPayload,
  type CapabilityCompactEvent,
  type ParticipantScoringDigestV1,
  type UtilityCanonicalAction,
} from "@mplus/contracts";
import { createPrismaClient } from "@mplus/database";
import {
  computeUtilityV2,
  UTILITY_V2_FAMILY_KEYS,
  utilityFamilyFromCatalogRule,
  utilityRunFactSetFromDigest,
  resolveTunableWeights,
  applyTunableWeightsToUtilityConfig,
  type UtilityV2DomainBreakdown,
  type UtilityV2FamilyKey,
  type UtilityV2FrozenManifestRef,
  type UtilityV2RunFactSet,
} from "@mplus/scoring";
import {
  SCORING_ACQUISITION_VERSION,
  SCORING_EXTRACTOR_VERSION,
} from "./run-orchestration/production-ports.js";

const FOCUS = {
  CURSE_OF_TONGUES: 1714,
  BLIGHT_OF_TONGUES: 1271802,
  DEMONIC_GATEWAY: 111771,
} as const;

const UTILITY_DATASETS = new Set([
  "Interrupts",
  "Dispels",
  "Casts",
  "Debuffs",
  "Buffs",
]);

type SelectedRunRef = {
  slotId: string;
  dungeonSlug: string;
  slotIndex: 0 | 1;
  reportCode: string;
  fightId: number;
  reportRevision: number;
  participantActorId: number;
};

type ChainStage = {
  stage: string;
  ok: boolean;
  detail: string;
};

function argValue(argv: string[], name: string): string | null {
  const cleaned = argv.filter((a) => a !== "--");
  const idx = cleaned.indexOf(name);
  if (idx < 0) return null;
  return cleaned[idx + 1] ?? null;
}

function requireArg(argv: string[], name: string, envFallback?: string): string {
  const fromArg = argValue(argv, name);
  if (fromArg && fromArg.trim()) return fromArg.trim();
  if (envFallback && process.env[envFallback]?.trim()) {
    return process.env[envFallback]!.trim();
  }
  throw new Error(`Missing required ${name} (or env ${envFallback ?? "n/a"})`);
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function parseSelectedRuns(raw: unknown): SelectedRunRef[] {
  if (!Array.isArray(raw)) return [];
  const out: SelectedRunRef[] = [];
  for (const row of raw) {
    if (row == null || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const reportCode = typeof r.reportCode === "string" ? r.reportCode : null;
    const fightId = typeof r.fightId === "number" ? r.fightId : null;
    const reportRevision =
      typeof r.reportRevision === "number" ? r.reportRevision : null;
    const participantActorId =
      typeof r.participantActorId === "number" ? r.participantActorId : null;
    const slotId = typeof r.slotId === "string" ? r.slotId : null;
    const dungeonSlug = typeof r.dungeonSlug === "string" ? r.dungeonSlug : "unknown";
    const slotIndex = r.slotIndex === 1 ? 1 : 0;
    if (
      reportCode == null ||
      fightId == null ||
      reportRevision == null ||
      participantActorId == null ||
      slotId == null
    ) {
      continue;
    }
    out.push({
      slotId,
      dungeonSlug,
      slotIndex,
      reportCode,
      fightId,
      reportRevision,
      participantActorId,
    });
  }
  return out;
}

function digestFromRow(row: {
  sourceMetadata: unknown;
}): ParticipantScoringDigestV1 | null {
  const meta = row.sourceMetadata;
  if (meta == null || typeof meta !== "object") return null;
  const digestCandidate = (meta as { digest?: unknown }).digest ?? meta;
  try {
    return assertParticipantScoringDigestV1(digestCandidate);
  } catch {
    return null;
  }
}

function warlockUtilityRules(): AbilityRule[] {
  return getAllRegisteredRules().filter((rule) => {
    if (rule.classSlug !== "warlock") return false;
    return utilityFamilyFromCatalogRule(rule) != null;
  });
}

function ruleForSpell(
  spellId: number,
  classSlug: string | null,
  specSlug: string | null,
): AbilityRule | null {
  const resolved = resolveAbilityRuleBySpellId({
    spellId,
    classSlug,
    specSlug,
  });
  if (resolved.status === "matched") return resolved.rule;
  if (resolved.status === "ambiguous" && resolved.rules[0]) return resolved.rules[0];
  return null;
}

function spellIdSet(rule: AbilityRule): Set<number> {
  return new Set(ruleResolvableSpellIds(rule));
}

function ownedActorIds(digest: ParticipantScoringDigestV1): Set<number> {
  return new Set([digest.participantActorId, ...digest.ownedPetActorIds]);
}

function countRawPersistedObservations(input: {
  events: CapabilityCompactEvent[];
  actorIds: Set<number>;
  spellIds: Set<number>;
}): number {
  let n = 0;
  for (const ev of input.events) {
    if (ev.spellId == null || !input.spellIds.has(ev.spellId)) continue;
    if (!UTILITY_DATASETS.has(ev.dataset)) continue;
    const source = ev.sourceActorId;
    const owner = ev.sourceOwnerPlayerActorId;
    const owned =
      (source != null && input.actorIds.has(source)) ||
      (owner != null && input.actorIds.has(owner));
    if (!owned) continue;
    n += 1;
  }
  return n;
}

function actionsForSpell(
  actions: UtilityCanonicalAction[],
  spellIds: Set<number>,
): UtilityCanonicalAction[] {
  return actions.filter(
    (a) =>
      spellIds.has(a.primarySpellId) ||
      a.observedSpellIds.some((id) => spellIds.has(id)),
  );
}

function creditedCountForSpell(
  fact: UtilityV2RunFactSet,
  spellIds: Set<number>,
  family: UtilityV2FamilyKey | null,
): number {
  if (family === "crowdControl") {
    return fact.ccActions.filter((a) => spellIds.has(a.abilityGameId)).length;
  }
  if (family === "interrupt") {
    return fact.interruptAttempts.filter((a) => spellIds.has(a.abilityGameId)).length;
  }
  if (
    family === "groupSupport" ||
    family === "movement" ||
    family === "combatRes"
  ) {
    return fact.supportActions.filter(
      (a) => a.abilityGameId != null && spellIds.has(a.abilityGameId),
    ).length;
  }
  // dispelPurge / bloodlust are family aggregates on the fact set; callers
  // should prefer UtilityCanonicalAction counts for per-spell rows.
  return 0;
}

function firstBrokenStage(stages: ChainStage[]): string | null {
  const broken = stages.find((s) => !s.ok);
  return broken?.stage ?? null;
}

function buildTonguesChain(input: {
  label: string;
  spellId: number;
  rawCount: number;
  rule: AbilityRule | null;
  canonicalActions: UtilityCanonicalAction[];
  observedSpellIds: number[];
  capabilityState: string;
  capabilityReason: string;
  family: UtilityV2FamilyKey | null;
  ccCount: number;
  creditedCount: number;
}): { stages: ChainStage[]; firstBreak: string | null } {
  const catalogOk = input.rule != null;
  const canonicalOk = input.canonicalActions.length > 0;
  const inDigestActions = canonicalOk;
  const observedOk = input.observedSpellIds.includes(input.spellId);
  const capabilityOk = input.capabilityState === "AVAILABLE";
  const familyOk = input.family === "crowdControl";
  const ccOk = input.ccCount > 0;
  const creditedOk = input.creditedCount > 0;

  const stages: ChainStage[] = [
    {
      stage: "persisted_wcl_event",
      ok: input.rawCount > 0,
      detail: `rawObservations=${input.rawCount}`,
    },
    {
      stage: "catalog_match",
      ok: catalogOk,
      detail: catalogOk
        ? `${input.rule!.canonicalKey} / ${input.rule!.category}`
        : "no_catalog_rule",
    },
    {
      stage: "UtilityCanonicalAction",
      ok: canonicalOk,
      detail: `count=${input.canonicalActions.length}`,
    },
    {
      stage: "digest.utility.actions",
      ok: inDigestActions,
      detail: `count=${input.canonicalActions.length}`,
    },
    {
      stage: "observed_spell",
      ok: observedOk,
      detail: observedOk ? "present_in_observedSpellIds" : "absent_from_observedSpellIds",
    },
    {
      stage: "capability_AVAILABLE",
      ok: capabilityOk,
      detail: `${input.capabilityState} (${input.capabilityReason})`,
    },
    {
      stage: "family_crowdControl",
      ok: familyOk,
      detail: `family=${input.family ?? "null"}`,
    },
    {
      stage: "ccActions",
      ok: ccOk,
      detail: `count=${input.ccCount}`,
    },
    {
      stage: "credited_event",
      ok: creditedOk,
      detail: `credited=${input.creditedCount}`,
    },
  ];

  // If raw never appeared, that is a valid terminal result — still report first break.
  return { stages, firstBreak: firstBrokenStage(stages) };
}

function suppressTalentMissingLogs<T>(fn: () => T): T {
  const original = console.info;
  console.info = (...args: unknown[]) => {
    const first = args[0];
    if (
      typeof first === "string" &&
      first.includes("utility.talent_source_missing")
    ) {
      return;
    }
    original.apply(console, args as Parameters<typeof console.info>);
  };
  try {
    return fn();
  } finally {
    console.info = original;
  }
}

function buildManifest(runs: SelectedRunRef[]): UtilityV2FrozenManifestRef {
  return {
    contentHash: "utility-character-trace-diagnostic",
    schemaVersion: "2.0.0",
    selectorVersion: "evidence-selector-v2.0.0",
    expectedSlotCount: runs.length,
    selectedSlotCount: runs.length,
    activeDungeonSlugs: [...new Set(runs.map((r) => r.dungeonSlug))].sort(),
    slots: runs.map((r) => ({
      slotId: r.slotId,
      dungeonSlug: r.dungeonSlug,
      slotIndex: r.slotIndex,
      state: "SELECTED" as const,
      identity: {
        reportCode: r.reportCode,
        fightId: r.fightId,
        reportRevision: r.reportRevision,
      },
    })),
  };
}

function line(s = ""): void {
  console.log(s);
}

function section(title: string): void {
  line();
  line("=".repeat(72));
  line(title);
  line("=".repeat(72));
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const region = requireArg(argv, "--region", "UTILITY_TRACE_REGION").toUpperCase();
  const realm = requireArg(argv, "--realm", "UTILITY_TRACE_REALM").toLowerCase();
  const characterName = requireArg(argv, "--character", "UTILITY_TRACE_CHARACTER");
  const normalizedName = normalizeName(characterName);

  // Explicit proof: this CLI never wires provider clients.
  const providerCalls = 0;

  loadEnv();
  const prisma = createPrismaClient();

  try {
    const character = await prisma.character.findFirst({
      where: {
        region: { code: region },
        realm: { slug: realm },
        normalizedName,
      },
      include: {
        region: { select: { code: true } },
        realm: { select: { slug: true, name: true } },
        gameClass: { select: { slug: true, name: true } },
        activeSpec: { select: { slug: true, name: true } },
      },
    });

    if (!character) {
      console.log(
        JSON.stringify(
          {
            ok: false,
            code: "CHARACTER_NOT_FOUND_LOCALLY",
            mutation: false,
            providerCalls,
            identity: { region, realm, characterName },
            hint: "Character must already exist in local DB — this CLI never creates rows or calls providers.",
          },
          null,
          2,
        ),
      );
      process.exit(2);
    }

    const { peekEffectiveScoringSeasonRow } = await import(
      "../active-mplus-season/effective-season-peek.js"
    );
    const peek = await peekEffectiveScoringSeasonRow(prisma, {
      regionId: character.regionId,
    });
    const currentSeason = peek
      ? await prisma.season.findUnique({ where: { id: peek.id } })
      : null;

    const score = currentSeason
      ? await prisma.characterScore.findFirst({
          where: { characterId: character.id, seasonId: currentSeason.id },
          orderBy: { calculatedAt: "desc" },
        })
      : null;

    if (!score) {
      console.log(
        JSON.stringify(
          {
            ok: false,
            code: "CHARACTER_SCORE_MISSING",
            mutation: false,
            providerCalls,
            characterId: character.id,
            seasonId: currentSeason?.id ?? null,
          },
          null,
          2,
        ),
      );
      process.exit(2);
    }

    const selectedRuns = parseSelectedRuns(score.selectedRuns);
    if (selectedRuns.length === 0) {
      console.log(
        JSON.stringify(
          {
            ok: false,
            code: "SELECTED_RUNS_EMPTY",
            mutation: false,
            providerCalls,
            characterScoreId: score.id,
          },
          null,
          2,
        ),
      );
      process.exit(2);
    }

    const catalogRules = warlockUtilityRules();
    const focusRules = {
      curse: catalogRules.find((r) => ruleResolvableSpellIds(r).includes(FOCUS.CURSE_OF_TONGUES)) ?? null,
      blight: catalogRules.find((r) => ruleResolvableSpellIds(r).includes(FOCUS.BLIGHT_OF_TONGUES)) ?? null,
      gateway: catalogRules.find((r) => ruleResolvableSpellIds(r).includes(FOCUS.DEMONIC_GATEWAY)) ?? null,
    };

    type RunTrace = {
      selected: SelectedRunRef;
      digest: ParticipantScoringDigestV1 | null;
      rawPresent: boolean;
      rawEventCount: number;
      fact: UtilityV2RunFactSet | null;
      abilities: Array<Record<string, unknown>>;
      curseChain: ReturnType<typeof buildTonguesChain> | null;
      blightChain: ReturnType<typeof buildTonguesChain> | null;
      gateway: Record<string, unknown> | null;
    };

    const runTraces: RunTrace[] = [];
    const factSets: UtilityV2RunFactSet[] = [];
    const manifestRuns: SelectedRunRef[] = [];

    for (const selected of selectedRuns) {
      const digestRow = await prisma.characterRunDigest.findFirst({
        where: {
          characterId: character.id,
          participantActorId: selected.participantActorId,
          extractorVersion: SCORING_EXTRACTOR_VERSION,
          rawRun: {
            reportCode: selected.reportCode,
            fightId: selected.fightId,
            reportRevision: selected.reportRevision,
          },
        },
        include: {
          rawRun: {
            select: {
              id: true,
              reportCode: true,
              fightId: true,
              reportRevision: true,
              acquisitionVersion: true,
              payload: true,
            },
          },
        },
        orderBy: { updatedAt: "desc" },
      });

      const digest = digestRow ? digestFromRow(digestRow) : null;

      let compactEvents: CapabilityCompactEvent[] = [];
      let rawPresent = false;
      if (digestRow?.rawRun?.payload != null) {
        try {
          const parsed = parseWclRunRawPayload(digestRow.rawRun.payload);
          compactEvents = parsed.package.compactEvents;
          rawPresent = true;
        } catch {
          rawPresent = false;
        }
      }

      // Prefer acquisition-version match when multiple raws exist.
      if (
        digestRow?.rawRun &&
        digestRow.rawRun.acquisitionVersion !== SCORING_ACQUISITION_VERSION
      ) {
        const preferred = await prisma.wclRunRaw.findFirst({
          where: {
            reportCode: selected.reportCode,
            fightId: selected.fightId,
            reportRevision: selected.reportRevision,
            acquisitionVersion: SCORING_ACQUISITION_VERSION,
          },
          select: { payload: true },
        });
        if (preferred?.payload != null) {
          try {
            const parsed = parseWclRunRawPayload(preferred.payload);
            compactEvents = parsed.package.compactEvents;
            rawPresent = true;
          } catch {
            // keep prior
          }
        }
      }

      let fact: UtilityV2RunFactSet | null = null;
      if (digest) {
        try {
          fact = suppressTalentMissingLogs(() =>
            utilityRunFactSetFromDigest(digest, {
              slotId: selected.slotId,
              slotIndex: selected.slotIndex,
              runId: `${selected.reportCode}:${selected.fightId}`,
            }),
          );
          factSets.push(fact);
          manifestRuns.push(selected);
        } catch (err) {
          fact = null;
          line(
            `WARN digest→fact failed ${selected.reportCode}:${selected.fightId}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }

      const actorIds = digest ? ownedActorIds(digest) : new Set<number>();
      const observedSpellIds = digest
        ? digest.utility.actions.map((a) => a.primarySpellId)
        : [];
      const talentIds =
        digest?.loadoutEvidence.evidenceState === "PRESENT"
          ? digest.loadoutEvidence.talentSpellIds
          : undefined;

      const observedInRun = new Set<number>();
      for (const a of digest?.utility.actions ?? []) {
        observedInRun.add(a.primarySpellId);
        for (const id of a.observedSpellIds) observedInRun.add(id);
      }
      for (const ev of compactEvents) {
        if (ev.spellId == null) continue;
        if (!UTILITY_DATASETS.has(ev.dataset)) continue;
        const source = ev.sourceActorId;
        const owner = ev.sourceOwnerPlayerActorId;
        if (
          (source != null && actorIds.has(source)) ||
          (owner != null && actorIds.has(owner))
        ) {
          observedInRun.add(ev.spellId);
        }
      }

      const abilities: Array<Record<string, unknown>> = [];
      for (const rule of catalogRules) {
        const ids = spellIdSet(rule);
        const hit = [...ids].some((id) => observedInRun.has(id));
        if (!hit) continue;

        const rawCount = countRawPersistedObservations({
          events: compactEvents,
          actorIds,
          spellIds: ids,
        });
        const canonical = digest ? actionsForSpell(digest.utility.actions, ids) : [];
        const family = utilityFamilyFromCatalogRule(rule);
        const capability = resolveAbilityCapability(rule, {
          knownTalentSpellIds: talentIds,
          observedSpellIds,
        });
        const factCredited =
          fact && family ? creditedCountForSpell(fact, ids, family) : 0;
        const supportSample =
          fact?.supportActions.filter(
            (a) => a.abilityGameId != null && ids.has(a.abilityGameId),
          ) ?? [];
        const scoredSupport = supportSample.reduce((s, a) => {
          if (a.semantic === "UNVERIFIED_EXTERNAL") return s;
          const tierMult =
            a.tier === "CONFIRMED_IMPACT"
              ? 1
              : a.tier === "CONFIRMED_APPLICATION"
                ? 0.45
                : 0;
          return s + (tierMult > 0 ? 1 : 0);
        }, 0);
        // For families scored as aggregates (dispel/bloodlust), fall back to
        // canonical SUCCESS actions so the row is not falsely zero.
        const credited =
          family === "dispelPurge" || family === "bloodlust"
            ? canonical.filter((a) => a.outcome === "SUCCESS").length ||
              canonical.length
            : family === "groupSupport"
              ? scoredSupport
              : factCredited;
        const ccCount =
          fact?.ccActions.filter((a) => ids.has(a.abilityGameId)).length ?? 0;

        abilities.push({
          spellId: rule.spellIds[0]!,
          allSpellIds: [...ids],
          canonicalKey: rule.canonicalKey,
          canonicalName: rule.name,
          catalogCategory: rule.category,
          rawPersistedObservationCount: rawCount,
          utilityCanonicalActionCount: canonical.length,
          observedSpellIds: [
            ...new Set(canonical.flatMap((a) => a.observedSpellIds)),
          ],
          capabilityState: capability.state,
          capabilityReason: capability.reason,
          resolvedUtilityFamily: family,
          creditedActionCount: credited,
          factMappedActionCount: factCredited,
          supportSemantics: [
            ...new Set(supportSample.map((a) => `${a.semantic}/${a.tier}`)),
          ],
          ccActionCount: ccCount,
        });
      }

      const curseIds = new Set([FOCUS.CURSE_OF_TONGUES]);
      const blightIds = new Set([FOCUS.BLIGHT_OF_TONGUES]);
      const gatewayIds = focusRules.gateway
        ? spellIdSet(focusRules.gateway)
        : new Set([FOCUS.DEMONIC_GATEWAY, 113942]);

      const curseRaw = countRawPersistedObservations({
        events: compactEvents,
        actorIds,
        spellIds: curseIds,
      });
      const blightRaw = countRawPersistedObservations({
        events: compactEvents,
        actorIds,
        spellIds: blightIds,
      });
      const gatewayRaw = countRawPersistedObservations({
        events: compactEvents,
        actorIds,
        spellIds: gatewayIds,
      });

      const curseActions = digest
        ? actionsForSpell(digest.utility.actions, curseIds)
        : [];
      const blightActions = digest
        ? actionsForSpell(digest.utility.actions, blightIds)
        : [];
      const gatewayActions = digest
        ? actionsForSpell(digest.utility.actions, gatewayIds)
        : [];

      const curseRule =
        focusRules.curse ??
        ruleForSpell(FOCUS.CURSE_OF_TONGUES, digest?.classSlug ?? null, digest?.specSlug ?? null);
      const blightRule =
        focusRules.blight ??
        ruleForSpell(
          FOCUS.BLIGHT_OF_TONGUES,
          digest?.classSlug ?? null,
          digest?.specSlug ?? null,
        );
      const gatewayRule =
        focusRules.gateway ??
        ruleForSpell(
          FOCUS.DEMONIC_GATEWAY,
          digest?.classSlug ?? null,
          digest?.specSlug ?? null,
        );

      const curseCap = curseRule
        ? resolveAbilityCapability(curseRule, {
            knownTalentSpellIds: talentIds,
            observedSpellIds,
          })
        : { state: "UNKNOWN", reason: "no_rule" };
      const blightCap = blightRule
        ? resolveAbilityCapability(blightRule, {
            knownTalentSpellIds: talentIds,
            observedSpellIds,
          })
        : { state: "UNKNOWN", reason: "no_rule" };
      const gatewayCap = gatewayRule
        ? resolveAbilityCapability(gatewayRule, {
            knownTalentSpellIds: talentIds,
            observedSpellIds,
          })
        : { state: "UNKNOWN", reason: "no_rule" };

      const curseCc =
        fact?.ccActions.filter((a) => a.abilityGameId === FOCUS.CURSE_OF_TONGUES)
          .length ?? 0;
      const blightCc =
        fact?.ccActions.filter((a) => a.abilityGameId === FOCUS.BLIGHT_OF_TONGUES)
          .length ?? 0;
      const gatewayMapped =
        fact && gatewayRule
          ? creditedCountForSpell(
              fact,
              gatewayIds,
              utilityFamilyFromCatalogRule(gatewayRule),
            )
          : 0;
      const gatewaySupportRows =
        fact?.supportActions.filter(
          (a) => a.abilityGameId != null && gatewayIds.has(a.abilityGameId),
        ) ?? [];
      const gatewayScoredCredit = gatewaySupportRows.reduce((s, a) => {
        // Mirror scoreSupportCredit: UNVERIFIED_EXTERNAL / tier without impact → 0.
        if (a.semantic === "UNVERIFIED_EXTERNAL") return s;
        const tierMult =
          a.tier === "CONFIRMED_IMPACT" ? 1 : a.tier === "CONFIRMED_APPLICATION" ? 0.45 : 0;
        return s + (tierMult > 0 ? 1 : 0);
      }, 0);

      const curseChain = buildTonguesChain({
        label: "CURSE OF TONGUES",
        spellId: FOCUS.CURSE_OF_TONGUES,
        rawCount: curseRaw,
        rule: curseRule,
        canonicalActions: curseActions,
        observedSpellIds,
        capabilityState: curseCap.state,
        capabilityReason: curseCap.reason,
        family: curseRule ? utilityFamilyFromCatalogRule(curseRule) : null,
        ccCount: curseCc,
        creditedCount: curseCc,
      });
      const blightChain = buildTonguesChain({
        label: "BLIGHT OF TONGUES",
        spellId: FOCUS.BLIGHT_OF_TONGUES,
        rawCount: blightRaw,
        rule: blightRule,
        canonicalActions: blightActions,
        observedSpellIds,
        capabilityState: blightCap.state,
        capabilityReason: blightCap.reason,
        family: blightRule ? utilityFamilyFromCatalogRule(blightRule) : null,
        ccCount: blightCc,
        creditedCount: blightCc,
      });

      runTraces.push({
        selected,
        digest,
        rawPresent,
        rawEventCount: compactEvents.length,
        fact,
        abilities,
        curseChain,
        blightChain,
        gateway: {
          spellId: FOCUS.DEMONIC_GATEWAY,
          rawPersistedObservationCount: gatewayRaw,
          utilityCanonicalActionCount: gatewayActions.length,
          capabilityState: gatewayCap.state,
          capabilityReason: gatewayCap.reason,
          resolvedUtilityFamily: gatewayRule
            ? utilityFamilyFromCatalogRule(gatewayRule)
            : null,
          factMappedSupportActionCount: gatewayMapped,
          scoredCreditedActionCount: gatewayScoredCredit,
          creditedActionCount: gatewayScoredCredit,
          supportActionSample: gatewaySupportRows.slice(0, 5).map((a) => ({
            id: a.id,
            semantic: a.semantic,
            tier: a.tier,
            abilityGameId: a.abilityGameId,
          })),
        },
      });
    }

    const reconstructed =
      factSets.length > 0
        ? (() => {
            // Match production: ACTIVE ScoreModel tunable weights → Utility config.
            // Without this, default family weights diverge from persisted scores.
            return (async () => {
              const activeModel = await prisma.scoreModel.findFirst({
                where: { status: "ACTIVE" },
                orderBy: { version: "desc" },
                select: { id: true, key: true, version: true, config: true },
              });
              const scoreModelConfig =
                activeModel?.config != null &&
                typeof activeModel.config === "object"
                  ? (activeModel.config as Record<string, unknown>)
                  : null;
              const { weights: tunableWeights } =
                resolveTunableWeights(scoreModelConfig);
              const utilityModelConfig =
                applyTunableWeightsToUtilityConfig(tunableWeights);
              line(
                `scoreModel: ${activeModel?.key ?? "n/a"} v${activeModel?.version ?? "?"} (${activeModel?.id ?? "none"})`,
              );
              return computeUtilityV2(
                {
                  manifest: buildManifest(manifestRuns),
                  factSets,
                },
                { modelConfig: utilityModelConfig },
              );
            })();
          })()
        : Promise.resolve(null);
    const reconstructedResult = await reconstructed;

    const persistedUtilityDetails =
      score.dimensionDetails != null &&
      typeof score.dimensionDetails === "object" &&
      (score.dimensionDetails as { utility?: unknown }).utility != null &&
      typeof (score.dimensionDetails as { utility: unknown }).utility === "object"
        ? ((score.dimensionDetails as { utility: Record<string, unknown> }).utility)
        : null;

    // ---- Report ----
    section("UTILITY LIVE TRACE — PROVIDER-FREE");
    line(`character: ${character.displayName} (${character.id})`);
    line(
      `identity: ${character.region.code}/${character.realm.slug} class=${character.gameClass?.slug ?? "?"} spec=${character.activeSpec?.slug ?? "?"}`,
    );
    line(`season: ${currentSeason?.slug ?? currentSeason?.id ?? "?"}`);
    line(`characterScoreId: ${score.id}`);
    line(`persistedUtilityScore: ${score.utility}`);
    line(
      `selectedRuns: ${selectedRuns.length} slots (unique fights=${new Set(selectedRuns.map((r) => `${r.reportCode}:${r.fightId}`)).size}; typically 8 dungeons × 2 slots)`,
    );
    line(`providerCalls: ${providerCalls}`);
    line(
      "providerCallsProof: CLI uses only Prisma + pure digest/scoring adapters; no WCL/Blizzard/RIO client is imported or invoked.",
    );
    line(`acquisitionVersionExpected: ${SCORING_ACQUISITION_VERSION}`);
    line(`extractorVersionExpected: ${SCORING_EXTRACTOR_VERSION}`);

    section("FOCUS SPELLS");
    line(`CURSE OF TONGUES — ${FOCUS.CURSE_OF_TONGUES}`);
    line(`BLIGHT OF TONGUES — ${FOCUS.BLIGHT_OF_TONGUES}`);
    line(`DEMONIC GATEWAY — ${FOCUS.DEMONIC_GATEWAY}`);

    for (const trace of runTraces) {
      const s = trace.selected;
      const d = trace.digest;
      section(
        `RUN ${s.slotId}  ${s.reportCode}:${s.fightId} rev=${s.reportRevision}`,
      );
      line(`dungeonSlug: ${s.dungeonSlug}`);
      line(`specSlug: ${d?.specSlug ?? "MISSING_DIGEST"}`);
      line(
        `loadoutEvidence: ${d?.loadoutEvidence.evidenceState ?? "MISSING_DIGEST"} (talents=${d?.loadoutEvidence.talentSpellIds.length ?? 0})`,
      );
      line(
        `rawPackage: ${trace.rawPresent ? "PRESENT" : "ABSENT"} compactEvents=${trace.rawEventCount}`,
      );
      line(
        `digest.utility: completeness=${d?.utility.completeness ?? "n/a"} actions=${d?.utility.actions.length ?? 0}`,
      );

      line();
      line("--- Observed Warlock Utility abilities in this run ---");
      if (trace.abilities.length === 0) {
        line("(none catalog-recognized in raw/digest for this participant)");
      } else {
        for (const a of trace.abilities) {
          line(
            [
              `spellId=${a.spellId}`,
              `key=${a.canonicalKey}`,
              `name=${a.canonicalName}`,
              `cat=${a.catalogCategory}`,
              `raw=${a.rawPersistedObservationCount}`,
              `canonical=${a.utilityCanonicalActionCount}`,
              `cap=${a.capabilityState}/${a.capabilityReason}`,
              `family=${a.resolvedUtilityFamily}`,
              `credited=${a.creditedActionCount}`,
            ].join(" | "),
          );
        }
      }

      line();
      line("--- CURSE OF TONGUES — 1714 chain ---");
      if (trace.curseChain) {
        for (const st of trace.curseChain.stages) {
          line(`  [${st.ok ? "OK" : "MISS"}] ${st.stage}: ${st.detail}`);
        }
        line(
          `  FIRST_BREAK: ${trace.curseChain.firstBreak ?? "NONE (full chain intact)"}`,
        );
      }

      line();
      line("--- BLIGHT OF TONGUES — 1271802 chain ---");
      if (trace.blightChain) {
        for (const st of trace.blightChain.stages) {
          line(`  [${st.ok ? "OK" : "MISS"}] ${st.stage}: ${st.detail}`);
        }
        line(
          `  FIRST_BREAK: ${trace.blightChain.firstBreak ?? "NONE (full chain intact)"}`,
        );
      }

      line();
      line("--- DEMONIC GATEWAY — 111771 ---");
      line(JSON.stringify(trace.gateway, null, 2));
    }

    // Aggregates
    const curseRuns = runTraces.filter(
      (t) => (t.curseChain?.stages[0]?.ok ?? false) || (t.abilities.find((a) => a.spellId === FOCUS.CURSE_OF_TONGUES)?.utilityCanonicalActionCount as number) > 0,
    );
    const blightRuns = runTraces.filter(
      (t) => t.blightChain?.stages[0]?.ok || ((t.abilities.find((a) => a.spellId === FOCUS.BLIGHT_OF_TONGUES)?.utilityCanonicalActionCount as number) ?? 0) > 0,
    );
    const gatewayRuns = runTraces.filter(
      (t) => ((t.gateway?.utilityCanonicalActionCount as number) ?? 0) > 0 || ((t.gateway?.rawPersistedObservationCount as number) ?? 0) > 0,
    );

    const sumAbility = (spellId: number, field: string): number =>
      runTraces.reduce((s, t) => {
        const a = t.abilities.find((x) => x.spellId === spellId);
        return s + (typeof a?.[field] === "number" ? (a[field] as number) : 0);
      }, 0);

    const sumGateway = (field: string): number =>
      runTraces.reduce((s, t) => {
        const v = t.gateway?.[field];
        return s + (typeof v === "number" ? v : 0);
      }, 0);

    section(
      `AGGREGATE SPELL COUNTS (${selectedRuns.length} selected slots)`,
    );
    line("Curse of Tongues:");
    line(`  runs observed (raw>0 or canonical>0): ${curseRuns.length}`);
    line(`  raw observations: ${sumAbility(FOCUS.CURSE_OF_TONGUES, "rawPersistedObservationCount")}`);
    line(`  canonical actions: ${sumAbility(FOCUS.CURSE_OF_TONGUES, "utilityCanonicalActionCount")}`);
    line(`  credited actions: ${sumAbility(FOCUS.CURSE_OF_TONGUES, "creditedActionCount")}`);
    line("Blight of Tongues:");
    line(`  runs observed (raw>0 or canonical>0): ${blightRuns.length}`);
    line(`  raw observations: ${sumAbility(FOCUS.BLIGHT_OF_TONGUES, "rawPersistedObservationCount")}`);
    line(`  canonical actions: ${sumAbility(FOCUS.BLIGHT_OF_TONGUES, "utilityCanonicalActionCount")}`);
    line(`  credited actions: ${sumAbility(FOCUS.BLIGHT_OF_TONGUES, "creditedActionCount")}`);
    line("Gateway:");
    line(`  runs observed: ${gatewayRuns.length}`);
    line(`  raw observations: ${sumGateway("rawPersistedObservationCount")}`);
    line(`  canonical actions: ${sumGateway("utilityCanonicalActionCount")}`);
    line(
      `  fact-mapped support rows: ${sumGateway("factMappedSupportActionCount")}`,
    );
    line(`  scored credited actions: ${sumGateway("scoredCreditedActionCount")}`);

    section("UTILITY FAMILIES (reconstructed from selected digests)");
    const familyRows: UtilityV2DomainBreakdown[] =
      reconstructedResult?.domainBreakdown ?? [];
    for (const key of UTILITY_V2_FAMILY_KEYS) {
      const row = familyRows.find((d) => d.domain === key);
      const opportunityRuns = factSets.filter((f) => {
        const fam = f.toolkit.families?.[key];
        if (fam) return fam.state === "applicable" || fam.state === "optional";
        if (key === "interrupt") return f.toolkit.hasInterrupt;
        if (key === "crowdControl") return f.toolkit.hasStrategicCc;
        if (key === "groupSupport" || key === "combatRes" || key === "movement") {
          return f.toolkit.hasSupport;
        }
        return false;
      }).length;
      const opportunityHours = factSets
        .filter((f) => {
          const fam = f.toolkit.families?.[key];
          if (fam) return fam.state === "applicable" || fam.state === "optional";
          return false;
        })
        .reduce((s, f) => s + f.activeCombatHours, 0);

      line(`family: ${key}`);
      line(`  applicable: ${row?.applicable ?? false}`);
      line(`  applicable/opportunity run count: ${opportunityRuns}`);
      line(`  opportunity activeCombatHours: ${opportunityHours.toFixed(4)}`);
      line(`  raw events: ${row?.events ?? 0}`);
      line(`  credited events: ${row?.creditedEvents ?? 0}`);
      line(`  intensity (perCombatHour): ${row?.perCombatHour ?? "n/a"}`);
      line(`  rawScore: ${row?.rawScore ?? "n/a"}`);
      line(`  effectiveWeight (weightShare): ${row?.weightShare ?? 0}`);
      line(`  weighted contribution: ${row?.cappedContribution ?? 0}`);
      if (row?.notes?.length) line(`  notes: ${row.notes.join("; ")}`);
      line();
    }

    section("RECONSTRUCTED UTILITY SCORE");
    line(`persisted CharacterScore.utility: ${score.utility}`);
    line(`reconstructed computeUtilityV2.score: ${reconstructedResult?.score ?? null}`);
    line(`availabilityState: ${reconstructedResult?.availabilityState ?? "n/a"}`);
    if (persistedUtilityDetails?.domainBreakdown) {
      line("persisted dimensionDetails.utility.domainBreakdown contributions:");
      const persisted = persistedUtilityDetails.domainBreakdown as UtilityV2DomainBreakdown[];
      if (Array.isArray(persisted)) {
        for (const d of [...persisted].sort(
          (a, b) => (a.cappedContribution ?? 0) - (b.cappedContribution ?? 0),
        )) {
          line(
            `  ${d.domain}: applicable=${d.applicable} raw=${d.rawScore} contrib=${d.cappedContribution} credited=${d.creditedEvents}`,
          );
        }
      }
    }

    const pullDown = [...familyRows]
      .filter((d) => d.applicable)
      .sort((a, b) => (a.cappedContribution ?? 0) - (b.cappedContribution ?? 0));

    section("MAIN REASONS UTILITY IS LOW");
    if (pullDown.length === 0) {
      line("No applicable families in reconstruction.");
    } else {
      for (const d of pullDown.slice(0, 5)) {
        const why =
          (d.creditedEvents ?? 0) <= 0
            ? "applicable but unused (floor / zero contribution)"
            : "low intensity / low weight share";
        line(
          `- ${d.domain}: contrib=${d.cappedContribution} rawScore=${d.rawScore} credited=${d.creditedEvents} → ${why}`,
        );
      }
    }

    section("EVIDENCE-LOSS / PIPELINE BOUNDARY NOTES");
    const curseBreaks = new Map<string, number>();
    const blightBreaks = new Map<string, number>();
    for (const t of runTraces) {
      const cb = t.curseChain?.firstBreak;
      const bb = t.blightChain?.firstBreak;
      if (cb) curseBreaks.set(cb, (curseBreaks.get(cb) ?? 0) + 1);
      if (bb) blightBreaks.set(bb, (blightBreaks.get(bb) ?? 0) + 1);
    }
    line("Curse first-break histogram:");
    if (curseBreaks.size === 0) line("  (all stages OK or no runs)");
    else for (const [k, v] of curseBreaks) line(`  ${k}: ${v} runs`);
    line("Blight first-break histogram:");
    if (blightBreaks.size === 0) line("  (all stages OK or no runs)");
    else for (const [k, v] of blightBreaks) line(`  ${k}: ${v} runs`);

    const gatewayCanonical = sumGateway("utilityCanonicalActionCount");
    const groupSupport = familyRows.find((d) => d.domain === "groupSupport");
    if (
      groupSupport &&
      groupSupport.events > 0 &&
      (groupSupport.creditedEvents ?? 0) === 0
    ) {
      line(
        "BUG_CANDIDATE: groupSupport has raw supportActions/events but family creditedEvents=0. Demonic Gateway maps to OTHER_UTILITY → semantic UNVERIFIED_EXTERNAL; scoreSupportCredit ignores UNVERIFIED_EXTERNAL (credit mult 0).",
      );
      line(
        `  gateway canonicalActions=${gatewayCanonical} factMappedSupportRows=${sumGateway("factMappedSupportActionCount")} scoredCredited=${sumGateway("scoredCreditedActionCount")} familyCredited=${groupSupport.creditedEvents}`,
      );
    }
    if (
      gatewayCanonical > 0 &&
      sumGateway("factMappedSupportActionCount") === 0
    ) {
      line(
        "BUG_CANDIDATE: Demonic Gateway reaches UtilityCanonicalAction but not fact supportActions.",
      );
    }
    if (
      sumAbility(FOCUS.CURSE_OF_TONGUES, "rawPersistedObservationCount") > 0 &&
      sumAbility(FOCUS.CURSE_OF_TONGUES, "utilityCanonicalActionCount") === 0
    ) {
      line(
        "BUG_CANDIDATE: Curse raw persisted events exist but UtilityCanonicalAction count is 0.",
      );
    }
    if (
      sumAbility(FOCUS.BLIGHT_OF_TONGUES, "rawPersistedObservationCount") > 0 &&
      sumAbility(FOCUS.BLIGHT_OF_TONGUES, "utilityCanonicalActionCount") === 0
    ) {
      line(
        "BUG_CANDIDATE: Blight raw persisted events exist but UtilityCanonicalAction count is 0.",
      );
    }
    if (
      sumAbility(FOCUS.CURSE_OF_TONGUES, "rawPersistedObservationCount") === 0 &&
      sumAbility(FOCUS.BLIGHT_OF_TONGUES, "rawPersistedObservationCount") === 0
    ) {
      line(
        "RESULT: 1714/1271802 do not occur in persisted WCL evidence for these 8 selected runs (valid diagnostic outcome).",
      );
    }

    section("MACHINE SUMMARY JSON");
    console.log(
      JSON.stringify(
        {
          ok: true,
          mutation: false,
          providerCalls,
          characterId: character.id,
          characterScoreId: score.id,
          persistedUtility: score.utility,
          reconstructedUtility: reconstructedResult?.score ?? null,
          selectedRunCount: selectedRuns.length,
          curse: {
            runsObserved: curseRuns.length,
            raw: sumAbility(FOCUS.CURSE_OF_TONGUES, "rawPersistedObservationCount"),
            canonical: sumAbility(FOCUS.CURSE_OF_TONGUES, "utilityCanonicalActionCount"),
            credited: sumAbility(FOCUS.CURSE_OF_TONGUES, "creditedActionCount"),
            firstBreakHistogram: Object.fromEntries(curseBreaks),
          },
          blight: {
            runsObserved: blightRuns.length,
            raw: sumAbility(FOCUS.BLIGHT_OF_TONGUES, "rawPersistedObservationCount"),
            canonical: sumAbility(FOCUS.BLIGHT_OF_TONGUES, "utilityCanonicalActionCount"),
            credited: sumAbility(FOCUS.BLIGHT_OF_TONGUES, "creditedActionCount"),
            firstBreakHistogram: Object.fromEntries(blightBreaks),
          },
          gateway: {
            runsObserved: gatewayRuns.length,
            raw: sumGateway("rawPersistedObservationCount"),
            canonical: gatewayCanonical,
            factMappedSupportRows: sumGateway("factMappedSupportActionCount"),
            scoredCredited: sumGateway("scoredCreditedActionCount"),
          },
          families: familyRows.map((d) => ({
            domain: d.domain,
            applicable: d.applicable,
            events: d.events,
            creditedEvents: d.creditedEvents,
            perCombatHour: d.perCombatHour,
            rawScore: d.rawScore,
            weightShare: d.weightShare,
            contribution: d.cappedContribution,
          })),
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        mutation: false,
        providerCalls: 0,
        message: err instanceof Error ? err.message : String(err),
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
