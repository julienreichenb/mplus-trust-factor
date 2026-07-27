import type { AddonCompactRecord } from "./types.js";

export function escapeLuaString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

export function renderCompactRecord(record: AddonCompactRecord): string {
  const parts = [
    String(record.score),
    String(record.gradeCode),
    String(record.confidenceBucket),
    String(record.redFlags),
    String(record.freshnessDays),
  ];
  if (record.profileKey) {
    parts.push(`"${escapeLuaString(record.profileKey)}"`);
  }
  return `{ ${parts.join(", ")} }`;
}

export function renderShardTable(
  shardPath: string,
  entries: Map<string, AddonCompactRecord>,
): string {
  const lines = [
    "MPT_SHARDS = MPT_SHARDS or {}",
    `local shardKey = "${escapeLuaString(shardPath)}"`,
    "local t = MPT_SHARDS[shardKey] or {}",
    "MPT_SHARDS[shardKey] = t",
  ];
  const sortedKeys = [...entries.keys()].sort();
  for (const key of sortedKeys) {
    const record = entries.get(key);
    if (!record) continue;
    lines.push(`t["${escapeLuaString(key)}"] = ${renderCompactRecord(record)}`);
  }
  lines.push("return t");
  return `${lines.join("\n")}\n`;
}

export function renderMetaTable(meta: Record<string, string | number>): string {
  const lines = ["MPT_EXPORT_META = {"];
  for (const [key, value] of Object.entries(meta)) {
    if (typeof value === "number") {
      lines.push(`  ${key} = ${value},`);
    } else {
      lines.push(`  ${key} = "${escapeLuaString(String(value))}",`);
    }
  }
  lines.push("}");
  lines.push("return MPT_EXPORT_META");
  return `${lines.join("\n")}\n`;
}

export function renderTestVectors(
  vectors: Array<{ key: string; record: AddonCompactRecord }>,
): string {
  const lines = ["MPT_TEST_VECTORS = {"];
  for (const vector of vectors) {
    lines.push(`  ["${escapeLuaString(vector.key)}"] = ${renderCompactRecord(vector.record)},`);
  }
  lines.push("}");
  lines.push("return MPT_TEST_VECTORS");
  return `${lines.join("\n")}\n`;
}
