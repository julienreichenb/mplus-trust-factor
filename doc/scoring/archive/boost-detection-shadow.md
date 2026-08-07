# Boost detection — shadow V1 locked decisions

Shadow-only authenticity features. No production scoring effect until a calibrated draft ScoreModel is explicitly activated.

## Constraints

- Do not modify production scoring formulas, weights, thresholds, grades, or model versions for shadow work.
- Do not populate production `AuthenticityFeatureInput` under the **active** model.
- Authenticity / boost remains a **separate pillar** under v6 (metadata + probabilistic red flags); it does not change Trust Score until a future model says otherwise.
- Account linkage is **private** — verified Battle.net ownership only.
- Public wording remains probabilistic ([`../security/red-flag-language.md`](../security/red-flag-language.md)).

## Locked V1 shadow feature names

| Feature | Role |
|---------|------|
| `progressionVelocity` | Progression through key difficulty over time (not run volume) |
| `teammateScoreGap` | Time-aligned Mythic+ rating gap vs teammates on high keys |
| `repeatedStrongerTeammateCohort` | Recurrence of the same substantially stronger teammates |
| `highKeyGroupConcentration` | Overlap of the same roster core across most high-key progression |
| `verifiedAltExperienceMitigation` | Private mitigation when a verified same-account character has equal/higher season Mythic+ |

Related: [`boost-shadow-phase2-backtest.md`](boost-shadow-phase2-backtest.md), [`../product/scoring-model-v6.md`](../product/scoring-model-v6.md).
