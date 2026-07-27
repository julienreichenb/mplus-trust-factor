import { createHash } from "node:crypto";
import type { AddonCompactRecord } from "./types.js";

export function computeDatasetChecksum(
  shards: Map<string, Map<string, AddonCompactRecord>>,
): string {
  const hasher = createHash("sha256");
  const shardPaths = [...shards.keys()].sort();
  for (const path of shardPaths) {
    const entries = shards.get(path);
    if (!entries) continue;
    hasher.update(path);
    hasher.update("\0");
    const keys = [...entries.keys()].sort();
    for (const key of keys) {
      const record = entries.get(key);
      if (!record) continue;
      hasher.update(key);
      hasher.update("\0");
      hasher.update(JSON.stringify(record));
      hasher.update("\0");
    }
  }
  return hasher.digest("hex");
}
