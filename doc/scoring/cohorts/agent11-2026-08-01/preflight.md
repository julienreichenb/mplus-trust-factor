# Agent 11 preflight — agent11-user-cohort-2026-08-01

Generated: 2026-08-01T11:54:15.348Z

## Summary

- Intake members: 41
- Unique identities: 40
- Strict manifest members: 0
- Excluded: 5 (deferred: 3; role-context mismatches: 2)
- Season binding: FAILED / not configured (evidence join is VPS-only; see EVIDENCE-JOIN-RUNBOOK.md)
- Evidence DB configured: false
- Live Blizzard: true (dryRun=false; profile-only; 40/40 ok)
- Meta policy: `midnight-season-1-meta-v1` (seasonSlug=`midnight-season-1`)
- Role-context: Joefreckles + Essetxd → `ROLE_CONTEXT_MISMATCH`; Petbear ×2 → `ROLE_CONTEXT_CONFLICT`; Myzouth → deferred

## Provider calls

| Identity | Result | Retries |
|---|---|---|
| EU/hyjal/Zacdruid | ok | 0 |
| EU/burning-legion/Myzouth | ok | 0 |
| EU/twisting-nether/Roibendeux | ok | 0 |
| EU/ragnaros/Drtreantino | ok | 0 |
| EU/kazzak/Vadandru | ok | 0 |
| EU/draenor/Razhäg | ok | 0 |
| EU/ysondre/Nikovoker | ok | 0 |
| EU/kazzak/Freakerino | ok | 0 |
| EU/archimonde/Wallidrixe | ok | 0 |
| EU/sylvanas/Serahz | ok | 0 |
| EU/ysondre/Teknoboom | ok | 0 |
| EU/ravencrest/Volhalo | ok | 0 |
| EU/eredar/Joefreckles | ok | 0 |
| EU/silvermoon/Allakatter | ok | 0 |
| EU/blackhand/Rusnar | ok | 0 |
| EU/draenor/Essetxd | ok | 0 |
| EU/blackrock/Biotopia | ok | 0 |
| EU/nemesis/Kèsty | ok | 0 |
| EU/blackrock/Liambrew | ok | 0 |
| EU/ravencrest/Squeakyboy | ok | 0 |
| EU/hyjal/Jun | ok | 0 |
| EU/blackrock/Woombazz | ok | 0 |
| EU/sylvanas/Xatihr | ok | 0 |
| EU/silvermoon/Lightreport | ok | 0 |
| EU/silvermoon/Reyou | ok | 0 |
| EU/tarren-mill/Sxynixevoker | ok | 0 |
| EU/archimonde/Fuzivoker | ok | 0 |
| EU/burning-steppes/Fotm | ok | 0 |
| EU/amanthul/Kratos | ok | 0 |
| EU/antonidas/Codegreen | ok | 0 |
| EU/tarren-mill/Squidovski | ok | 0 |
| EU/blackrock/Starboom | ok | 0 |
| EU/outland/Petbear | ok | 0 |
| EU/kazzak/Tonzidan | ok | 0 |
| EU/blackrock/Justevoker | ok | 0 |
| EU/silvermoon/Budgetdeath | ok | 0 |
| EU/blackrock/Soreyna | ok | 0 |
| EU/silvermoon/Arisoturana | ok | 0 |
| EU/mazrigos/Scai | ok | 0 |
| EU/antonidas/Anlong | ok | 0 |

## Members

| Member | Tier | Char ID | Role (prov→res) | Class/Spec | Meta | Status | Exclusion |
|---|---|---|---|---|---|---|---|
| user-s-eu-hyjal-zacdruid-tank | S | — | TANK→TANK | druid/guardian | false | RESOLVED_METADATA_ONLY |  |
| user-s-eu-burning-legion-myzouth-dps | S | — | DPS→DPS | death-knight/unholy | true | DEFERRED | MYZOUTH_BOOTSTRAP_DEFERRED |
| user-s-eu-twisting-nether-roibendeux-healer | S | — | HEALER→HEALER | monk/mistweaver | true | RESOLVED_METADATA_ONLY |  |
| user-s-eu-ragnaros-drtreantino-tank | S | — | TANK→TANK | druid/guardian | false | RESOLVED_METADATA_ONLY |  |
| user-s-eu-kazzak-vadandru-tank | S | — | TANK→TANK | druid/guardian | false | RESOLVED_METADATA_ONLY |  |
| user-s-eu-draenor-razhag-healer | S | — | HEALER→HEALER | monk/mistweaver | true | RESOLVED_METADATA_ONLY |  |
| user-s-eu-ysondre-nikovoker-dps | S | — | DPS→DPS | evoker/augmentation | true | RESOLVED_METADATA_ONLY |  |
| user-s-eu-kazzak-freakerino-dps | S | — | DPS→DPS | demon-hunter/devourer | true | RESOLVED_METADATA_ONLY |  |
| user-a-eu-archimonde-wallidrixe-dps | A | — | DPS→DPS | warlock/demonology | false | RESOLVED_METADATA_ONLY |  |
| user-a-eu-sylvanas-serahz-dps | A | — | DPS→DPS | demon-hunter/devourer | true | RESOLVED_METADATA_ONLY |  |
| user-a-eu-ysondre-teknoboom-tank | A | — | TANK→TANK | druid/guardian | false | RESOLVED_METADATA_ONLY |  |
| user-a-eu-ravencrest-volhalo-dps | A | — | DPS→DPS | shaman/elemental | false | RESOLVED_METADATA_ONLY |  |
| user-a-eu-eredar-joefreckles-tank | A | — | TANK→DPS | monk/windwalker | false | RESOLVED_METADATA_ONLY |  |
| user-a-eu-silvermoon-allakatter-dps | A | — | DPS→DPS | warrior/arms | true | RESOLVED_METADATA_ONLY |  |
| user-a-eu-blackhand-rusnar-dps | A | — | DPS→DPS | rogue/outlaw | false | RESOLVED_METADATA_ONLY |  |
| user-a-eu-draenor-essetxd-healer | A | — | HEALER→DPS | monk/windwalker | false | RESOLVED_METADATA_ONLY |  |
| user-a-eu-blackrock-biotopia-healer | A | — | HEALER→HEALER | shaman/restoration | true | RESOLVED_METADATA_ONLY |  |
| user-b-eu-nemesis-kesty-healer | B | — | HEALER→HEALER | monk/mistweaver | true | RESOLVED_METADATA_ONLY |  |
| user-b-eu-blackrock-liambrew-healer | B | — | HEALER→HEALER | monk/mistweaver | true | RESOLVED_METADATA_ONLY |  |
| user-b-eu-ravencrest-squeakyboy-tank | B | — | TANK→TANK | druid/guardian | false | RESOLVED_METADATA_ONLY |  |
| user-b-eu-hyjal-jun-tank | B | — | TANK→TANK | monk/brewmaster | true | RESOLVED_METADATA_ONLY |  |
| user-b-eu-blackrock-woombazz-dps | B | — | DPS→DPS | demon-hunter/devourer | true | RESOLVED_METADATA_ONLY |  |
| user-b-eu-sylvanas-xatihr-role-unknown | B | — | ∅→DPS | paladin/retribution | false | RESOLVED_METADATA_ONLY |  |
| user-b-eu-silvermoon-lightreport-role-unknown | B | — | ∅→DPS | paladin/retribution | false | RESOLVED_METADATA_ONLY |  |
| user-b-eu-silvermoon-reyou-role-unknown | B | — | ∅→DPS | demon-hunter/devourer | true | RESOLVED_METADATA_ONLY |  |
| user-c-eu-tarren-mill-sxynixevoker-dps | C | — | DPS→DPS | evoker/augmentation | true | RESOLVED_METADATA_ONLY |  |
| user-c-eu-archimonde-fuzivoker-dps | C | — | DPS→DPS | evoker/augmentation | true | RESOLVED_METADATA_ONLY |  |
| user-c-eu-burning-steppes-fotm-dps | C | — | DPS→DPS | death-knight/unholy | true | RESOLVED_METADATA_ONLY |  |
| user-c-eu-amanthul-kratos-dps | C | — | DPS→DPS | death-knight/unholy | true | RESOLVED_METADATA_ONLY |  |
| user-c-eu-antonidas-codegreen-healer | C | — | HEALER→HEALER | monk/mistweaver | true | RESOLVED_METADATA_ONLY |  |
| user-c-eu-tarren-mill-squidovski-healer | C | — | HEALER→HEALER | monk/mistweaver | true | RESOLVED_METADATA_ONLY |  |
| user-c-eu-blackrock-starboom-tank | C | — | TANK→TANK | druid/guardian | false | RESOLVED_METADATA_ONLY |  |
| user-c-eu-outland-petbear-tank | C | — | TANK→TANK | druid/guardian | false | EXCLUDED | ROLE_CONTEXT_CONFLICT |
| user-d-eu-outland-petbear-dps | D | — | DPS→TANK | druid/guardian | false | EXCLUDED | ROLE_CONTEXT_CONFLICT |
| user-d-eu-kazzak-tonzidan-dps | D | — | DPS→DPS | demon-hunter/devourer | true | RESOLVED_METADATA_ONLY |  |
| user-d-eu-blackrock-justevoker-dps | D | — | DPS→DPS | evoker/augmentation | true | RESOLVED_METADATA_ONLY |  |
| user-d-eu-silvermoon-budgetdeath-dps | D | — | DPS→DPS | death-knight/unholy | true | RESOLVED_METADATA_ONLY |  |
| user-d-eu-blackrock-soreyna-tank | D | — | TANK→TANK | druid/guardian | false | RESOLVED_METADATA_ONLY |  |
| user-d-eu-silvermoon-arisoturana-tank | D | — | TANK→TANK | monk/brewmaster | true | RESOLVED_METADATA_ONLY |  |
| user-d-eu-mazrigos-scai-healer | D | — | HEALER→HEALER | shaman/restoration | true | RESOLVED_METADATA_ONLY |  |
| user-d-eu-antonidas-anlong-healer | D | — | HEALER→HEALER | monk/mistweaver | true | RESOLVED_METADATA_ONLY |  |
