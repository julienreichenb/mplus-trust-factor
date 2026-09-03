import type { ExBossVoiceAlert } from "./exboss-voice-pack-manifest";

export type BulkSuggestionReason = "family" | "similar";

export interface BulkAlertCandidate {
  index: number;
  reasons: BulkSuggestionReason[];
  score: number;
}

const COLOR_STEMS = new Set([
  "black",
  "blue",
  "green",
  "purple",
  "red",
  "white",
  "yellow",
  "orange",
]);

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "to",
  "of",
  "and",
  "or",
  "for",
  "in",
  "on",
  "are",
  "is",
  "you",
  "your",
  "from",
  "with",
  "while",
]);

/** Filename family used for bulk-select suggestions. */
export function alertFamilyKey(filename: string): string {
  const stem = filename.replace(/\.ogg$/i, "").toLowerCase();
  const dash = stem.indexOf("-");
  const prefix = dash >= 0 ? stem.slice(0, dash) : stem;
  const rest = dash >= 0 ? stem.slice(dash + 1) : "";

  if (COLOR_STEMS.has(prefix) || COLOR_STEMS.has(rest) || COLOR_STEMS.has(stem)) {
    return "color";
  }
  if (/^\d+$/.test(stem) || prefix === "countdown" || stem === "54321") {
    return "countdown";
  }
  if (prefix === "sound") return "sound";
  if (prefix === "std") return "std";
  if (prefix === "prepare") return "prepare";
  if (prefix === "you") return "you";
  if (prefix === "empower") return "empower";
  if (prefix === "watch" || prefix === "dodge") return prefix;
  if (prefix === "target" || stem.includes("on-you") || stem.endsWith("-marked")) {
    return "marked";
  }
  return prefix || "other";
}

export function familyLabel(family: string): string {
  const labels: Record<string, string> = {
    prepare: "Prepare…",
    you: "You are…",
    color: "Colors",
    std: "Standard cues",
    countdown: "Countdown",
    empower: "Empower class",
    watch: "Watch…",
    dodge: "Dodge…",
    marked: "Marked / on you",
    sound: "UI sounds",
  };
  return labels[family] ?? family;
}

export function tokenizeCue(cue: string): string[] {
  return cue
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

/** Jaccard similarity over cue tokens, 0–1. */
export function scoreCueSimilarity(a: string, b: string): number {
  const left = new Set(tokenizeCue(a));
  const right = new Set(tokenizeCue(b));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) {
    if (right.has(token)) shared += 1;
  }
  return shared / (left.size + right.size - shared);
}

/**
 * Suggest bulk targets for a source alert: same filename family and/or similar English cue.
 * Source index is excluded. Results are sorted by score descending.
 */
export function suggestBulkTargets(
  alerts: readonly ExBossVoiceAlert[],
  sourceIndex: number,
  options: { similarThreshold?: number } = {},
): BulkAlertCandidate[] {
  const source = alerts[sourceIndex];
  if (!source) return [];
  const threshold = options.similarThreshold ?? 0.34;
  const sourceFamily = alertFamilyKey(source.filename);
  const out: BulkAlertCandidate[] = [];

  for (const alert of alerts) {
    if (alert.index === sourceIndex) continue;
    const reasons: BulkSuggestionReason[] = [];
    let score = 0;
    if (alertFamilyKey(alert.filename) === sourceFamily) {
      reasons.push("family");
      score += 1;
    }
    const similarity = scoreCueSimilarity(source.englishCue, alert.englishCue);
    if (similarity >= threshold) {
      reasons.push("similar");
      score += similarity;
    }
    if (reasons.length === 0) continue;
    out.push({ index: alert.index, reasons, score });
  }

  out.sort((a, b) => b.score - a.score || a.index - b.index);
  return out;
}

export function indexesInFamily(
  alerts: readonly ExBossVoiceAlert[],
  family: string,
  excludeIndex?: number,
): number[] {
  return alerts
    .filter(
      (alert) =>
        alert.index !== excludeIndex && alertFamilyKey(alert.filename) === family,
    )
    .map((alert) => alert.index);
}
