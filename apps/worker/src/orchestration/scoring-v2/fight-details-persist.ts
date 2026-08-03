/**
 * Durable fight-details page cache (EvidenceDatasetPage + RawArtifact).
 * Reused before WCL getReportFightDetails when report/fight/revision match.
 */
import { createHash } from "node:crypto";
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
  data: unknown;
  fetchedAt: string;
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function loadPersistedFightDetails(input: {
  wclSource: WclSourceRepository;
  artifacts: ArtifactRepository;
  reportCode: string;
  fightId: number;
  reportRevision: number;
}): Promise<{ data: unknown; reportRevision: number } | null> {
  const pages = await input.wclSource.findEvidenceDatasetPages({
    reportCode: input.reportCode,
    fightId: input.fightId,
    reportRevision: input.reportRevision,
    datasetKey: FIGHT_DETAILS_DATASET_KEY,
  });
  if (pages.length === 0) return null;
  const page = pages[0]!;
  try {
    const bytes = await input.artifacts.readVerified(page.artifactId);
    const envelope = JSON.parse(bytes.toString("utf8")) as PersistedFightDetailsEnvelope;
    if (envelope.schemaVersion !== FIGHT_DETAILS_PAGE_SCHEMA) return null;
    if (envelope.reportCode !== input.reportCode || envelope.fightId !== input.fightId) {
      return null;
    }
    if (envelope.reportRevision !== input.reportRevision) return null;
    if (envelope.data == null) return null;
    return { data: envelope.data, reportRevision: envelope.reportRevision };
  } catch {
    return null;
  }
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
  const envelope: PersistedFightDetailsEnvelope = {
    schemaVersion: FIGHT_DETAILS_PAGE_SCHEMA,
    providerContractVersion: WCL_RUN_EVIDENCE_PROVIDER_CONTRACT,
    reportCode: input.reportCode,
    fightId: input.fightId,
    reportRevision: input.reportRevision,
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
    eventCount: 0,
  });
  return { bytes: uncompressed.byteLength };
}
