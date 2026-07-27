# Agent 24 — Utility v3 and Ability Catalog

Work from Agent 21's merged foundation on `integration/wave4`.

Use only the eight selected highest-key current-season runs.

Initial weights:

- interrupt activity/success 40%;
- unique CC targets 25%;
- group support/externals 20%;
- defensive/offensive dispels 15%.

Requirements:

1. Resolve the actual interrupt from class/spec/talents/pet/loadout.
2. Count all kick casts as attempts; count WCL Interrupts as successful.
3. Estimate available kick windows from effective cooldown and run duration.
4. Interrupt score baseline: 70% activity, 30% success quality.
5. Count distinct hostile actor instances affected by catalogued CC. Reapplications to the same actor do not inflate the raw count.
6. Count catalogued group-support abilities such as Demonic Gateway, Blessing of Sacrifice and Rallying Cry; clearly distinguish cast from confirmed party usage.
7. Classify defensive and offensive successful dispels.
8. Remove unsupported categories for a spec and renormalize available weights.
9. Attribute pet actions to the player safely.
10. Deliver Warlock Demonology coverage for Wallidrixe: kick, Banish/Fear/Shadowfury/Mortal Coil where present, Demonic Gateway and relevant dispels.
11. Expose per-run evidence and catalog coverage.

Do not require proof that CC interrupted an ability in v3.
