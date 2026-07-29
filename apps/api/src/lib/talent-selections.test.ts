import { describe, expect, it } from "vitest";
import {
  extractSelectedTalents,
  heroTalentNameFromTalentsBlob,
  pickActiveLoadout,
} from "./talent-selections.js";

describe("talent-selections", () => {
  it("prefers the active loadout and maps class/spec/hero nodes", () => {
    const selected = extractSelectedTalents({
      activeSpecialization: { id: 63, name: "Fire" },
      specializations: [
        {
          specialization: { id: 63, name: "Fire" },
          loadouts: [
            {
              is_active: false,
              talent_loadout_code: "OLD",
              selected_class_talents: [],
            },
            {
              is_active: true,
              talent_loadout_code: "C8DAH",
              selected_class_talents: [
                {
                  id: 1,
                  rank: 1,
                  tooltip: {
                    talent: { id: 1, name: "Scorch" },
                    spell_tooltip: { spell: { id: 2948, name: "Scorch" } },
                  },
                },
              ],
              selected_spec_talents: [
                {
                  id: 2,
                  rank: 2,
                  tooltip: {
                    talent: { id: 2, name: "Pyroblast" },
                    spell_tooltip: { spell: { id: 11366, name: "Pyroblast" } },
                  },
                },
              ],
              selected_hero_talents: [
                {
                  id: 3,
                  rank: 1,
                  tooltip: {
                    talent: { id: 3, name: "Sunfury" },
                    spell_tooltip: { spell: { id: 99, name: "Sunfury" } },
                  },
                },
              ],
            },
          ],
        },
      ],
    });

    expect(selected).toHaveLength(3);
    expect(selected.map((t) => t.tree)).toEqual(["CLASS", "SPEC", "HERO"]);
    expect(selected[1]?.rank).toBe(2);
    expect(selected[0]?.spellId).toBe(2948);
  });

  it("pickActiveLoadout falls back to the first entry", () => {
    expect(pickActiveLoadout([{ talent_loadout_code: "A" }, { talent_loadout_code: "B" }])?.talent_loadout_code).toBe(
      "A",
    );
  });

  it("reads hero talent tree name from the active loadout", () => {
    expect(
      heroTalentNameFromTalentsBlob({
        activeSpecialization: { id: 71 },
        specializations: [
          {
            specialization: { id: 71, name: "Arms" },
            loadouts: [
              {
                is_active: true,
                selected_hero_talent_tree: { id: 1, name: "Slayer" },
                selected_hero_talents: [],
              },
            ],
          },
        ],
      }),
    ).toBe("Slayer");
  });
});
