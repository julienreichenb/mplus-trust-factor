# Metric catalog (v1)

| Key | Dimension | Default weight | Notes |
|-----|-----------|----------------|-------|
| `performance.spec_percentile` | PERFORMANCE | 0.55 | Spec/dungeon/key bracket percentile |
| `performance.consistency` | PERFORMANCE | 0.25 | Consistency across runs/rankings |
| `performance.contextual_contribution` | PERFORMANCE | 0.20 | Selected detailed-run contribution |
| `survival.death_rate` | SURVIVAL | 0.35 | Lower-better; inverted when normalizing from raw |
| `survival.avoidable_damage` | SURVIVAL | 0.30 | Requires mechanic catalog rules |
| `survival.defensive_usage` | SURVIVAL | 0.25 | Defensive readiness/usage |
| `survival.consumable_usage` | SURVIVAL | 0.10 | Healthstone/potion/self-saves |
| `utility.interrupts` | UTILITY | 0.30 | Successful relevant interrupts |
| `utility.crowd_control` | UTILITY | 0.25 | Relevant CC |
| `utility.dispels` | UTILITY | 0.15 | Dispels/purges |
| `utility.externals` | UTILITY | 0.15 | External support CDs |
| `utility.class_specific` | UTILITY | 0.15 | Class utility |
| `experience.dungeon_breadth` | EXPERIENCE | 0.35 | Current-season dungeon breadth |
| `experience.top_level_repeat` | EXPERIENCE | 0.25 | Completions near personal top |
| `experience.volume_recency` | EXPERIENCE | 0.15 | Volume + recency |
| `experience.historical_seasons` | EXPERIENCE | 0.15 | Prior seasons after in-season normalize + decay |
| `experience.role_continuity` | EXPERIENCE | 0.10 | Class/spec/role continuity |
| `raid.mythic_progression` | RAID | 0.60 | Mythic progression |
| `raid.mythic_parses` | RAID | 0.40 | Aggregate Mythic parse signal |

Missing metrics stay missing (not zero). Dimension scores use available-weight redistribution and confidence shrinkage toward 50.
