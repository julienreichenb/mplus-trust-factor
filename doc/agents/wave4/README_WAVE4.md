# M+ Trust Factor — Wave 4 preparation pack

## Objective

Wave 4 focuses on two outcomes:

1. **Scoring v3** based on the eight highest current-season keys: one canonical run per dungeon.
2. **Product UX stabilization**: a credible SaaS landing page and a profile page centered on the Trust Score.

This wave must not begin by tuning arbitrary weights. It begins by proving that every required fact can be collected and explained on the Wallidrixe smoke profile.

## Recommended score architecture

Remove the **Raid** dimension. Do not replace it merely to keep five dimensions.

Recommended dimensions and provisional global weights:

| Dimension | Weight | Purpose |
|---|---:|---|
| Performance | 35% | Execution quality at meaningful key difficulty |
| Survival | 30% | Staying alive and mitigating preventable danger |
| Utility | 25% | Interrupts, control, dispels and group support |
| Experience | 10% | Verified current and historical Mythic+ experience |

Keep these separate from the dimensions:

- **Confidence**: data coverage and reliability.
- **Authenticity**: suspicious or mitigating signals.

A future Reliability dimension should only be added if repeated-behaviour or abandonment data becomes trustworthy. It should not be invented from weak proxies.

## Canonical run selection

For the resolved active season, create a shared `ScoringRunSet` containing exactly one run per dungeon:

1. highest keystone level;
2. then highest run score / timed result;
3. then most recent completion.

The selected run remains the highest known canonical run even if WCL details are missing. Do not silently substitute a lower logged run. Missing detail reduces confidence for that dungeon.

## Execution order

1. Agent 21 — Scoring v3 data foundation and Wallidrixe smoke.
2. Agents 22, 23 and 24 in parallel — Performance, Survival and Utility.
3. Agent 25 — Experience/account graph feasibility and implementation.
4. Agent 26 — Landing and profile information architecture.
5. Agent 27 — Calibration, bias audit and Wave 4 integration.

Agent 26 may start after Agent 21 freezes the public contracts and mocks.

## Release principle

Every score contributor must expose:

- raw fact;
- normalized value;
- data source;
- run and season scope;
- formula version;
- confidence;
- missing-data behaviour.

No unavailable metric becomes zero. No historical score is compared as a raw number across incompatible seasons.
