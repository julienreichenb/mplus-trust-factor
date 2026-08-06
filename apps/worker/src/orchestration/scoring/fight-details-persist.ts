/**
 * Durable fight-details page cache (EvidenceDatasetPage + RawArtifact).
 * Reused before WCL getReportFightDetails when report/fight/revision/scope match.
 */
import { createHash } from "node:crypto";
import {
  buildEvidenceDatasetScopeFingerprint,
  EVIDENCE_DATASET_UNSCOPED_FINGERPRINT,
} from "@mplus/contracts";
import {
  defaultWclRawPageRetentionUntil,
  type ArtifactRepository,
  type WclSourceRepository,
} from "@mplus/database";
import { WCL_RUN_EVIDENCE_PROVIDER_CONTRACT } from "@mplus/provider-warcraftlogs";

export const FIGHT_DETAILS_DATASET_KEY = "fight-details";
export const FIGHT_DETAILS_PAGE_SCHEMA = "wcl-fight-details-page-v1";

export interface PersistedFightDetailsEnvelope {
  schemaVersion: typeof FIGHT_DETAILS_PAGE_SCHEMA;
  providerContractVersion: string;
  reportCode: string;
  fightId: number;
  reportRevision: number;
  scopeFingerprint: string;
  data: unknown;
  fetchedAt: string;
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Fight-details payloads are actor-scoped via combatFacts.targetSourceId. */
export function scopeFingerprintForFightDetails(data: unknown): string {
  const payload = asRecord(data);
  const combatFacts = asRecord(payload?.combatFacts);
  const fight = asRecord(payload?.fight);
  const sourceActorId =
    typeof combatFacts?.targetSourceId === "number"
      ? combatFacts.targetSourceId
      : typeof fight?.targetActorId === "number"
        ? fight.targetActorId
        : null;
  if (sourceActorId == null) return EVIDENCE_DATASET_UNSCOPED_FINGERPRINT;
  return buildEvidenceDatasetScopeFingerprint({
    datasetKey: FIGHT_DETAILS_DATASET_KEY,
    sourceActorId,
    filterExpression: null,
    hostilityType: null,
    includeResources: false,
    startTime: null,
    endTime: null,
    providerContractVersion: WCL_RUN_EVIDENCE_PROVIDER_CONTRACT,
  });
}

export async function loadPersistedFightDetails(input: {
  wclSource: WclSourceRepository;
  artifacts: ArtifactRepository;
  reportCode: string;
  fightId: number;
  reportRevision: number;
  /** When known, only load pages for this actor scope. */
  targetActorId?: number | null;
}): Promise<{ data: unknown; reportRevision: number } | null> {
  const scopeFingerprint =
    input.targetActorId != null
      ? buildEvidenceDatasetScopeFingerprint({
          datasetKey: FIGHT_DETAILS_DATASET_KEY,
          sourceActorId: input.targetActorId,
          filterExpression: null,
          hostilityType: null,
          includeResources: false,
          startTime: null,
          endTime: null,
          providerContractVersion: WCL_RUN_EVIDENCE_PROVIDER_CONTRACT,
        })
      : undefined;
  const pages = await input.wclSource.findEvidenceDatasetPages({
    reportCode: input.reportCode,
    fightId: input.fightId,
    reportRevision: input.reportRevision,
    datasetKey: FIGHT_DETAILS_DATASET_KEY,
    scopeFingerprint,
  });
  if (pages.length === 0) return null;
  // Prefer exact scope match; otherwise validate envelope scope against requested actor.
  for (const page of pages) {
    try {
      const bytes = await input.artifacts.readVerified(page.artifactId);
      const envelope = JSON.parse(bytes.toString("utf8")) as PersistedFightDetailsEnvelope;
      if (envelope.schemaVersion !== FIGHT_DETAILS_PAGE_SCHEMA) continue;
      if (envelope.reportCode !== input.reportCode || envelope.fightId !== input.fightId) {
        continue;
      }
      if (envelope.reportRevision !== input.reportRevision) continue;
      if (envelope.data == null) continue;
      const envelopeScope =
        envelope.scopeFingerprint ?? scopeFingerprintForFightDetails(envelope.data);
      if (scopeFingerprint != null && envelopeScope !== scopeFingerprint) continue;
      return { data: envelope.data, reportRevision: envelope.reportRevision };
    } catch {
      continue;
    }
  }
  return null;
}

/** Resolve a known revision for report+fight from digests or fight-details pages. */
export async function findLatestFightRevision(input: {
  wclSource: WclSourceRepository;
  reportCode: string;
  fightId: number;
}): Promise<number | null> {
  const fromDigest = await input.wclSource.findLatestDigestRevision(
    input.reportCode,
    input.fightId,
  );
  if (fromDigest != null) return fromDigest;
  return input.wclSource.findLatestDatasetPageRevision(
    input.reportCode,
    input.fightId,
    FIGHT_DETAILS_DATASET_KEY,
  );
}

export async function persistFightDetailsPage(input: {
  wclSource: WclSourceRepository;
  artifacts: ArtifactRepository;
  reportCode: string;
  fightId: number;
  reportRevision: number;
  data: unknown;
}): Promise<{ bytes: number }> {
  const scopeFingerprint = scopeFingerprintForFightDetails(input.data);
  const envelope: PersistedFightDetailsEnvelope = {
    schemaVersion: FIGHT_DETAILS_PAGE_SCHEMA,
    providerContractVersion: WCL_RUN_EVIDENCE_PROVIDER_CONTRACT,
    reportCode: input.reportCode,
    fightId: input.fightId,
    reportRevision: input.reportRevision,
    scopeFingerprint,
    data: input.data,
    fetchedAt: new Date().toISOString(),
  };
  const uncompressed = Buffer.from(JSON.stringify(envelope), "utf8");
  const contentHash = sha256Hex(uncompressed);
  const retentionUntil = defaultWclRawPageRetentionUntil();
  const { artifactId } = await input.artifacts.persist({
    provider: "WARCRAFT_LOGS",
    bytes: uncompressed,
    compression: "GZIP",
    artifactClass: "wcl_fight_details_page",
    retentionUntil,
  });
  await input.wclSource.createEvidenceDatasetPage({
    reportCode: input.reportCode,
    fightId: input.fightId,
    reportRevision: input.reportRevision,
    datasetKey: FIGHT_DETAILS_DATASET_KEY,
    pageIndex: 0,
    pageCursor: null,
    artifactId,
    contentHash,
    providerContractVersion: WCL_RUN_EVIDENCE_PROVIDER_CONTRACT,
    schemaVersion: FIGHT_DETAILS_PAGE_SCHEMA,
    scopeFingerprint,
    eventCount: 0,
  });
  return { bytes: uncompressed.byteLength };
}
