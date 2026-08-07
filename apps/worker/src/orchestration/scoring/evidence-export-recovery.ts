/**
 * N1 — Periodic sweeper for stale Scoring V2 evidence-export leases.
 * Reclaims abandoned RUNNING rows to RETRYABLE without waiting for the next export job.
 */
import type { PrismaClient } from "@mplus/database";
import type { Logger } from "@mplus/observability";
import {
  EVIDENCE_EXPORT_RECLAIM_DEFAULT_LIMIT,
  reclaimStaleEvidenceExports,
} from "../scoring-evidence-export.js";

export const EVIDENCE_EXPORT_RECOVERY_DEFAULT_INTERVAL_MS = 60_000;

export type EvidenceExportRecoverySweeperHandle = {
  started: boolean;
  stop(): void;
};

export type StartEvidenceExportRecoverySweeperInput = {
  prisma: Pick<PrismaClient, "scoringEvidenceExport">;
  logger: Logger;
  intervalMs?: number;
  batchSize?: number;
  /** Injectable timers for unit tests. */
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  now?: () => Date;
};

/**
 * Start the evidence-export recovery sweeper.
 * Runs one reclaim immediately, then schedules recursive setTimeout ticks.
 */
export function startEvidenceExportRecoverySweeper(
  input: StartEvidenceExportRecoverySweeperInput,
): EvidenceExportRecoverySweeperHandle {
  const intervalMs = Math.max(1_000, input.intervalMs ?? EVIDENCE_EXPORT_RECOVERY_DEFAULT_INTERVAL_MS);
  const batchSize = Math.max(1, Math.floor(input.batchSize ?? EVIDENCE_EXPORT_RECLAIM_DEFAULT_LIMIT));
  const setTimeoutFn = input.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = input.clearTimeoutFn ?? clearTimeout;
  const nowFn = input.now ?? (() => new Date());

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;

  const runReclaim = async (): Promise<number> => {
    const result = await reclaimStaleEvidenceExports(input.prisma, nowFn(), { limit: batchSize });
    input.logger.info(
      {
        event: "scoring.evidence_export_reclaim",
        reclaimed: result.reclaimed,
        batchSize,
      },
      result.reclaimed > 0
        ? "evidence export recovery sweeper reclaimed stale leases"
        : "evidence export recovery sweeper found no stale leases",
    );
    return result.reclaimed;
  };

  const scheduleNext = (): void => {
    if (stopped) return;
    timer = setTimeoutFn(() => {
      void (async () => {
        if (stopped) return;
        if (inFlight) {
          scheduleNext();
          return;
        }
        inFlight = (async () => {
          try {
            await runReclaim();
          } catch (err) {
            input.logger.warn(
              { err, event: "scoring.evidence_export_reclaim_failed" },
              "evidence export recovery sweeper tick failed",
            );
          } finally {
            inFlight = null;
          }
        })();
        await inFlight;
        scheduleNext();
      })();
    }, intervalMs);
    if (typeof (timer as { unref?: () => void }).unref === "function") {
      (timer as { unref: () => void }).unref();
    }
  };

  // On start: reclaim once, then schedule periodic ticks.
  inFlight = (async () => {
    try {
      await runReclaim();
    } catch (err) {
      input.logger.warn(
        { err, event: "scoring.evidence_export_reclaim_failed" },
        "evidence export recovery sweeper initial reclaim failed",
      );
    } finally {
      inFlight = null;
      scheduleNext();
    }
  })();

  return {
    started: true,
    stop() {
      if (stopped) return;
      stopped = true;
      if (timer != null) {
        clearTimeoutFn(timer);
        timer = null;
      }
    },
  };
}
