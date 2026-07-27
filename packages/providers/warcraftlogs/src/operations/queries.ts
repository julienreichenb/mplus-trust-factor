export const OPERATIONS = {
  RateLimitData: {
    operationName: "RateLimitData",
    query: `query RateLimitData {
  rateLimitData {
    limitPerHour
    pointsSpentThisHour
    pointsRemaining
    resetInSeconds
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
      faction
      hidden
      server { slug region { name } }
    }
  }
}`,
  },

  CharacterZoneRankings: {
    operationName: "CharacterZoneRankings",
    query: `query CharacterZoneRankings($name: String!, $serverSlug: String!, $serverRegion: String!, $zoneID: Int!) {
  characterData {
    character(name: $name, serverSlug: $serverSlug, serverRegion: $serverRegion) {
      zoneRankings(zoneID: $zoneID, metric: playerscore, byBracket: true, compare: Parses) {
        metric
        difficulty
        rankPercent
        totalParses
        zone { id name }
        rankings {
          report { code startTime endTime }
          fightID
          encounterID
          difficulty
          kill
          duration
          bracket
          score
          total
          amount
          spec
          role
          startTime
        }
      }
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
        friendlyPlayers { id name server type icon }
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

export const MAX_EVENT_PAGES = 50;
