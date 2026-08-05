import {
  assertSurvivalActionTimelineV1,
  type SurvivalActionTimelineV1,
} from "@mplus/contracts";

export interface SurvivalProbeArtifactStore {
  persist(input: {
    provider: "WARCRAFT_LOGS";
    bytes: Uint8Array | Buffer;
    compression?: "NONE" | "GZIP" | "ZSTD";
    artifactClass: string;
  }): Promise<{ artifactId: string; write: { contentHash: string; storageUri: string } }>;
  readVerified(artifactId: string): Promise<Buffer>;
}

export async function persistSurvivalActionTimeline(input: {
  artifacts: SurvivalProbeArtifactStore;
  timeline: SurvivalActionTimelineV1;
}): Promise<{
  artifactId: string;
  contentHash: string;
  storageUri: string;
  providerCallsDuringPersist: number;
}> {
  const bytes = Buffer.from(JSON.stringify(input.timeline), "utf8");
  const write = await input.artifacts.persist({
    provider: "WARCRAFT_LOGS",
    bytes,
    compression: "GZIP",
    artifactClass: "survival_action_timeline_v1",
  });
  return {
    artifactId: write.artifactId,
    contentHash: write.write.contentHash,
    storageUri: write.write.storageUri,
    providerCallsDuringPersist: 0,
  };
}

export async function reloadSurvivalActionTimeline(input: {
  artifacts: SurvivalProbeArtifactStore;
  artifactId: string;
}): Promise<{
  timeline: SurvivalActionTimelineV1;
  providerCallsDuringReload: number;
}> {
  const bytes = await input.artifacts.readVerified(input.artifactId);
  const parsed = assertSurvivalActionTimelineV1(JSON.parse(bytes.toString("utf8")));
  return {
    timeline: parsed,
    providerCallsDuringReload: 0,
  };
}
