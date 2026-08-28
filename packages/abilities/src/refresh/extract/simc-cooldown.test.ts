import { describe, expect, it } from "vitest";
import { parseSpellQueryXml, resolveSpellCooldownSeconds } from "./simc-xml.js";

const SHIFT_XML = `<spell id="1234796" name="Shift" cooldown="0.8">
  <spec id="Devourer Demon Hunter" name="devourer" />
  <class id="demonhunter" name="Demon Hunter" />
</spell>`;

const FLYING_SERPENT_KICK_XML = `<spell id="101545" name="Flying Serpent Kick" gcd="1" duration="1.5" cooldown="30">
  <spec id="Windwalker Monk" name="windwalker" />
  <class id="monk" name="Monk" />
</spell>`;

const SPECTRAL_SIGHT_XML = `<spell id="1251417" name="Spectral Sight" gcd="1.5" duration="8" cooldown="30">
  <spec id="Devourer Demon Hunter" name="devourer" />
  <class id="demonhunter" name="Demon Hunter" />
</spell>`;

const VAMPIRIC_EMBRACE_XML = `<spell id="15286" name="Vampiric Embrace" duration="12" cooldown="120">
  <spec id="Shadow Priest" name="shadow" />
  <class id="priest" name="Priest" />
</spell>`;

const CHARGE_SPELL_XML = `<spell id="999001" name="Charge Example" cooldown="0.8" charges="2" charge_cooldown="20">
  <spec id="Arms Warrior" name="arms" />
  <class id="warrior" name="Warrior" />
</spell>`;

describe("resolveSpellCooldownSeconds", () => {
  it("maps trustworthy SimC cooldowns from live refresh XML shapes", () => {
    const shift = parseSpellQueryXml(SHIFT_XML)[0]!;
    expect(shift.cooldownSeconds).toBe(0.8);
    expect(resolveSpellCooldownSeconds(shift)).toBeNull();

    const fsk = parseSpellQueryXml(FLYING_SERPENT_KICK_XML)[0]!;
    expect(fsk.cooldownSeconds).toBe(30);
    expect(fsk.gcdSeconds).toBe(1);
    expect(fsk.durationSeconds).toBe(1.5);
    expect(resolveSpellCooldownSeconds(fsk)).toBe(30);

    const spectral = parseSpellQueryXml(SPECTRAL_SIGHT_XML)[0]!;
    expect(resolveSpellCooldownSeconds(spectral)).toBe(30);

    const ve = parseSpellQueryXml(VAMPIRIC_EMBRACE_XML)[0]!;
    expect(resolveSpellCooldownSeconds(ve)).toBe(120);
  });

  it("prefers charge cooldown over sub-second category cooldown", () => {
    const charged = parseSpellQueryXml(CHARGE_SPELL_XML)[0]!;
    expect(charged.cooldownSeconds).toBe(0.8);
    expect(charged.chargeCooldownSeconds).toBe(20);
    expect(resolveSpellCooldownSeconds(charged)).toBe(20);
  });

  it("does not treat cast time or duration as cooldown", () => {
    const castLike = parseSpellQueryXml(
      `<spell id="42" name="Casty" cooldown="1.5" cast_time="1.5"></spell>`,
    )[0]!;
    expect(resolveSpellCooldownSeconds(castLike)).toBeNull();

    const durationLike = parseSpellQueryXml(
      `<spell id="43" name="Durationy" cooldown="8" duration="8"></spell>`,
    )[0]!;
    expect(resolveSpellCooldownSeconds(durationLike)).toBeNull();
  });
});
