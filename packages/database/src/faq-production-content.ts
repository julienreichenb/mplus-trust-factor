/**
 * Production FAQ copy for the initial public catalog.
 * Seeded by `pnpm seed:faq` (insert-missing only). Admin owns content after insert.
 */

export interface ProductionFaqSeedEntry {
  id: string;
  position: number;
  title: string;
  description: string;
  isPublished: true;
  embedType:
    | "META_TIER_TABLE"
    | "KEY_PERCENTILE_TABLE"
    | "SCORE_FLOW"
    | "SCORING_DIMENSIONS"
    | "TRUST_GRADE_LADDER"
    | null;
}

/** Deterministic UUIDs — version nibble 4, RFC variant. */
export function productionFaqId(ordinal: number): string {
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 15) {
    throw new Error(`FAQ ordinal must be 1–15, got ${ordinal}`);
  }
  return `aaaaaaaa-0000-4000-8000-${String(ordinal).padStart(12, "0")}`;
}

export const PRODUCTION_FAQ_ENTRIES: readonly ProductionFaqSeedEntry[] = [
  {
    id: productionFaqId(1),
    position: 10,
    title: "What is M+ Trust Factor and who is it for?",
    description:
      "M+ Trust Factor is an explainable Mythic+ evaluation of a character: a Trust Score plus the evidence behind it. It is meant mainly for players screening teammates, applicants, or pug groups before a key.\n\nIt is a complementary signal, not a verdict. It cannot guarantee how someone will play tonight, and it should be read together with the underlying runs, confidence, and freshness shown on the profile.",
    isPublished: true,
    embedType: null,
  },
  {
    id: productionFaqId(2),
    position: 20,
    title: "How is the Trust Score calculated?",
    description:
      "The current model builds a Raw Trust Score from public skill dimensions — Performance, Survival, Utility, and Experience — using evidence from the character’s season activity and available combat data. Those dimensions are weighted together; Raid is not part of the public skill mix on the current model.\n\nA Key Difficulty factor and a Meta factor are then applied to that Raw score to produce the Final Trust Score you see as the official contextual result. Scores are versioned: each published result records which scoring model produced it.",
    isPublished: true,
    embedType: "SCORE_FLOW",
  },
  {
    id: productionFaqId(3),
    position: 30,
    title: "What do Performance, Survival, Utility and Experience measure?",
    description:
      "Performance looks at how the character contributes in timed keys, using Warcraft Logs parses (peak and consistency) plus how reliably offensive cooldowns are used when combat logs exist. It is currently damage-oriented for every role.\n\nSurvival looks at combat outcomes and responses: deaths, defensive usage, and recovery when those events are visible in logs. Utility measures observed use of the class toolkit (interrupts, crowd control, dispels, externals, and similar contribution) from combat evidence — not a checklist of talents alone.\n\nExperience measures exposure and history (dungeon coverage, key-band breadth, participation, past seasons, recency). It is not treated as a skill parse. These four are the only public skill dimensions on the current model.",
    isPublished: true,
    embedType: "SCORING_DIMENSIONS",
  },
  {
    id: productionFaqId(4),
    position: 40,
    title: "What is the difference between the Raw Trust Score and the Final Trust Score?",
    description:
      "Raw Trust Score is the multi-dimensional evaluation of the player before Key Difficulty and Meta adjustments. Final Trust Score is Raw multiplied by those two contextual factors (then capped at 100 if needed).\n\nBoth are shown so you can see the player evaluation and the season context separately. Final remains the official published contextual score used as the headline Trust Score.",
    isPublished: true,
    embedType: null,
  },
  {
    id: productionFaqId(5),
    position: 50,
    title: "What is the Key Difficulty factor and how is it calculated?",
    description:
      "Key Difficulty is applied after Raw score. It uses the character’s canonical dungeon representatives — typically one selected run per current-season dungeon (usually eight). The median key level of that set is compared to the player’s own region’s season distribution of median keys, then placed on a percentile step band (for example around P60, P75, P90, and higher).\n\nThat distribution is a population of median key levels, not a conversion of Raider.IO rating into a percentile. If the representative set is incomplete or the regional distribution is missing, the factor stays neutral (×1.00) and the profile says the context is unavailable — it is not filled in with a fake band.",
    isPublished: true,
    embedType: "KEY_PERCENTILE_TABLE",
  },
  {
    id: productionFaqId(6),
    position: 60,
    title: "What is the Meta factor, and are off-meta players penalized?",
    description:
      "The Meta factor is a season-scoped adjustment for the character’s specialization. Specs are assigned to a meta tier for that season; each tier has a configured multiplier. Combined with Key Difficulty, it can raise or lower Final relative to Raw. It describes how demanding or padded the spec’s environment is, not whether the player is skilled.\n\nIf the spec is unknown or no tier is configured, the factor is neutral (×1.00). Raw stays visible so you can judge the player without that context. Playing an off-meta spec is not treated as a skill verdict; any Final movement comes only from the published season meta configuration.",
    isPublished: true,
    embedType: "META_TIER_TABLE",
  },
  {
    id: productionFaqId(7),
    position: 70,
    title: "Where does M+ Trust Factor get its data?",
    description:
      "Blizzard supplies character identity, specialization, equipment, and related profile data. Raider.IO supplies public Mythic+ run history, seasonal context, and the regional median-key distribution used for Key Difficulty. Warcraft Logs supplies combat evidence (parses and fight details) when logs are public and can be matched to runs.\n\nEach source feeds different parts of the profile. None of them is used for every component. Only public or otherwise available data can be used; private logs and incomplete provider responses are constraints, not something the site invents around.",
    isPublished: true,
    embedType: null,
  },
  {
    id: productionFaqId(8),
    position: 80,
    title: "Which Mythic+ runs are used to evaluate a character?",
    description:
      "For Key Difficulty, the site uses canonical dungeon representatives: one selected run per current-season dungeon (highest key, then score, then most recent, with a preference for Warcraft Logs-backed runs when a higher unlogged key would otherwise win). That set’s median key is the Key context input.\n\nPerformance, Survival, and Utility combat scoring use a richer Warcraft Logs evidence set when fights can be acquired — aiming for more than one detailed public log per dungeon when they exist, not a fabricated second run. Those combat samples are not the same list as the eight key representatives. Experience uses broader seasonal and historical activity, not only those representatives.",
    isPublished: true,
    embedType: null,
  },
  {
    id: productionFaqId(9),
    position: 90,
    title: "What happens if Warcraft Logs or other data is missing?",
    description:
      "If logs are private, unmatched, or otherwise unavailable, combat-heavy dimensions (Performance, Survival, Utility) cannot invent fights. They may show as unavailable or partial, with confidence reduced. Missing evidence in one dimension does not automatically invent a penalty in another.\n\nExperience can still score from public activity when those sources exist. Incomplete Key representatives do not invent a Key percentile. A missing piece of data does not always lower the number — sometimes the dimension is omitted, the grade is withheld (U), or the score is shown with a clear low-confidence warning.",
    isPublished: true,
    embedType: null,
  },
  {
    id: productionFaqId(10),
    position: 100,
    title: "What do confidence, completeness and data freshness mean?",
    description:
      "Confidence describes how strong the evidence behind a dimension or overall score is. Completeness reflects whether expected combat or seasonal coverage is actually present. Freshness is when sources were last fetched and whether the profile is stale pending a refresh.\n\nA similar numeric score with thin, old, or incomplete evidence should not be read the same way as one backed by recent, well-covered logs and activity. The character page surfaces low confidence, source timestamps, and provider status for that reason.",
    isPublished: true,
    embedType: null,
  },
  {
    id: productionFaqId(11),
    position: 110,
    title: "Why can a player's score change over time?",
    description:
      "Scores update when the character is refreshed: new or better-matched runs, changed Warcraft Logs coverage, or updated Blizzard and Raider.IO snapshots. Key Difficulty can move when the regional median-key distribution or the character’s dungeon representatives change. Meta can move when season spec tiers are republished.\n\nA new scoring model version or a different scoring season also changes results. Published scores keep model and season metadata so you can see what produced an older snapshot.",
    isPublished: true,
    embedType: null,
  },
  {
    id: productionFaqId(12),
    position: 120,
    title: "Are scores comparable across seasons and scoring model versions?",
    description:
      "Treat comparisons carefully. Each Trust Score is scoped to a scoring season and a scoring model version. A 70 in one season or model is not guaranteed to mean the same thing as a 70 in another.\n\nThe profile shows model key/version and season context. Use those labels; do not assume mathematical comparability across seasons or model revisions.",
    isPublished: true,
    embedType: null,
  },
  {
    id: productionFaqId(13),
    position: 130,
    title: "Can M+ Trust Factor detect boosted players?",
    description:
      "It can surface probabilistic suspicion when authenticity evidence looks inconsistent (for example a public “boost suspected” flag with supporting signals). That is not proof of intent, payment, or cheating, and it does not by itself change the numeric Trust Score on the current model.\n\nRead the flag together with the evidence, confidence, and combat details. Never treat it as a definitive label that someone is boosted.",
    isPublished: true,
    embedType: null,
  },
  {
    id: productionFaqId(14),
    position: 140,
    title: "Do I need to connect my Battle.net account?",
    description:
      "No. Anyone can look up a public character by name and realm without signing in. Connecting Battle.net verifies that you own characters, lists them on your Account page, and keeps ownership private.\n\nLinking does not change public Trust Scores. It is for convenience and ownership, not a scoring advantage.",
    isPublished: true,
    embedType: null,
  },
  {
    id: productionFaqId(15),
    position: 150,
    title: "Is M+ Trust Factor affiliated with Blizzard, Raider.IO, Warcraft Logs or Wowhead?",
    description:
      "No. M+ Trust Factor is an independent community project. It is not affiliated with, endorsed by, or sponsored by Blizzard Entertainment, Raider.IO, Warcraft Logs, or Wowhead.\n\nWorld of Warcraft and Blizzard Entertainment are trademarks of their respective owners. Other names belong to their owners.",
    isPublished: true,
    embedType: null,
  },
] as const;

export const PRODUCTION_FAQ_IDS: readonly string[] = PRODUCTION_FAQ_ENTRIES.map((entry) => entry.id);
