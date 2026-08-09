import { describe, expect, it } from "vitest";
import { rankingEvidenceAllowedForParticipant } from "./ranking-hydrate.js";

describe("rankingEvidenceAllowedForParticipant", () => {
  const TARGET = {
    characterId: "char-wallidrixe",
    characterName: "Wallidrixe",
  };

  it("allows character-scoped encounterRankings only for the target participant", () => {
    const evidence = {
      characterId: TARGET.characterId,
      participantActorId: null as number | null,
    };

    expect(
      rankingEvidenceAllowedForParticipant({
        evidence,
        participantActorId: 30,
        participantCharacterId: TARGET.characterId,
        participantCharacterName: "Wallidrixe",
        targetCharacterId: TARGET.characterId,
        targetCharacterName: TARGET.characterName,
      }),
    ).toBe(true);

    expect(
      rankingEvidenceAllowedForParticipant({
        evidence,
        participantActorId: 1,
        participantCharacterId: null,
        participantCharacterName: "Litonfire",
        targetCharacterId: TARGET.characterId,
        targetCharacterName: TARGET.characterName,
      }),
    ).toBe(false);
  });

  it("does not let a character-scoped row be consumed by another character id", () => {
    expect(
      rankingEvidenceAllowedForParticipant({
        evidence: { characterId: TARGET.characterId, participantActorId: null },
        participantActorId: 99,
        participantCharacterId: "other-character",
        participantCharacterName: "Other",
        targetCharacterId: TARGET.characterId,
        targetCharacterName: TARGET.characterName,
      }),
    ).toBe(false);
  });

  it("legacy fight-scoped rows without characterId bind only to the scoring target", () => {
    const legacy = { characterId: null, participantActorId: null };

    expect(
      rankingEvidenceAllowedForParticipant({
        evidence: legacy,
        participantActorId: 30,
        participantCharacterId: TARGET.characterId,
        participantCharacterName: "Wallidrixe",
        targetCharacterId: TARGET.characterId,
        targetCharacterName: TARGET.characterName,
      }),
    ).toBe(true);

    expect(
      rankingEvidenceAllowedForParticipant({
        evidence: legacy,
        participantActorId: 1,
        participantCharacterId: null,
        participantCharacterName: "Litonfire",
        targetCharacterId: TARGET.characterId,
        targetCharacterName: TARGET.characterName,
      }),
    ).toBe(false);
  });

  it("honors explicit participantActorId on the evidence row", () => {
    expect(
      rankingEvidenceAllowedForParticipant({
        evidence: { characterId: TARGET.characterId, participantActorId: 30 },
        participantActorId: 30,
        participantCharacterId: TARGET.characterId,
        participantCharacterName: "Wallidrixe",
        targetCharacterId: TARGET.characterId,
        targetCharacterName: TARGET.characterName,
      }),
    ).toBe(true);

    expect(
      rankingEvidenceAllowedForParticipant({
        evidence: { characterId: TARGET.characterId, participantActorId: 30 },
        participantActorId: 1,
        participantCharacterId: null,
        participantCharacterName: "Litonfire",
        targetCharacterId: TARGET.characterId,
        targetCharacterName: TARGET.characterName,
      }),
    ).toBe(false);
  });
});
