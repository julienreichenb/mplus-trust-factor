import { liveQueryArgs } from "./simc-identity.js";

export const SIMC_EXTRACTOR_VERSION = "simc-spellquery-extract-0.4.0";

/** Inventory scopes — not the full SpellQuery filter expression. */
export const SIMC_SPELLQUERY_SCOPES = [
  "class_spell",
  "spec_spell",
  "race_spell",
  "talent_spell",
] as const;

export type SimcSpellQueryScope = (typeof SIMC_SPELLQUERY_SCOPES)[number];

/** SpellQuery cooldown fields are milliseconds; 1000ms matches resolveSpellCooldownSeconds() sub-second cutoff. */
export const SIMC_SPELLQUERY_MIN_COOLDOWN_MS = 1000;

export function simcSpellQueryExpression(scope: SimcSpellQueryScope): string {
  return `${scope}.cooldown>=${SIMC_SPELLQUERY_MIN_COOLDOWN_MS}|${scope}.charge_cooldown>=${SIMC_SPELLQUERY_MIN_COOLDOWN_MS}`;
}

export const SIMC_SPELLQUERY_EXPRESSIONS: readonly string[] = SIMC_SPELLQUERY_SCOPES.map(
  (scope) => simcSpellQueryExpression(scope),
);

export type SimcSpellQueryExpression = (typeof SIMC_SPELLQUERY_EXPRESSIONS)[number];

export function simcArgsForQuery(
  scopeOrExpression: SimcSpellQueryScope | SimcSpellQueryExpression,
  xmlOutPath: string,
): string[] {
  const expression = SIMC_SPELLQUERY_SCOPES.includes(scopeOrExpression as SimcSpellQueryScope)
    ? simcSpellQueryExpression(scopeOrExpression as SimcSpellQueryScope)
    : scopeOrExpression;
  return liveQueryArgs([`spell_query=${expression}`, `spell_query_xml_output_file=${xmlOutPath}`]);
}
