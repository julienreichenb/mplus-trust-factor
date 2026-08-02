import { describe, expect, it } from "vitest";
import {
  SECRET_REDACT_PATHS,
  sanitizeSensitiveDeep,
  toJsonSafeSanitized,
  fingerprintIdentifier,
  maskReportCode,
  OBS_EVENTS,
} from "./index.js";

describe("observability deep sanitization", () => {
  it("redacts nested OAuth tokens and Authorization headers", () => {
    const sanitized = sanitizeSensitiveDeep({
      nested: {
        access_token: "tok-secret",
        client_secret: "client-secret",
        Authorization: "Bearer abc.def",
      },
      message: "Bearer leaked.token.value",
    }) as {
      nested: Record<string, string>;
      message: string;
    };
    expect(sanitized.nested.access_token).toBe("[Redacted]");
    expect(sanitized.nested.client_secret).toBe("[Redacted]");
    expect(sanitized.nested.Authorization).toBe("[Redacted]");
    expect(sanitized.message).toContain("[Redacted]");
    expect(sanitized.message).not.toContain("leaked.token");
  });

  it("fingerprints report codes instead of logging raw values", () => {
    const code = "AbCdEfGhIjKlMn";
    const sanitized = sanitizeSensitiveDeep({
      context: { reportCode: code, fightId: 3 },
    }) as { context: { reportCode: string; reportCodeFingerprint: string; fightId: number } };
    expect(sanitized.context.reportCode).toBe(maskReportCode(code));
    expect(sanitized.context.reportCodeFingerprint).toBe(fingerprintIdentifier(code));
    expect(sanitized.context.fightId).toBe(3);
    expect(JSON.stringify(sanitized)).not.toContain(code);
  });

  it("serializes BigInt safely and redacts secrets", () => {
    const safe = toJsonSafeSanitized({
      blizzardCharacterId: 1234567890123456789n,
      access_token: "nope",
      reportCode: "SecretReport99",
    }) as Record<string, unknown>;
    expect(safe.blizzardCharacterId).toBe("1234567890123456789");
    expect(safe.access_token).toBe("[Redacted]");
    expect(JSON.stringify(safe)).not.toContain("SecretReport99");
  });

  it("includes reportCode and connection string paths in Pino redaction list", () => {
    expect(SECRET_REDACT_PATHS).toContain("*.reportCode");
    expect(SECRET_REDACT_PATHS).toContain("*.DATABASE_URL");
    expect(SECRET_REDACT_PATHS).toContain("*.REDIS_URL");
  });

  it("exports stable refresh lifecycle event names", () => {
    expect(OBS_EVENTS.refreshWorkerStarted).toBe("refresh.worker.started");
    expect(OBS_EVENTS.refreshFusionCompleted).toBe("refresh.fusion.completed");
    expect(OBS_EVENTS.refreshTerminal).toBe("refresh.terminal");
  });

  it("exports scoring_v2 lifecycle event names", () => {
    expect(OBS_EVENTS.scoringV2ManifestFrozen).toBe("scoring_v2.manifest_frozen");
    expect(OBS_EVENTS.scoringV2AdmissionStopped).toBe("scoring_v2.admission_stopped");
    expect(OBS_EVENTS.scoringV2PublicationRejected).toBe("scoring_v2.publication_rejected");
  });

  it("redacts character names", () => {
    const sanitized = sanitizeSensitiveDeep({
      characterName: "Wallidrixe",
      realmSlug: "archimonde",
      name: "Wallidrixe",
      region: "eu",
    }) as Record<string, string>;
    expect(sanitized.characterName).toBe("[Redacted]");
    expect(sanitized.name).toBe("[Redacted]");
    expect(JSON.stringify(sanitized)).not.toContain("Wallidrixe");
  });
});
