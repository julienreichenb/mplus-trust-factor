import { liveQueryArgs } from "./simc-identity.js";

export const SIMC_EXTRACTOR_VERSION = "simc-spellquery-extract-0.2.0";

export const SIMC_SPELLQUERY_EXPRESSIONS = [
  "class_spell",
  "spec_spell",
  "race_spell",
] as const;

export type SimcSpellQueryExpression = (typeof SIMC_SPELLQUERY_EXPRESSIONS)[number];

export function simcArgsForQuery(expression: SimcSpellQueryExpression, xmlOutPath: string): string[] {
  return liveQueryArgs([`spell_query=${expression}`, `spell_query_xml_output_file=${xmlOutPath}`]);
}
