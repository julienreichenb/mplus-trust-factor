import { describe, expect, it } from "vitest";
import {
  decideScoreRefresh,
  isScoreWithinTtl,
  isWithinFailureBackoff,
  preferRecalculateOnly,
  toAccountTrustStatus,
  DEFAULT_MYTHIC_RATING_STALE_DELTA,
  DEFAULT_SCORE_TTL_SECONDS,
} from "./score-refresh-decision.js";

const now = Date.parse("2026-07-30T12:00:00.000Z");
const freshAt = new Date(now - 60_000);
const exactTtlAt = new Date(now - DEFAULT_SCORE_TTL_SECONDS * 1000);
const staleAt = new Date(now - (DEFAULT_SCORE_TTL_SECONDS + 1) * 1000);

const base = {
  scoreTtlSeconds: DEFAULT_SCORE_TTL_SECONDS,
  failureBackoffSeconds: 3_600,
  activeJobStatus: null as "QUEUED" | "ACTIVE" | null,
  latestJobStatus: "COMPLETED" as string | null,
  latestJobFinishedAt: freshAt,
  contractReasons: [] as string[],
  mythicRatingDelta: 0,
  nowMs: now,
};

describe("decideScoreRefresh", () => {
  it("ten fresh reads stay NONE", () => {
    for (let i = 0; i < 10; i++) {
      const d = decideScoreRefresh({
        ...base,
        hasPublishedScore: true,
        scoreCalculatedAt: freshAt,
      });
      expect(d.action).toBe("NONE");
      expect(d.publicState).toBe("FRESH");
      expect(d.reason).toBe("WITHIN_SCORE_TTL");
      expect(d.profileRefreshStatus).toBe("FRESH");
    }
  });

  it("treats the exact seven-day boundary as stale", () => {
    expect(isScoreWithinTtl(exactTtlAt, DEFAULT_SCORE_TTL_SECONDS, now)).toBe(false);
    const d = decideScoreRefresh({
      ...base,
      hasPublishedScore: true,
      scoreCalculatedAt: exactTtlAt,
    });
    expect(d.action).toBe("ENQUEUE");
    expect(d.reason).toBe("SCORE_TTL_EXPIRED");
    expect(d.profileRefreshStatus).toBe("STALE");
  });

  it("stale score enqueues a full refresh", () => {
    const d = decideScoreRefresh({
      ...base,
      hasPublishedScore: true,
      scoreCalculatedAt: staleAt,
    });
    expect(d.action).toBe("ENQUEUE");
    expect(d.publicState).toBe("STALE_USABLE");
    expect(d.reason).toBe("SCORE_TTL_EXPIRED");
    expect(d.profileRefreshStatus).toBe("STALE");
  });

  it("marks a fresh score stale when Blizzard Mythic+ rating gained 50", () => {
    const d = decideScoreRefresh({
      ...base,
      hasPublishedScore: true,
      scoreCalculatedAt: freshAt,
      mythicRatingDelta: DEFAULT_MYTHIC_RATING_STALE_DELTA,
    });
    expect(d.action).toBe("ENQUEUE");
    expect(d.publicState).toBe("STALE_USABLE");
    expect(d.reason).toBe("MYTHIC_RATING_INCREASED");
    expect(d.profileRefreshStatus).toBe("STALE");
  });

  it("does not mark a fresh score stale at +49.999 rating", () => {
    const d = decideScoreRefresh({
      ...base,
      hasPublishedScore: true,
      scoreCalculatedAt: freshAt,
      mythicRatingDelta: DEFAULT_MYTHIC_RATING_STALE_DELTA - 0.001,
    });
    expect(d.action).toBe("NONE");
    expect(d.publicState).toBe("FRESH");
  });

  it("ignores rating decreases and unavailable rating comparisons", () => {
    for (const mythicRatingDelta of [-200, null, undefined]) {
      const d = decideScoreRefresh({
        ...base,
        hasPublishedScore: true,
        scoreCalculatedAt: freshAt,
        mythicRatingDelta,
      });
      expect(d.action).toBe("NONE");
      expect(d.profileRefreshStatus).toBe("FRESH");
    }
  });

  it("concurrent stale reads reuse an active logical job", () => {
    const d = decideScoreRefresh({
      ...base,
      hasPublishedScore: true,
      scoreCalculatedAt: staleAt,
      activeJobStatus: "QUEUED",
    });
    expect(d.action).toBe("REUSE_ACTIVE_JOB");
    expect(d.publicState).toBe("REFRESHING");
    expect(d.profileRefreshStatus).toBe("REFRESHING");
  });

  it("failed refresh applies backoff only when the score is legitimately stale", () => {
    const stale = decideScoreRefresh({
      ...base,
      hasPublishedScore: true,
      scoreCalculatedAt: staleAt,
      latestJobStatus: "FAILED",
      latestJobFinishedAt: new Date(now - 60_000),
      latestJobErrorCode: "REFRESH_FAILED",
    });
    expect(stale.action).toBe("BACKOFF");
    expect(stale.publicState).toBe("FAILED_FALLBACK");
    expect(stale.profileRefreshStatus).toBe("STALE");
    expect(toAccountTrustStatus(stale)).toBe("STALE");

    const fresh = decideScoreRefresh({
      ...base,
      hasPublishedScore: true,
      scoreCalculatedAt: freshAt,
      latestJobStatus: "FAILED",
      latestJobFinishedAt: new Date(now - 60_000),
      latestJobErrorCode: "REFRESH_FAILED",
    });
    expect(fresh.action).toBe("NONE");
    expect(fresh.profileRefreshStatus).toBe("FRESH");
  });

  it("contract preflight failure does not stale an otherwise fresh score", () => {
    const d = decideScoreRefresh({
      ...base,
      hasPublishedScore: true,
      scoreCalculatedAt: freshAt,
      latestJobStatus: "FAILED",
      latestJobFinishedAt: new Date(now - 60_000),
      latestJobErrorCode: "REFRESH_CONTRACT_PREFLIGHT_MISMATCH",
    });
    expect(d.action).toBe("NONE");
    expect(d.profileRefreshStatus).toBe("FRESH");
    expect(d.warningCodes).not.toContain("STALE_CONTRACT");
    expect(
      isWithinFailureBackoff(
        "FAILED",
        new Date(now - 60_000),
        3_600,
        now,
        "REFRESH_CONTRACT_PREFLIGHT_MISMATCH",
      ),
    ).toBe(false);
  });

  it("model-only mismatch is diagnostic and does not recalculate a fresh score", () => {
    const d = decideScoreRefresh({
      ...base,
      hasPublishedScore: true,
      scoreCalculatedAt: freshAt,
      contractReasons: ["SCORING_MODEL_CHANGED"],
    });
    expect(d.action).toBe("NONE");
    expect(d.profileRefreshStatus).toBe("FRESH");
    expect(d.reason).toBe("WITHIN_SCORE_TTL");
    // Compatibility helper remains available for explicit admin/bulk flows only.
    expect(preferRecalculateOnly(["SCORING_MODEL_CHANGED"])).toBe(true);
  });

  it("adapter/catalog/season mismatches do not refresh an otherwise fresh score", () => {
    for (const reason of [
      "WCL_ADAPTER_CHANGED",
      "ABILITY_CATALOG_CHANGED",
      "ACTIVE_SEASON_CHANGED",
      "CONTRACT_MISSING",
    ]) {
      const d = decideScoreRefresh({
        ...base,
        hasPublishedScore: true,
        scoreCalculatedAt: freshAt,
        contractReasons: [reason],
      });
      expect(d.action).toBe("NONE");
      expect(d.profileRefreshStatus).toBe("FRESH");
    }
    expect(preferRecalculateOnly(["WCL_ADAPTER_CHANGED"])).toBe(false);
  });

  it("provider-newer-than-score remains diagnostic only", () => {
    const d = decideScoreRefresh({
      ...base,
      hasPublishedScore: true,
      scoreCalculatedAt: freshAt,
      providerNewerThanScore: true,
    });
    expect(d.action).toBe("NONE");
    expect(d.reason).toBe("PROVIDER_NEWER_DIAGNOSTIC_ONLY");
    expect(d.warningCodes).toContain("SCORE_STALE_VS_PROVIDERS");
    expect(d.profileRefreshStatus).toBe("FRESH");
  });

  it("no published score + eligibility failure is FAILED", () => {
    const d = decideScoreRefresh({
      ...base,
      hasPublishedScore: false,
      scoreCalculatedAt: null,
      latestJobStatus: "FAILED",
      latestJobFinishedAt: new Date(now - 60_000),
      latestJobErrorCode: "CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN",
    });
    expect(d.action).toBe("NONE");
    expect(d.publicState).toBe("UNAVAILABLE");
    expect(d.reason).toBe("NOT_REFRESH_ELIGIBLE");
    expect(d.profileRefreshStatus).toBe("FAILED");
    expect(d.detailedRefreshStatus).toBe("FAILED");
  });

  it("no published score enqueues", () => {
    const d = decideScoreRefresh({
      ...base,
      hasPublishedScore: false,
      scoreCalculatedAt: null,
      latestJobStatus: null,
      latestJobFinishedAt: null,
    });
    expect(d.action).toBe("ENQUEUE");
    expect(d.publicState).toBe("NO_SCORE_QUEUED");
    expect(d.profileRefreshStatus).toBe("QUEUED");
  });

  it("maps REFRESHING to account trust status without hiding score", () => {
    const d = decideScoreRefresh({
      ...base,
      hasPublishedScore: true,
      scoreCalculatedAt: staleAt,
      activeJobStatus: "QUEUED",
    });
    expect(toAccountTrustStatus(d)).toBe("REFRESHING");
  });
});
