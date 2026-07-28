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
    }
  }
}`,
  },

  ReportFightsForPerformanceProbe: {
    operationName: "ReportFightsForPerformanceProbe",
    query: `query ReportFightsForPerformanceProbe($code: String!) {
  reportData {
    report(code: $code) {
      code
      title
      startTime
      endTime
      visibility
      zone { id name }
      fights(translate: false) {
        id
        encounterID
        name
        difficulty
        kill
        inProgress
        startTime
        endTime
        keystoneLevel
        keystoneTime
        rating
        friendlyPlayers
      }
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
        friendlyPlayers
      }
      masterData(translate: false) {
        actors { id name type subType server }
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
  $limit: Int
  $translate: Boolean
  $useAbilityIDs: Boolean
  $useActorIDs: Boolean
) {
  reportData {
    report(code: $code) {
      events(
        fightIDs: $fightIDs
        dataType: $dataType
        sourceID: $sourceID
        startTime: $startTime
        limit: $limit
        translate: $translate
        useAbilityIDs: $useAbilityIDs
        useActorIDs: $useActorIDs
      ) {
        data
        nextPageTimestamp
      }
    }
  }
}`,
  },
} as const;

export type EventDataType =
  | "Casts"
  | "Interrupts"
  | "Deaths"
  | "DamageTaken"
  | "Buffs"
  | "Debuffs"
  | "Dispels"
  | "Healing"
  | "CombatantInfo";

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
