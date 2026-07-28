import type { AbilityCatalog } from "./types.js";

/** Bounded Warlock Demonology catalog for Wave 4 live validation (TWW/Midnight). */
export const WARLOCK_DEMONOLOGY_CATALOG: AbilityCatalog = {
  catalogVersion: "warlock-demonology-tww-1",
  rules: [
    // Interrupts — player Fel Domination + pet variants
    { spellId: 19647, classSlug: "warlock", categories: ["interrupt"], petRequirement: "felhunter", baseCooldownMs: 24_000 },
    { spellId: 89766, classSlug: "warlock", categories: ["interrupt"], petRequirement: "felguard", baseCooldownMs: 30_000 },
    { spellId: 119910, classSlug: "warlock", categories: ["interrupt"], petRequirement: "imp", baseCooldownMs: 24_000 },
    // Crowd control
    { spellId: 30283, classSlug: "warlock", specSlugs: ["demonology", "destruction", "affliction"], categories: ["crowd_control"], baseCooldownMs: 60_000 },
    { spellId: 6789, classSlug: "warlock", categories: ["crowd_control"], baseCooldownMs: 45_000 },
    { spellId: 5782, classSlug: "warlock", categories: ["crowd_control"], baseCooldownMs: 30_000 },
    { spellId: 710, classSlug: "warlock", categories: ["crowd_control"], baseCooldownMs: 30_000 },
    // Group support
    { spellId: 111771, classSlug: "warlock", categories: ["group_support"], baseCooldownMs: 10_000 },
    // Defensive dispel (pet)
    { spellId: 89808, classSlug: "warlock", categories: ["defensive_dispel"], petRequirement: "imp", baseCooldownMs: 15_000 },
    // Personal defensives
    { spellId: 108416, classSlug: "warlock", categories: ["personal_defensive"], baseCooldownMs: 60_000 },
    { spellId: 104773, classSlug: "warlock", categories: ["personal_defensive"], baseCooldownMs: 180_000 },
    // Self-heal
    { spellId: 234153, classSlug: "warlock", categories: ["self_heal"] },
    // Healthstone (generic item cast ids)
    { spellId: 6262, classSlug: "warlock", categories: ["health_potion"] },
    { spellId: 5512, classSlug: "warlock", categories: ["health_potion"] },
    // Healing potion (generic TWW ids)
    { spellId: 431416, classSlug: "warlock", categories: ["health_potion"] },
    { spellId: 431418, classSlug: "warlock", categories: ["health_potion"] },
  ],
};
