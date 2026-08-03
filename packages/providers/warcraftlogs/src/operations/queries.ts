export const OPERATIONS = {
  RateLimitData: {
    operationName: "RateLimitData",
    query: `query RateLimitData {
  rateLimitData {
    limitPerHour
    pointsSpentThisHour
    pointsResetIn
  }
}`,
  },

  ResolveCharacter: {
    operationName: "ResolveCharacter",
    query: `query ResolveCharacter($name: String!, $serverSlug: String!, $serverRegion: String!) {
  characterData {
    character(name: $name, serverSlug: $serverSlug, serverRegion: $serverRegion) {
      id
      canonicalID
      name
      level
      classID
      hidden
      server { slug region { name } }
    }
  }
}`,
  },

  CharacterZoneRankings: {
    operationName: "CharacterZoneRankings",
    // Live WCL types zoneRankings as JSON — no GraphQL subselection allowed.
    query: `query CharacterZoneRankings($name: String!, $serverSlug: String!, $serverRegion: String!, $zoneID: Int!) {
  characterData {
    character(name: $name, serverSlug: $serverSlug, serverRegion: $serverRegion) {
      zoneRankings(zoneID: $zoneID, metric: playerscore, byBracket: true, compare: Parses)
    }
  }
}`,
  },

  /** Aggregate dungeon Best%/Median% — omit compare:Parses so rows include rankPercent/medianPercent. */
  CharacterZoneRankingAggregates: {
    operationName: "CharacterZoneRankingAggregates",
    query: `query CharacterZoneRankingAggregates($name: String!, $serverSlug: String!, $serverRegion: String!, $zoneID: Int!) {
  characterData {
    character(name: $name, serverSlug: $serverSlug, serverRegion: $serverRegion) {
      zoneRankings(zoneID: $zoneID, metric: playerscore, byBracket: true)
    }
  }
}`,
  },

  CharacterRecentReports: {
    operationName: "CharacterRecentReports",
    query: `query CharacterRecentReports($name: String!, $serverSlug: String!, $serverRegion: String!, $limit: Int!, $page: Int!) {
  characterData {
    character(name: $name, serverSlug: $serverSlug, serverRegion: $serverRegion) {
      recentReports(limit: $limit, page: $page) {
        data {
          code
          title
          startTime
          endTime
          visibility
          zone { id name }
        }
        total
        has_more_pages
      }
    }
  }
}`,
  },

  WorldDataZone: {
    operationName: "WorldDataZone",
    query: `query WorldDataZone($id: Int!) {
  worldData {
    zone(id: $id) {
      id
      name
      frozen
      encounters { id name }
      partitions { id name }
    }
  }
}`,
  },

  /**
   * Character M+ "Points & Damage (By Level)" page dataset (Performance probe).
   * Literal metric: points_and_damage — CharacterPageRankingMetricType.
   * Payload includes score rankings plus throughputRankings for DPS Best%/Median%.
   */
  CharacterZoneRankingsPointsAndDamage: {
    operationName: "CharacterZoneRankingsPointsAndDamage",
    query: `query CharacterZoneRankingsPointsAndDamage(
  $name: String!
  $serverSlug: String!
  $serverRegion: String!
  $zoneID: Int!
  $partition: Int
) {
  characterData {
    character(name: $name, serverSlug: $serverSlug, serverRegion: $serverRegion) {
      zoneRankings(
        zoneID: $zoneID
        metric: points_and_damage
        byBracket: true
        partition: $partition
      )
    }
  }
}`,
  },

  ReportWithFightAndMasterData: {
    operationName: "ReportWithFightAndMasterData",
    query: `query ReportWithFightAndMasterData($code: String!, $fightIDs: [Int!]) {
  reportData {
    report(code: $code) {
      code
      title
      revision
      startTime
      endTime
      visibility
      zone { id name }
      fights(fightIDs: $fightIDs, translate: false) {
        id
        encounterID
        name
        difficulty
        kill
        startTime
        endTime
        keystoneLevel
        keystoneBonus
        friendlyPlayers
      }
      masterData(translate: false) {
        actors { id name type subType server petOwner }
        abilities { gameID type }
      }
    }
  }
}`,
  },

  ReportEvents: {
    operationName: "ReportEvents",
    query: `query ReportEvents(
  $code: String!
  $fightIDs: [Int!]
  $dataType: EventDataType!
  $sourceID: Int
  $startTime: Float
  $endTime: Float
  $limit: Int
  $translate: Boolean
  $useAbilityIDs: Boolean
  $useActorIDs: Boolean
  $includeResources: Boolean
  $filterExpression: String
  $hostilityType: HostilityType
) {
  reportData {
    report(code: $code) {
      events(
        fightIDs: $fightIDs
        dataType: $dataType
        sourceID: $sourceID
        startTime: $startTime
        endTime: $endTime
        limit: $limit
        translate: $translate
        useAbilityIDs: $useAbilityIDs
        useActorIDs: $useActorIDs
        includeResources: $includeResources
        filterExpression: $filterExpression
        hostilityType: $hostilityType
      ) {
        data
        nextPageTimestamp
      }
    }
  }
}`,
  },

  /**
   * Discovery-only: report playerDetails with combatant info for health-field inspection.
   * Not used by the production refresh pipeline.
   */
  ReportPlayerDetails: {
    operationName: "ReportPlayerDetails",
    query: `query ReportPlayerDetails(
  $code: String!
  $fightIDs: [Int!]
  $includeCombatantInfo: Boolean
) {
  reportData {
    report(code: $code) {
      playerDetails(fightIDs: $fightIDs, includeCombatantInfo: $includeCombatantInfo)
    }
  }
}`,
  },
} as const;

export type EventDataType =
  | "All"
  | "Casts"
  | "Interrupts"
  | "Deaths"
  | "DamageTaken"
  | "DamageDone"
  | "Buffs"
  | "Debuffs"
  | "Dispels"
  | "Healing"
  | "CombatantInfo"
  | "Resources";

/** Production combat-facts event categories — Resources/All are discovery-only. */
export const DETAILED_EVENT_TYPES: EventDataType[] = [
  "Casts",
  "Interrupts",
  "Deaths",
  "DamageTaken",
  "Buffs",
  "Debuffs",
  "Dispels",
  "Healing",
  "CombatantInfo",
];

/** @deprecated Import MAX_EVENT_PAGES from discovery/bounds.js */
export { MAX_EVENT_PAGES } from "../discovery/bounds.js";
