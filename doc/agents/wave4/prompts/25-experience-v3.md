# Agent 25 — Experience v3 and Account Graph Feasibility

Work from Agent 21's merged foundation on `integration/wave4`.

Objective: design an honest Experience score across current and historical Mythic+ activity without inventing public alt relationships.

Requirements:

1. Audit official WCL, Blizzard and Raider.IO capabilities and terms for:
   - same-character rename/transfer identity;
   - season ratings/history;
   - public main/alt links;
   - user-authorized account character enumeration.
2. Prove which data is available for arbitrary public profiles versus authenticated/verified users.
3. Implement public character-only history when reliable.
4. Design verified account mode for explicitly linked characters; do not infer alts from names, guilds or logs.
5. Normalize each season before comparison. Raw Legion-era and current rating values are not comparable.
6. Baseline verified formula:
   - current account peak 45%;
   - current breadth with diminishing returns 25%;
   - historical normalized peak 20%;
   - active-season longevity 10%.
7. Define an age-decay policy with a non-zero floor for exceptional old achievements.
8. Provide clear labels: CHARACTER_HISTORY versus VERIFIED_ACCOUNT_HISTORY.
9. Validate what can be shown for Wallidrixe without account authentication.
10. Treat missing alt graph as unavailable, not low experience.

Delivery must include a feasibility decision and any required future OAuth/product flow.
