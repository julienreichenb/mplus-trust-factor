import { normalizeRetailClassSlug } from "../../catalog/classes-matrix.js";
import { normalizeRaceSlug } from "../../race.js";
import type { AbilitySpellBindingRole } from "../types.js";

export const SPELLQUERY_XML_PARSER_VERSION = "spellquery-xml-parser-0.2.0";

export interface ParsedSpellQuerySpell {
  spellId: number;
  name: string;
  classSlug: string | null;
  specSlugs: string[];
  raceSlugs: string[];
  cooldownSeconds: number | null;
  gcdSeconds: number | null;
  charges: number | null;
  chargeCooldownSeconds: number | null;
  durationSeconds: number | null;
  maxStack: number | null;
  initialStack: number | null;
  castMin: number | null;
  castMax: number | null;
  isPassive: boolean | null;
  description: string | null;
  triggerSpellIds: number[];
  effectTypes: string[];
  rawFlags: string[];
}

export class SpellQueryXmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpellQueryXmlError";
  }
}

const CLASS_TOKEN: Record<string, string> = {
  deathknight: "death-knight",
  demonhunter: "demon-hunter",
  death_knight: "death-knight",
  demon_hunter: "demon-hunter",
};

function inner(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i");
  const m = xml.match(re);
  return m?.[1]?.trim() ?? null;
}

function attr(tag: string, name: string): string | null {
  const re = new RegExp(`\\b${name}="([^"]*)"`, "i");
  const m = tag.match(re);
  return m?.[1] ?? null;
}

function num(value: string | null | undefined): number | null {
  if (value == null || value.trim() === "") return null;
  const cleaned = value.replace(/s$/i, "").trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function mapClass(raw: string | null): string | null {
  if (!raw) return null;
  const token = raw.trim().toLowerCase().replace(/\s+/g, "");
  const mapped = CLASS_TOKEN[token] ?? CLASS_TOKEN[raw.trim().toLowerCase().replace(/\s+/g, "_")] ?? raw;
  return normalizeRetailClassSlug(mapped.replace(/_/g, "-"));
}

function mapSpec(raw: string | null): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[,|]/)
    .map((s) => s.trim().toLowerCase().replace(/_/g, "-").replace(/\s+/g, "-"))
    .filter((s) => Boolean(s) && s !== "unknown");
}

function mapRace(raw: string | null): string[] {
  if (!raw?.trim()) return [];
  const slug = normalizeRaceSlug(raw.replace(/_/g, "-"));
  return slug ? [slug] : [];
}

function childTags(block: string, tag: string): string[] {
  return [...block.matchAll(new RegExp(`<${tag}\\b([^>]*)/?>`, "gi"))].map((m) => m[1] ?? "");
}

function parseSpellBlock(block: string): ParsedSpellQuerySpell | null {
  const open = block.match(/^<spell\b([^>]*)>/i)?.[1] ?? "";
  const id = num(attr(open, "id") ?? inner(block, "id"));
  if (id == null || id <= 0) return null;
  const name = attr(open, "name") ?? inner(block, "name") ?? `Spell ${id}`;

  const classChildren = childTags(block, "class")
    .map((t) => mapClass(attr(t, "id") ?? attr(t, "name")))
    .filter((s): s is string => Boolean(s));
  const specChildren = childTags(block, "spec").flatMap((t) => mapSpec(attr(t, "name") ?? attr(t, "id")));
  const raceChildren = childTags(block, "race").flatMap((t) =>
    mapRace(attr(t, "name") ?? inner(`<x>${t}</x>`, "x")),
  );

  const classRaw = attr(open, "class") ?? inner(block, "class") ?? inner(block, "class_name");
  const specRaw = attr(open, "spec") ?? inner(block, "spec") ?? inner(block, "specialization");
  const raceRaw = attr(open, "race") ?? inner(block, "race") ?? inner(block, "race_name");

  const raceSlugs = [...new Set([...raceChildren, ...mapRace(raceRaw)])].sort();
  const specSlugs = [...new Set([...specChildren, ...mapSpec(specRaw)])].sort();
  const classSlugs = [...new Set([...classChildren, ...(mapClass(classRaw) ? [mapClass(classRaw)!] : [])])];
  const classSlug = raceSlugs.length > 0 || classSlugs.length !== 1 ? null : classSlugs[0]!;

  const passiveAttr = attr(open, "passive");
  const passiveText = inner(block, "passive") ?? passiveAttr;
  const flags = [...block.matchAll(/<flag(?:\s[^>]*)?>([^<]*)<\/flag>/gi)].map((m) => m[1]!.toLowerCase());
  const isPassive =
    passiveAttr === "true" ||
    passiveAttr === "1" ||
    passiveText === "1" ||
    passiveText?.toLowerCase() === "true" ||
    flags.includes("passive") ||
    /<passive\s*\/>/i.test(block);

  const triggerSpellIds = [
    ...block.matchAll(/\btrigger_spell_id="(\d+)"/gi),
    ...block.matchAll(/<trigger_spell\b[^>]*\bid="(\d+)"/gi),
    ...[...block.matchAll(/<trigger_spell(?:\s[^>]*)?>(\d+)<\/trigger_spell>/gi)],
  ]
    .map((m) => Number(m[1]))
    .filter((n) => Number.isInteger(n) && n > 0);

  const effectTypes = [
    ...block.matchAll(/<effect\b[^>]*\btype_text="([^"]+)"/gi),
    ...block.matchAll(/<effect\b[^>]*\btype="([^"]+)"/gi),
  ].map((m) => m[1]!);

  const rawCooldownSeconds = num(attr(open, "cooldown") ?? inner(block, "cooldown"));
  const gcdSeconds = num(attr(open, "gcd") ?? inner(block, "gcd"));
  const chargeCooldownSeconds = num(
    attr(open, "charge_cooldown") ?? inner(block, "charge_cooldown"),
  );
  const charges = num(attr(open, "charges") ?? attr(open, "max_charges") ?? inner(block, "charges"));
  const castMin = num(
    attr(open, "cast_time") ??
      attr(open, "cast_time_else") ??
      inner(block, "cast_min") ??
      attr(open, "cast_min"),
  );
  const durationSeconds = num(attr(open, "duration") ?? inner(block, "duration"));

  return {
    spellId: id,
    name,
    classSlug,
    specSlugs,
    raceSlugs,
    cooldownSeconds: rawCooldownSeconds,
    gcdSeconds,
    charges,
    chargeCooldownSeconds,
    durationSeconds,
    maxStack: num(attr(open, "max_stack") ?? inner(block, "max_stack")),
    initialStack: num(attr(open, "initial_stack") ?? inner(block, "initial_stack")),
    castMin,
    castMax: num(inner(block, "cast_max") ?? attr(open, "cast_max")),
    isPassive,
    description: inner(block, "description") ?? inner(block, "tooltip"),
    triggerSpellIds: [...new Set(triggerSpellIds)].sort((a, b) => a - b),
    effectTypes,
    rawFlags: flags.sort(),
  };
}

/** Map SpellQuery timing fields to a curated cooldown when semantically trustworthy. */
export function resolveSpellCooldownSeconds(spell: ParsedSpellQuerySpell): number | null {
  if (
    spell.charges != null &&
    spell.charges > 0 &&
    spell.chargeCooldownSeconds != null &&
    spell.chargeCooldownSeconds >= 1
  ) {
    return spell.chargeCooldownSeconds;
  }

  const cooldown = spell.cooldownSeconds;
  if (cooldown == null || cooldown <= 0) return null;

  // Sub-second values are category/GCD timing in SpellQuery, not ability recharge.
  if (cooldown < 1) return null;

  if (spell.gcdSeconds != null && Math.abs(cooldown - spell.gcdSeconds) < 0.001) return null;
  if (spell.castMin != null && Math.abs(cooldown - spell.castMin) < 0.001) return null;
  if (spell.durationSeconds != null && Math.abs(cooldown - spell.durationSeconds) < 0.001) {
    return null;
  }

  return cooldown;
}

export function parseSpellQueryXml(xml: string): ParsedSpellQuerySpell[] {
  if (!xml.trim()) {
    throw new SpellQueryXmlError("SpellQuery XML is empty");
  }
  if (!/<spell\b/i.test(xml) && !/<spell_query[\s>]/i.test(xml)) {
    throw new SpellQueryXmlError("SpellQuery XML is missing spell_query/spell structure");
  }
  const blocks = xml.match(/<spell\b[\s\S]*?<\/spell>/gi) ?? [];
  if (blocks.length === 0 && /<spell\b/i.test(xml)) {
    throw new SpellQueryXmlError("SpellQuery XML has an unclosed or truncated <spell> element");
  }
  return blocks
    .map(parseSpellBlock)
    .filter((s): s is ParsedSpellQuerySpell => s != null)
    .sort((a, b) => a.spellId - b.spellId || a.name.localeCompare(b.name));
}

export function bindingsFromParsedSpell(spell: ParsedSpellQuerySpell): Array<{
  spellId: number;
  role: AbilitySpellBindingRole;
  evidence: string;
}> {
  const bindings: Array<{ spellId: number; role: AbilitySpellBindingRole; evidence: string }> = [];
  if (spell.isPassive !== true) {
    bindings.push({
      spellId: spell.spellId,
      role: "PRIMARY_ACTIVATION",
      evidence: "spellquery:top-level-id",
    });
  }
  for (const id of spell.triggerSpellIds) {
    bindings.push({
      spellId: id,
      role: "TRIGGERED_EFFECT",
      evidence: "spellquery:effect.trigger_spell",
    });
  }
  return bindings;
}
