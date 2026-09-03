import type {
  RunCooldownCombatSegmentPublicDTO,
  RunCooldownEventPublicDTO,
  RunCooldownTimelinePublicDTO,
  RunDeathTimelineEventPublicDTO,
  RunTimelineEventPublicDTO,
} from "@mplus/contracts";

export type CooldownTimelineDimension = "PERFORMANCE" | "UTILITY" | "SURVIVAL" | "DEATH";
export type CooldownTimelineEvent = RunTimelineEventPublicDTO;
export type CooldownTimeline = RunCooldownTimelinePublicDTO;

export const COOLDOWN_TIMELINE_UNAVAILABLE_COPY = "Cooldown replay unavailable for this run.";
export const COOLDOWN_TIMELINE_EMPTY_COPY = "No tracked cooldown usage for this run.";

export function isDeathTimelineEvent(
  event: RunTimelineEventPublicDTO,
): event is RunDeathTimelineEventPublicDTO {
  return event.kind === "DEATH";
}

export function isCooldownTimelineEvent(
  event: RunTimelineEventPublicDTO,
): event is RunCooldownEventPublicDTO {
  return event.kind !== "DEATH";
}

export type CooldownTimelineBlock =
  | { kind: "between"; gapMs: number | null; events: RunTimelineEventPublicDTO[] }
  | { kind: "pull"; segment: RunCooldownCombatSegmentPublicDTO; events: RunTimelineEventPublicDTO[] };

function compareTimelineEvents(a: RunTimelineEventPublicDTO, b: RunTimelineEventPublicDTO): number {
  if (a.timestampMs !== b.timestampMs) return a.timestampMs - b.timestampMs;
  const aKind = isDeathTimelineEvent(a) ? 1 : 0;
  const bKind = isDeathTimelineEvent(b) ? 1 : 0;
  if (aKind !== bKind) return aKind - bKind;
  if (isDeathTimelineEvent(a) && isDeathTimelineEvent(b)) {
    return a.playerName.localeCompare(b.playerName);
  }
  if (isCooldownTimelineEvent(a) && isCooldownTimelineEvent(b)) {
    return a.dimension.localeCompare(b.dimension) || (a.abilityId ?? 0) - (b.abilityId ?? 0);
  }
  return 0;
}

export function groupCooldownTimelineBlocks(
  events: RunTimelineEventPublicDTO[],
  segments: RunCooldownCombatSegmentPublicDTO[] | null | undefined,
): CooldownTimelineBlock[] {
  const orderedEvents = [...events].sort(compareTimelineEvents);
  const orderedSegments = [...(segments ?? [])].sort((a, b) => a.index - b.index || a.startMs - b.startMs);
  if (orderedSegments.length === 0) {
    return orderedEvents.length > 0
      ? [{ kind: "between", gapMs: null, events: orderedEvents }]
      : [];
  }

  const consumed = new Set<RunTimelineEventPublicDTO>();
  const blocks: CooldownTimelineBlock[] = [];
  for (let i = 0; i < orderedSegments.length; i += 1) {
    const segment = orderedSegments[i]!;
    const previous = orderedSegments[i - 1];
    const before = orderedEvents.filter(
      (event) =>
        !consumed.has(event) &&
        event.segmentIndex == null &&
        event.timestampMs < segment.startMs,
    );
    for (const event of before) consumed.add(event);
    if (before.length > 0) {
      blocks.push({
        kind: "between",
        gapMs: previous ? Math.max(0, segment.startMs - previous.endMs) : null,
        events: before,
      });
    }
    const inside = orderedEvents.filter((event) => !consumed.has(event) && event.segmentIndex === segment.index);
    for (const event of inside) consumed.add(event);
    if (inside.length > 0) {
      blocks.push({ kind: "pull", segment, events: inside });
    }
  }
  const rest = orderedEvents.filter((event) => !consumed.has(event));
  if (rest.length > 0) {
    blocks.push({ kind: "between", gapMs: null, events: rest });
  }
  return blocks;
}

export function uniqueBossJumpChips(
  segments: RunCooldownCombatSegmentPublicDTO[] | null | undefined,
): Array<{ name: string; segmentIndex: number }> {
  const chips: Array<{ name: string; segmentIndex: number }> = [];
  const seen = new Set<string>();
  for (const segment of [...(segments ?? [])].sort((a, b) => a.index - b.index || a.startMs - b.startMs)) {
    const name = segment.bossName?.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    chips.push({ name, segmentIndex: segment.index });
  }
  return chips;
}
