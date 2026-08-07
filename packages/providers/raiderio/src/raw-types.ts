export interface RawMythicPlusScores {
  all: number;
  dps?: number;
  healer?: number;
  tank?: number;
}

export interface RawSeasonScores {
  season: string;
  scores: RawMythicPlusScores;
  segments?: Record<string, unknown>;
}

export interface RawRosterCharacter {
  name: string;
  class?: string | { name?: string; slug?: string };
  active_spec_name?: string;
  active_spec_role?: string;
  spec?: { name?: string; slug?: string; role?: string };
  realm: string | { name?: string; slug?: string };
  region: string | { name?: string; slug?: string; short_name?: string };
  profile_url?: string;
}

export interface RawRosterMember {
  character: RawRosterCharacter;
  role?: string;
  ranks?: {
    overall?: number | { world?: number; region?: number; realm?: number };
    class?: number | { world?: number; region?: number; realm?: number };
    server?: number;
    world?: number;
    region?: number;
  };
}

export interface RawKeystoneRun {
  keystone_run_id: number;
  dungeon: string;
  short_name?: string;
  mythic_level: number;
  completed_at: string;
  clear_time_ms: number;
  par_time_ms?: number;
  num_keystone_upgrades?: number;
  score?: number;
  roster?: RawRosterMember[];
  url?: string;
  role?: string;
  spec?: { name?: string; slug?: string; role?: string };
}

export interface RawRankBucket {
  world?: number;
  region?: number;
  realm?: number;
}

export interface RawMythicPlusRanks {
  overall?: number | RawRankBucket;
  class?: number | RawRankBucket;
  server?: number;
  world?: number;
  region?: number;
  role?: string;
  dps?: number | RawRankBucket;
  tank?: number | RawRankBucket;
  healer?: number | RawRankBucket;
}

export interface RawGearItem {
  item_id?: number;
  item_level?: number;
  name?: string;
  icon?: string;
  item_quality?: number;
}

export interface RawGear {
  item_level_equipped?: number;
  item_level_total?: number;
  items?: RawGearItem[] | Record<string, RawGearItem | null | undefined>;
}

export interface RawRaidProgressionEntry {
  summary?: string;
  total_bosses?: number;
  normal_bosses_killed?: number;
  heroic_bosses_killed?: number;
  mythic_bosses_killed?: number;
  raid?: string;
}

export interface RawCharacterProfileResponse {
  name: string;
  class?: string;
  active_spec_name?: string;
  active_spec_role?: string;
  region: string;
  realm: string;
  profile_url?: string;
  last_crawled_at?: string;
  gear?: RawGear;
  talents?: unknown;
  mythic_plus_scores_by_season?: RawSeasonScores[];
  mythic_plus_ranks?: RawMythicPlusRanks;
  mythic_plus_recent_runs?: RawKeystoneRun[];
  mythic_plus_best_runs?: RawKeystoneRun[];
  mythic_plus_highest_level_runs?: RawKeystoneRun[];
  raid_progression?: Record<string, RawRaidProgressionEntry>;
  statusCode?: number;
  message?: string;
  error?: string;
}

export interface RawCutoffPopulation {
  quantile?: number;
  quantileMinValue?: number;
  quantilePopulationCount?: number;
  quantilePopulationFraction?: number;
  totalPopulationCount?: number;
}

export interface RawCutoffQuantile {
  score?: number;
  all?: RawCutoffPopulation;
  horde?: RawCutoffPopulation;
  alliance?: RawCutoffPopulation;
}

export interface RawSeasonCutoffs {
  updatedAt?: string;
  region?: { name?: string; slug?: string };
  p999?: RawCutoffQuantile;
  p990?: RawCutoffQuantile;
  p900?: RawCutoffQuantile;
  p750?: RawCutoffQuantile;
  p600?: RawCutoffQuantile;
}

export interface RawSeasonCutoffsResponse {
  cutoffs?: RawSeasonCutoffs;
  statusCode?: number;
  message?: string;
  error?: string;
}

export interface RawStaticDungeon {
  slug?: string;
  name?: string;
  short_name?: string;
  map_challenge_mode_id?: number;
  zone_id?: number;
  id?: number;
  challenge_mode_id?: number;
}

export interface RawStaticSeason {
  slug?: string;
  name?: string;
  starts_at?: string | Record<string, string>;
  ends_at?: string | Record<string, string> | null;
  starts?: string | Record<string, string>;
  ends?: string | Record<string, string> | null;
  is_current?: boolean;
  is_main_season?: boolean;
  dungeons?: RawStaticDungeon[];
}

export interface RawStaticDataResponse {
  seasons?: RawStaticSeason[];
  dungeons?: RawStaticDungeon[];
}

export interface RawRunDetailsResponse {
  season?: string;
  keystone_run_id?: number;
  mythic_level?: number;
  clear_time_ms?: number;
  keystone_time_ms?: number;
  completed_at?: string;
  score?: number;
  dungeon?: { name?: string; slug?: string; short_name?: string };
  roster?: RawRosterMember[];
  url?: string;
}

export interface RawPeriod {
  id: number;
  season?: string;
  starts_at: string;
  ends_at: string;
}

export interface RawRegionPeriodWindow {
  period?: number;
  start?: string;
  end?: string;
}

export interface RawRegionPeriods {
  region?: string;
  previous?: RawRegionPeriodWindow;
  current?: RawRegionPeriodWindow;
  next?: RawRegionPeriodWindow;
}

export interface RawPeriodsResponse {
  periods?: RawPeriod[] | RawRegionPeriods[];
}
