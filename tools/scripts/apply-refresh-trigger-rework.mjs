import fs from "node:fs";

function edit(path, transform) {
  const before = fs.readFileSync(path, "utf8");
  const after = transform(before);
  if (after === before) throw new Error(`No changes applied to ${path}`);
  fs.writeFileSync(path, after);
}

function replaceOnce(text, from, to, label) {
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: expected 1 match, got ${count}`);
  return text.replace(from, to);
}

edit("apps/api/src/services/character-service.ts", (source) => {
  let s = source;

  s = replaceOnce(
    s,
    `    operationalGrade?: string | null;\n  }): Promise<{`,
    `    operationalGrade?: string | null;\n    /** Authoritative product score time (published snapshot or newer operational score). */\n    productScoreCalculatedAt?: Date | string | null;\n  }): Promise<{`,
    "character policy input",
  );

  s = replaceOnce(
    s,
    `      readOnly = false,\n      operationalGrade,\n    } = params;`,
    `      readOnly = false,\n      operationalGrade,\n      productScoreCalculatedAt,\n    } = params;`,
    "character policy destructure",
  );

  s = replaceOnce(
    s,
    `    const publishedGrade = snapshot?.grade ?? null;\n    const effectiveGrade = operationalGrade ?? publishedGrade;\n    const decisionBase = decideScoreRefresh({`,
    `    const publishedGrade = snapshot?.grade ?? null;\n    const effectiveGrade = operationalGrade ?? publishedGrade;\n    const effectiveScoreCalculatedAt = productScoreCalculatedAt ?? snapshot?.calculatedAt ?? null;\n    let mythicRatingDelta: number | null = null;\n    if (authority && effectiveScoreCalculatedAt) {\n      const scoreAt =\n        effectiveScoreCalculatedAt instanceof Date\n          ? effectiveScoreCalculatedAt\n          : new Date(effectiveScoreCalculatedAt);\n      if (!Number.isNaN(scoreAt.getTime())) {\n        const [currentSignals, baselineObservation] = await Promise.all([\n          loadCharacterRefreshEligibilitySignals(this.container.worker.prisma, {\n            characterId: character.id,\n            authority,\n          }),\n          this.container.worker.prisma.metricObservation.findFirst({\n            where: {\n              characterId: character.id,\n              seasonId: authority.seasonRowId,\n              metricDefinition: { key: \"experience.mythic_rating\" },\n              rawValue: { not: null },\n              observedAt: { lte: scoreAt },\n            },\n            orderBy: { observedAt: \"desc\" },\n            select: { rawValue: true },\n          }),\n        ]);\n        const currentRating = currentSignals.currentSeasonMythicScore;\n        const baselineRating =\n          baselineObservation?.rawValue != null ? Number(baselineObservation.rawValue) : null;\n        if (\n          typeof currentRating === \"number\" &&\n          Number.isFinite(currentRating) &&\n          baselineRating != null &&\n          Number.isFinite(baselineRating)\n        ) {\n          mythicRatingDelta = currentRating - baselineRating;\n        }\n      }\n    }\n    const decisionBase = decideScoreRefresh({`,
    "rating delta insertion",
  );

  s = replaceOnce(
    s,
    `      scoreCalculatedAt: snapshot?.calculatedAt ?? null,\n      gradeIsU: effectiveGrade === \"U\",`,
    `      scoreCalculatedAt: effectiveScoreCalculatedAt,\n      gradeIsU: effectiveGrade === \"U\",`,
    "score calculated at authority",
  );

  s = replaceOnce(
    s,
    `      contractReasons: seasonAuthorityUnavailable ? [] : contractReasons,\n      providerNewerThanScore: false,`,
    `      contractReasons: seasonAuthorityUnavailable ? [] : contractReasons,\n      mythicRatingDelta,\n      providerNewerThanScore: false,`,
    "rating delta decision input",
  );

  const recalcBranch = `      } else if (decision.action === \"RECALCULATE\" && snapshot) {\n        try {\n          enqueueResult = await this.enqueueRecalculate(character, snapshot);\n        } catch (error) {\n          if (error instanceof SeasonAuthorityUnavailableError) {\n            decision = { ...decision, action: \"NONE\" };\n          } else {\n            throw error;\n          }\n        }\n      }\n`;
  s = replaceOnce(s, recalcBranch, `      }\n`, "remove profile recalculate branch");

  const callNeedle = `      operationalGrade: productScore.score?.grade ?? null,\n    });`;
  const callReplacement = `      operationalGrade: productScore.score?.grade ?? null,\n      productScoreCalculatedAt: productScore.score?.calculatedAt ?? null,\n    });`;
  const callCount = s.split(callNeedle).length - 1;
  if (callCount !== 2) throw new Error(`product score policy calls: expected 2, got ${callCount}`);
  s = s.split(callNeedle).join(callReplacement);

  return s;
});

edit("apps/api/src/services/admin-service.ts", (source) => {
  let s = source;
  s = s.replace(`  BulkOperationDTO,\n`, ``);
  s = s.replace(`import { requireEffectiveScoringSeasonRow } from \"@mplus/worker\";\n`, ``);
  s = s.replace(`import { BulkCharacterProcessingService } from \"./bulk-character-processing-service.js\";\n`, ``);
  s = s.replace(
    `   * Transactional draft activation: archive previous ACTIVE for the key, audit, then enqueue\n   * RECALCULATE_ONLY for all persisted characters. No provider calls during the request.`,
    `   * Transactional draft activation: archive previous ACTIVE for the key and audit.\n   * Existing character scores are not recalculated here; the new model is adopted on the next legitimate refresh.`,
  );

  const start = s.indexOf(`    let bulkOperation: BulkOperationDTO | null = null;`);
  const end = s.indexOf(`    return {\n      ...mapAdminScoreModel(activated),`, start);
  if (start < 0 || end < 0) throw new Error("admin activation bulk block not found");
  s = s.slice(0, start) + s.slice(end);
  s = replaceOnce(s, `      bulkOperationId: bulkOperation?.id ?? null,\n      bulkEnqueueError,`, `      bulkOperationId: null,\n      bulkEnqueueError: null,`, "activation response");
  return s;
});

edit("apps/api/src/services/admin-score-context-service.ts", (source) => {
  let s = source;
  s = s.replace(`import { randomUUID } from \"node:crypto\";\n`, ``);
  s = s.replace(`import { BulkCharacterProcessingService } from \"./bulk-character-processing-service.js\";\n`, ``);
  const start = s.indexOf(`    const recalc = await this.enqueueRecalc(`);
  const end = s.indexOf(`  async getKeyDistributionStatus(seasonId: string) {`, start);
  if (start < 0 || end < 0) throw new Error("score-context recalc block not found");
  const replacement = `    // Publication only changes the configuration authority. Existing scores remain valid\n    // until their next legitimate refresh (age/rating/scheduled/admin trigger).\n    void createdByUserId;\n    return {\n      revision: toAdminRevisionView(published),\n      recalc: null,\n    };\n  }\n\n`;
  s = s.slice(0, start) + replacement + s.slice(end);
  return s;
});

edit("apps/api/src/routes/admin-score-context.ts", (source) => {
  const start = source.indexOf(`    app.post(\n      \"/api/v1/admin/seasons/:seasonId/score-context/recalculate\"`);
  if (start < 0) throw new Error("score-context recalculate route not found");
  const next = source.indexOf(`    );`, start);
  if (next < 0) throw new Error("score-context recalculate route terminator not found");
  return source.slice(0, start) + source.slice(next + 7);
});

edit("apps/web/src/pages/AdminScoreContextPage.vue", (source) => {
  let s = source;
  s = s.replace(`type RecalcStatus = \"QUEUED\" | \"ENQUEUE_FAILED\" | \"NO_SCORES\" | null;\n`, ``);
  s = s.replace(/const recalc = ref<[\s\S]*?\);\n\nasync function fetchJson/, `async function fetchJson`);
  s = s.replace(
    /    const result = await fetchJson<\{[\s\S]*?\}>\(`\/api\/v1\/admin\/score-context\/revisions\/\$\{working\.value\.id\}\/publish`, \{ method: \"POST\" \}\);\n    recalc\.value = result\.recalc;/,
    `    await fetchJson(\`/api/v1/admin/score-context/revisions/\${working.value.id}/publish\`, { method: \"POST\" });`,
  );
  s = s.replace(/\nasync function retryRecalc\(\): Promise<void> \{[\s\S]*?\n\}\n\nasync function setTierFactor/, `\nasync function setTierFactor`);
  s = s.replace(/\n    <StatusBanner\n      v-if="recalc\?\.status === 'QUEUED'"[\s\S]*?\n    \/>\n    <StatusBanner\n      v-if="recalc\?\.status === 'ENQUEUE_FAILED'"[\s\S]*?\n    \/>/, ``);
  s = s.replace(/\n      <button\n        v-if="recalc\?\.retryAvailable"[\s\S]*?\n      <\/button>/, ``);
  return s;
});

edit("apps/web/src/pages/CharacterPage.vue", (source) => {
  let s = source;
  s = replaceOnce(
    s,
    `        :repairing="repairing"\n        :admin-character-id=`,
    `        :repairing="repairing"\n        :can-refresh="canForceRefresh"\n        :admin-character-id=`,
    "toolbar can-refresh",
  );
  s = s.replace(
    `<button type="button" class="btn" data-testid="refresh-timeout-retry" @click="refresh()">Retry</button>`,
    `<button v-if="canForceRefresh" type="button" class="btn" data-testid="refresh-timeout-retry" @click="refresh()">Retry</button>`,
  );
  return s;
});

console.log("refresh trigger rework patches applied");
