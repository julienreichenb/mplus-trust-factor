/**
 * RuntimeSetting accessors for platform-wide scoring season selection.
 */
import type { PrismaClient } from "@mplus/database";
import {
  DEFAULT_SCORING_SEASON_SELECTION,
  RUNTIME_SETTING_KEYS,
  parseScoringSeasonSelection,
  tryParseScoringSeasonSelection,
  type ScoringSeasonSelection,
  type UpdateScoringSeasonSelectionBody,
} from "@mplus/contracts";

export interface ScoringSeasonSelectionRow {
  selection: ScoringSeasonSelection;
  version: number;
  updatedAt: Date | null;
  updatedByUserId: string | null;
}

/** Missing row => AUTO (no seed/migration required). */
export async function getScoringSeasonSelection(
  prisma: PrismaClient,
): Promise<ScoringSeasonSelectionRow> {
  const row = await prisma.runtimeSetting.findUnique({
    where: { key: RUNTIME_SETTING_KEYS.scoringSeasonSelection },
  });
  if (!row) {
    return {
      selection: DEFAULT_SCORING_SEASON_SELECTION,
      version: 0,
      updatedAt: null,
      updatedByUserId: null,
    };
  }
  const parsed = tryParseScoringSeasonSelection(row.value);
  if (!parsed.ok) {
    throw Object.assign(
      new Error(`Invalid scoring_season_selection RuntimeSetting: ${parsed.error}`),
      { code: "SCORING_SEASON_SELECTION_INVALID" },
    );
  }
  return {
    selection: parsed.value,
    version: row.version,
    updatedAt: row.updatedAt,
    updatedByUserId: row.updatedByUserId,
  };
}

export class ScoringSeasonSelectionConflictError extends Error {
  readonly code = "SCORING_SEASON_SELECTION_VERSION_CONFLICT" as const;
  constructor(message = "Scoring season selection version conflict") {
    super(message);
    this.name = "ScoringSeasonSelectionConflictError";
  }
}

export class ScoringSeasonNotPinnableError extends Error {
  readonly code = "SCORING_SEASON_NOT_PINNABLE" as const;
  constructor(message: string) {
    super(message);
    this.name = "ScoringSeasonNotPinnableError";
  }
}

/**
 * Persist an atomic AUTO | PINNED selection with optimistic concurrency.
 * Callers must validate PINNED seasons are catalog-ready before calling.
 */
export async function updateScoringSeasonSelection(
  prisma: PrismaClient,
  body: UpdateScoringSeasonSelectionBody,
  updatedByUserId: string | null,
): Promise<ScoringSeasonSelectionRow> {
  const next: ScoringSeasonSelection =
    body.mode === "AUTO"
      ? { mode: "AUTO" }
      : { mode: "PINNED", blizzardSeasonId: body.blizzardSeasonId };

  // Validate shape (strict).
  parseScoringSeasonSelection(next);

  const existing = await prisma.runtimeSetting.findUnique({
    where: { key: RUNTIME_SETTING_KEYS.scoringSeasonSelection },
  });

  if (!existing) {
    if (body.expectedVersion !== 1 && body.expectedVersion !== 0) {
      // First write: accept expectedVersion 0 (missing) or 1 (client bootstrap).
      throw new ScoringSeasonSelectionConflictError(
        `Expected version ${body.expectedVersion} but setting does not exist`,
      );
    }
    const created = await prisma.runtimeSetting.create({
      data: {
        key: RUNTIME_SETTING_KEYS.scoringSeasonSelection,
        value: next,
        version: 1,
        updatedByUserId,
      },
    });
    return {
      selection: next,
      version: created.version,
      updatedAt: created.updatedAt,
      updatedByUserId: created.updatedByUserId,
    };
  }

  if (existing.version !== body.expectedVersion) {
    throw new ScoringSeasonSelectionConflictError(
      `Expected version ${body.expectedVersion}, found ${existing.version}`,
    );
  }

  const updated = await prisma.runtimeSetting.updateMany({
    where: {
      key: RUNTIME_SETTING_KEYS.scoringSeasonSelection,
      version: body.expectedVersion,
    },
    data: {
      value: next,
      version: { increment: 1 },
      updatedByUserId,
    },
  });
  if (updated.count !== 1) {
    throw new ScoringSeasonSelectionConflictError();
  }

  const row = await prisma.runtimeSetting.findUniqueOrThrow({
    where: { key: RUNTIME_SETTING_KEYS.scoringSeasonSelection },
  });
  return {
    selection: parseScoringSeasonSelection(row.value),
    version: row.version,
    updatedAt: row.updatedAt,
    updatedByUserId: row.updatedByUserId,
  };
}
