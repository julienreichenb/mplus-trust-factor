import type { ScoringMechanicCatalog } from "../scoring-mechanic-types.js";

/** Bounded Wave 4 scoring-mechanic seed — avoidability only via catalog. */
export const SEED_SCORING_MECHANIC_CATALOG: ScoringMechanicCatalog = {
  catalogVersion: "scoring-mechanic-catalog-v1-seed",
  seasonSlug: "season-midnight-s1",
  rules: [
    {
      id: "seed-avoidable-ground-generic",
      seasonSlug: "season-midnight-s1",
      dungeonSlug: "*",
      abilityId: 400001,
      avoidable: true,
      severity: "MEDIUM",
      categories: ["ground_effect"],
      notes: "Synthetic avoidable ground effect for fixture validation",
    },
    {
      id: "seed-mandatory-tankbuster-generic",
      seasonSlug: "season-midnight-s1",
      dungeonSlug: "*",
      abilityId: 400002,
      avoidable: false,
      severity: "HIGH",
      categories: ["tank_buster"],
      notes: "Synthetic mandatory damage — must never count as avoidable",
    },
    {
      id: "seed-aa-arcane-rain",
      seasonSlug: "season-midnight-s1",
      dungeonSlug: "algethar-academy",
      abilityId: 388537,
      avoidable: true,
      severity: "MEDIUM",
      categories: ["ground_effect"],
      notes: "Bounded live seed — Algeth'ar Arcane Rain style ground",
    },
    {
      id: "seed-skyreach-solar-flare",
      seasonSlug: "season-midnight-s1",
      dungeonSlug: "skyreach",
      abilityId: 154396,
      avoidable: true,
      severity: "HIGH",
      categories: ["ground_effect"],
      notes: "Bounded live seed — Skyreach Solar Flare",
    },
    {
      id: "seed-sot-void-consumption",
      seasonSlug: "season-midnight-s1",
      dungeonSlug: "seat-of-the-triumvirate",
      abilityId: 244751,
      avoidable: true,
      severity: "HIGH",
      categories: ["ground_effect"],
      notes: "Bounded live seed — Seat void ground",
    },
  ],
};
