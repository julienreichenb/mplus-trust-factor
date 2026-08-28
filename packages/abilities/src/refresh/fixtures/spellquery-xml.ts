/**
 * SpellQuery XML schema-contract fixtures (SYNTHETIC_CONTRACT).
 * Not captured from a local simc.exe.
 */
export const SPELLQUERY_CLASS_SPELL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<spell_query>
  <spell id="118" name="Polymorph" class="MAGE">
    <cooldown>0</cooldown>
    <passive>0</passive>
    <cast_min>1.7</cast_min>
    <cast_max>1.7</cast_max>
    <description>Transforms the enemy into a sheep.</description>
  </spell>
</spell_query>
`;

export const SPELLQUERY_SPEC_SPELL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<spell_query>
  <spell id="84714" name="Frozen Orb" class="MAGE" spec="frost">
    <cooldown>60</cooldown>
    <charges>0</charges>
    <passive>0</passive>
  </spell>
  <spell id="190319" name="Combustion" class="MAGE" spec="fire">
    <cooldown>120</cooldown>
    <max_stack>1</max_stack>
    <passive>0</passive>
  </spell>
  <spell id="191634" name="Stormkeeper" class="SHAMAN" spec="elemental">
    <cooldown>60</cooldown>
    <max_stack>2</max_stack>
    <initial_stack>2</initial_stack>
    <passive>0</passive>
    <effect id="1" type="E_APPLY_AURA">
      <trigger_spell id="191634"/>
    </effect>
  </spell>
  <spell id="383009" name="Stormkeeper" class="SHAMAN" spec="enhancement">
    <cooldown>60</cooldown>
    <passive>0</passive>
  </spell>
  <spell id="15286" name="Vampiric Embrace" class="PRIEST" spec="shadow">
    <cooldown>120</cooldown>
    <passive>0</passive>
  </spell>
  <spell id="20594" name="Stoneform" race="Dwarf">
    <cooldown>120</cooldown>
    <charges>0</charges>
    <passive>0</passive>
  </spell>
</spell_query>
`;

export const SPELLQUERY_RACE_SPELL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<spell_query>
  <spell id="20594" name="Stoneform" race="Dwarf">
    <cooldown>120</cooldown>
    <passive>0</passive>
  </spell>
  <spell id="20596" name="Frost Resistance" race="Dwarf">
    <passive>1</passive>
  </spell>
</spell_query>
`;

export const SPELLQUERY_CHARGES_AND_TRIGGER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<spell_query>
  <spell id="100780" name="Tiger Palm" class="MONK">
    <charges>2</charges>
    <charge_cooldown>1</charge_cooldown>
    <passive>0</passive>
    <effect id="1" type="E_TRIGGER_SPELL">
      <trigger_spell id="100784"/>
    </effect>
  </spell>
</spell_query>
`;

export const SPELLQUERY_CONTRACT_XML_PROVENANCE = "SYNTHETIC_CONTRACT" as const;
export const REAL_SPELLQUERY_XML_PROVENANCE = "REAL_CAPTURE" as const;

/** Captured from SimC 1210-01 Live SpellQuery XML (git a060a35). REAL_CAPTURE. */
export const REAL_SPELLQUERY_CLASS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<spell_query>
  <spell id="66" name="Invisibility" gcd="1.5" duration="3" cooldown="300">
    <class id="mage" name="Mage" />
    <effects count="3">
      <effect number="1" id="823918" type="6" type_text="Apply Aura (6)" sub_type="4" sub_type_text="Dummy (4)" />
      <effect number="2" id="39" type="6" type_text="Apply Aura (6)" sub_type="23" sub_type_text="Periodic Trigger Spell (23)" trigger_spell_id="35009" />
    </effects>
    <description>Turns you invisible.</description>
  </spell>
</spell_query>
`;

export const REAL_SPELLQUERY_SPEC_XML = `<?xml version="1.0" encoding="UTF-8"?>
<spell_query>
  <spell id="15286" name="Vampiric Embrace" level="25" duration="12" cooldown="120" proc_chance="100">
    <spec id="Shadow Priest" name="shadow" />
    <class id="priest" name="Priest" />
    <effects count="1">
      <effect number="1" id="7216" type="6" type_text="Apply Aura (6)" sub_type="226" sub_type_text="Periodic Dummy (226)" period="0.5" base_value="40" />
    </effects>
    <description>Fills you with the embrace of Shadow energy.</description>
  </spell>
</spell_query>
`;

export const REAL_SPELLQUERY_RACE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<spell_query>
  <spell id="20594" name="Stoneform" cooldown="120">
    <class id="warrior" name="Warrior" />
    <class id="mage" name="Mage" />
    <race id="2" name="Dwarf" />
    <description>Removes harmful effects.</description>
  </spell>
  <spell id="5227" name="Touch of the Grave" passive="true" proc_chance="20">
    <race id="4" name="Undead" />
    <effects count="1">
      <effect number="1" id="1863" type="6" type_text="Apply Aura (6)" sub_type="42" sub_type_text="Proc Trigger Spell (42)" trigger_spell_id="127802" />
    </effects>
    <description>Your attacks drain the target.</description>
  </spell>
</spell_query>
`;
