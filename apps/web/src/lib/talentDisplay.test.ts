import { describe, expect, it } from "vitest";
import type { SelectedTalentDTO } from "../api/types";
import { mergeSelectedTalentsForDisplay } from "./talentDisplay";

function talent(partial: Partial<SelectedTalentDTO> & Pick<SelectedTalentDTO, "tree">): SelectedTalentDTO {
  return {
    id: partial.id ?? null,
    name: partial.name ?? null,
    spellId: partial.spellId ?? null,
    rank: partial.rank ?? null,
    tree: partial.tree,
    iconUrl: partial.iconUrl ?? null,
  };
}

describe("mergeSelectedTalentsForDisplay", () => {
  it("drops talents without a spellId", () => {
    const result = mergeSelectedTalentsForDisplay([
      talent({ tree: "CLASS", id: 1, spellId: 100, name: "Rend", rank: 1 }),
      talent({ tree: "CLASS", id: 99853, spellId: null, name: null, rank: 1 }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.spellId).toBe(100);
  });

  it("merges same-name multi-rank / apex nodes into one icon with combined rank", () => {
    const result = mergeSelectedTalentsForDisplay([
      talent({
        tree: "SPEC",
        id: 141750,
        spellId: 1269307,
        name: "Master of Warfare",
        rank: 1,
      }),
      talent({
        tree: "SPEC",
        id: 141751,
        spellId: 1269306,
        name: "Master of Warfare",
        rank: 2,
      }),
      talent({
        tree: "SPEC",
        id: 141752,
        spellId: 1269314,
        name: "Master of Warfare",
        rank: 1,
      }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: "Master of Warfare",
      rank: 3,
      // Highest rank entry used for tooltip
      spellId: 1269306,
      id: 141751,
    });
  });

  it("does not merge identical names across different trees", () => {
    const result = mergeSelectedTalentsForDisplay([
      talent({ tree: "CLASS", spellId: 1, name: "Shared", rank: 1 }),
      talent({ tree: "HERO", spellId: 2, name: "Shared", rank: 1 }),
    ]);
    expect(result).toHaveLength(2);
  });
});
