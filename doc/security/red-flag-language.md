# Red-flag language policy

## Core rule

**Boost** and related outputs are **suspicion scores or probabilistic red flags**, never factual accusations.

## Allowed public tags (examples)

- Boost suspected
- Atypical progression
- Logs hidden / incomplete
- Insufficient data
- Low run volume
- Confirmed reroll / Probable reroll
- Data stale

## Forbidden phrasing

- "This player bought a boost"
- "This player is a booster"
- Any statement asserting paid services or cheating as fact

## Implementation

- `RedFlagDefinition.label` and UI copy must use probabilistic wording.
- Scoring engine (Agent 4) emits evidence-backed flags with confidence.
- Website/addon show severity and confidence, not legal conclusions.

## Testing

- Scoring todo tests (Agent 4) include "never emits factual boost accusations".
- QA reviews new flag definitions in seed/admin for language compliance.

## Legal review

Required before commercial launch and broad public marketing.
