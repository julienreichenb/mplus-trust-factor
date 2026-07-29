/**
 * Aggregated, abuse-resistant profile view recording.
 * Public GET must never block on this path; at most one DB write per coalesce window.
 */
import { createHash } from "node:crypto";
import type { PrismaClient } from "@mplus/database";

const DEFAULT_COALESCE_MS = 3_600_000; // 1 hour
const MEMORY_RATE_LIMIT_MS = 30_000; // skip DB entirely within 30s

const lastWriteAttemptMs = new Map<string, number>();

export interface RecordProfileViewInput {
  characterId: string;
  /** Optional anonymized viewer key (IP hash / session). Null = anonymous bucket. */
  viewerHash?: string | null;
  source?: string;
  coalesceWindowMs?: number;
  nowMs?: number;
}

export interface RecordProfileViewResult {
  recorded: boolean;
  created: boolean;
  reason?: "memory_rate_limited" | "coalesced_update" | "created" | "error";
}

export function hashViewerIdentity(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 32);
}

function memoryKey(characterId: string, viewerHash: string | null): string {
  return `${characterId}:${viewerHash ?? "anon"}`;
}

/**
 * Upsert-style aggregation: one row per character+viewer within the coalesce window.
 * Repeated bot hits update `viewedAt` on the same row (or are memory-rate-limited).
 */
export async function recordProfileViewAggregated(
  prisma: PrismaClient,
  input: RecordProfileViewInput,
): Promise<RecordProfileViewResult> {
  const nowMs = input.nowMs ?? Date.now();
  const viewerHash = input.viewerHash ?? null;
  const coalesceMs = input.coalesceWindowMs ?? DEFAULT_COALESCE_MS;
  const key = memoryKey(input.characterId, viewerHash);

  const lastAttempt = lastWriteAttemptMs.get(key);
  if (lastAttempt != null && nowMs - lastAttempt < MEMORY_RATE_LIMIT_MS) {
    return { recorded: false, created: false, reason: "memory_rate_limited" };
  }
  lastWriteAttemptMs.set(key, nowMs);

  try {
    const recent = await prisma.characterProfileView.findFirst({
      where: {
        characterId: input.characterId,
        viewerHash,
        viewedAt: { gte: new Date(nowMs - coalesceMs) },
      },
      orderBy: { viewedAt: "desc" },
      select: { id: true },
    });

    if (recent) {
      await prisma.characterProfileView.update({
        where: { id: recent.id },
        data: { viewedAt: new Date(nowMs) },
      });
      return { recorded: true, created: false, reason: "coalesced_update" };
    }

    await prisma.characterProfileView.create({
      data: {
        characterId: input.characterId,
        viewerHash,
        source: input.source ?? "public",
        viewedAt: new Date(nowMs),
      },
    });
    return { recorded: true, created: true, reason: "created" };
  } catch {
    return { recorded: false, created: false, reason: "error" };
  }
}

/** Fire-and-forget wrapper — never awaits in the request path. */
export function scheduleProfileViewRecording(
  prisma: PrismaClient,
  input: RecordProfileViewInput,
  onError?: (err: unknown) => void,
): void {
  void recordProfileViewAggregated(prisma, input).catch((err) => {
    onError?.(err);
  });
}

/** Latest view timestamp for cohort loading. */
export async function loadLastProfileViewAt(
  prisma: PrismaClient,
  characterId: string,
): Promise<Date | null> {
  const row = await prisma.characterProfileView.findFirst({
    where: { characterId },
    orderBy: { viewedAt: "desc" },
    select: { viewedAt: true },
  });
  return row?.viewedAt ?? null;
}

/** Test helper — clear in-memory rate limit. */
export function resetProfileViewMemoryRateLimit(): void {
  lastWriteAttemptMs.clear();
}
