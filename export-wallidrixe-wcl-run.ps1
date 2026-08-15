param(
  [string]$ReportCode = "8WawmdrjbYtRFPqy",
  [int]$FightId = 1,
  [string]$CharacterName = "Wallidrixe",
  [string]$RealmSlug = "archimonde",
  [ValidateSet("EU", "US", "KR", "TW")]
  [string]$Region = "EU",
  [int]$ZoneId = 0,
  [string]$OutputRoot = ".\tmp\wcl-run-export",
  [int]$MaxPagesPerDataset = 200
)

$ErrorActionPreference = "Stop"

function Get-DotEnvValue {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [string]$Path = ".env"
  )

  $fromProcess = [Environment]::GetEnvironmentVariable($Name)
  if (-not [string]::IsNullOrWhiteSpace($fromProcess)) {
    return $fromProcess
  }

  if (-not (Test-Path $Path)) {
    return $null
  }

  $line = Get-Content $Path |
    Where-Object { $_ -match "^\s*$([regex]::Escape($Name))\s*=" } |
    Select-Object -First 1

  if (-not $line) {
    return $null
  }

  $value = ($line -replace "^\s*$([regex]::Escape($Name))\s*=\s*", "").Trim()
  if (
    ($value.StartsWith('"') -and $value.EndsWith('"')) -or
    ($value.StartsWith("'") -and $value.EndsWith("'"))
  ) {
    $value = $value.Substring(1, $value.Length - 2)
  }
  return $value
}

function Write-JsonFile {
  param(
    [Parameter(Mandatory = $true)]$Value,
    [Parameter(Mandatory = $true)][string]$Path
  )

  $parent = Split-Path -Parent $Path
  if ($parent) {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
  }

  $Value |
    ConvertTo-Json -Depth 100 |
    Set-Content -Path $Path -Encoding utf8
}

function Normalize-Realm {
  param([AllowNull()][string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) {
    return ""
  }
  return ($Value.ToLowerInvariant() -replace "[^a-z0-9]", "")
}

$ClientId = Get-DotEnvValue -Name "WCL_CLIENT_ID"
$ClientSecret = Get-DotEnvValue -Name "WCL_CLIENT_SECRET"
$TokenUrl = Get-DotEnvValue -Name "WCL_TOKEN_URL"
$GraphQlUrl = Get-DotEnvValue -Name "WCL_PUBLIC_GRAPHQL_URL"

if ([string]::IsNullOrWhiteSpace($TokenUrl)) {
  $TokenUrl = "https://www.warcraftlogs.com/oauth/token"
}
if ([string]::IsNullOrWhiteSpace($GraphQlUrl)) {
  $GraphQlUrl = "https://www.warcraftlogs.com/api/v2/client"
}
if ($ZoneId -le 0) {
  $configuredZoneId = Get-DotEnvValue -Name "WCL_MPLUS_ZONE_ID"
  if ([string]::IsNullOrWhiteSpace($configuredZoneId) -or -not [int]::TryParse($configuredZoneId, [ref]$ZoneId)) {
    throw "Pass -ZoneId explicitly or define WCL_MPLUS_ZONE_ID in the root .env file."
  }
}
if ([string]::IsNullOrWhiteSpace($ClientId) -or [string]::IsNullOrWhiteSpace($ClientSecret)) {
  throw "WCL_CLIENT_ID and WCL_CLIENT_SECRET must exist in the process environment or the root .env file."
}

$basicBytes = [Text.Encoding]::UTF8.GetBytes("${ClientId}:${ClientSecret}")
$basicAuth = [Convert]::ToBase64String($basicBytes)

$tokenResponse = Invoke-RestMethod `
  -Method Post `
  -Uri $TokenUrl `
  -Headers @{ Authorization = "Basic $basicAuth" } `
  -ContentType "application/x-www-form-urlencoded" `
  -Body @{ grant_type = "client_credentials" }

if ([string]::IsNullOrWhiteSpace($tokenResponse.access_token)) {
  throw "WCL OAuth response did not contain access_token."
}

$AccessToken = [string]$tokenResponse.access_token
$Headers = @{
  Authorization = "Bearer $AccessToken"
  Accept = "application/json"
}

function Invoke-WclGraphQl {
  param(
    [Parameter(Mandatory = $true)][string]$OperationName,
    [Parameter(Mandatory = $true)][string]$Query,
    [Parameter(Mandatory = $true)][hashtable]$Variables
  )

  $request = @{
    operationName = $OperationName
    query = $Query
    variables = $Variables
  }

  $response = Invoke-RestMethod `
    -Method Post `
    -Uri $GraphQlUrl `
    -Headers $Headers `
    -ContentType "application/json" `
    -Body ($request | ConvertTo-Json -Depth 100 -Compress)

  return @{
    request = $request
    response = $response
  }
}

$RunDirectory = Join-Path $OutputRoot "${ReportCode}-fight-${FightId}"
$ZipPath = Join-Path $OutputRoot "${ReportCode}-fight-${FightId}-wcl-raw.zip"

if (Test-Path $RunDirectory) {
  Remove-Item -Recurse -Force $RunDirectory
}
New-Item -ItemType Directory -Force -Path $RunDirectory | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ZipPath) | Out-Null

$RateLimitQuery = @'
query RateLimitData {
  rateLimitData {
    limitPerHour
    pointsSpentThisHour
    pointsResetIn
  }
}
'@

$ReportQuery = @'
query ReportWithFightAndMasterData($code: String!, $fightIDs: [Int!]) {
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
}
'@

$EventsQuery = @'
query ReportEvents(
  $code: String!
  $fightIDs: [Int!]
  $dataType: EventDataType!
  $sourceID: Int
  $startTime: Float
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
}
'@

$ZoneRankingsParsesQuery = @'
query CharacterZoneRankings(
  $name: String!
  $serverSlug: String!
  $serverRegion: String!
  $zoneID: Int!
) {
  characterData {
    character(name: $name, serverSlug: $serverSlug, serverRegion: $serverRegion) {
      zoneRankings(
        zoneID: $zoneID
        metric: playerscore
        byBracket: true
        compare: Parses
      )
    }
  }
}
'@

$ZoneRankingsPointsAndDamageQuery = @'
query CharacterZoneRankingsPointsAndDamage(
  $name: String!
  $serverSlug: String!
  $serverRegion: String!
  $zoneID: Int!
) {
  characterData {
    character(name: $name, serverSlug: $serverSlug, serverRegion: $serverRegion) {
      zoneRankings(
        zoneID: $zoneID
        metric: points_and_damage
        byBracket: true
      )
    }
  }
}
'@

$beforeRate = Invoke-WclGraphQl `
  -OperationName "RateLimitData" `
  -Query $RateLimitQuery `
  -Variables @{}
Write-JsonFile -Value $beforeRate -Path (Join-Path $RunDirectory "rate-limit-before.json")

$reportEnvelope = Invoke-WclGraphQl `
  -OperationName "ReportWithFightAndMasterData" `
  -Query $ReportQuery `
  -Variables @{
    code = $ReportCode
    fightIDs = @($FightId)
  }
Write-JsonFile -Value $reportEnvelope -Path (Join-Path $RunDirectory "report-fight-masterdata.json")

$report = $reportEnvelope.response.data.reportData.report
if ($null -eq $report) {
  throw "WCL returned no report for code $ReportCode."
}

$fight = @($report.fights) | Where-Object { [int]$_.id -eq $FightId } | Select-Object -First 1
if ($null -eq $fight) {
  throw "Fight $FightId was not found in report $ReportCode."
}

$actors = @($report.masterData.actors)
$normalizedExpectedRealm = Normalize-Realm $RealmSlug
$targetActor = $actors |
  Where-Object {
    $_.type -eq "Player" -and
    $_.name -ieq $CharacterName -and
    (
      [string]::IsNullOrWhiteSpace([string]$_.server) -or
      (Normalize-Realm ([string]$_.server)) -eq $normalizedExpectedRealm
    )
  } |
  Select-Object -First 1

if ($null -eq $targetActor) {
  $targetActor = $actors |
    Where-Object { $_.type -eq "Player" -and $_.name -ieq $CharacterName } |
    Select-Object -First 1
}

if ($null -eq $targetActor) {
  throw "Could not resolve the actor ID for $CharacterName. Inspect report-fight-masterdata.json."
}

$PlayerActorId = [int]$targetActor.id
$OwnedPetActorIds = @(
  $actors |
    Where-Object { $null -ne $_.petOwner -and [int]$_.petOwner -eq $PlayerActorId } |
    ForEach-Object { [int]$_.id }
)

$rankingVariables = @{
  name = $CharacterName
  serverSlug = $RealmSlug
  serverRegion = $Region
  zoneID = $ZoneId
}

$parsesEnvelope = Invoke-WclGraphQl `
  -OperationName "CharacterZoneRankings" `
  -Query $ZoneRankingsParsesQuery `
  -Variables $rankingVariables
Write-JsonFile -Value $parsesEnvelope -Path (Join-Path $RunDirectory "zone-rankings-parses.json")

$pointsEnvelope = Invoke-WclGraphQl `
  -OperationName "CharacterZoneRankingsPointsAndDamage" `
  -Query $ZoneRankingsPointsAndDamageQuery `
  -Variables $rankingVariables
Write-JsonFile -Value $pointsEnvelope -Path (Join-Path $RunDirectory "zone-rankings-points-and-damage.json")

$HostileCastFilter = 'type = "begincast" OR type = "cast" OR type = "castfailed" OR type = "interrupted"'

$datasetDefinitions = @(
  [pscustomobject]@{ Name = "casts";          DataType = "Casts";         SourceId = $null;          IncludeResources = $false; HostilityType = $null;      FilterExpression = $null },
  [pscustomobject]@{ Name = "hostile-casts";  DataType = "Casts";         SourceId = $null;          IncludeResources = $false; HostilityType = "Enemies";  FilterExpression = $HostileCastFilter },
  [pscustomobject]@{ Name = "interrupts";     DataType = "Interrupts";    SourceId = $null;          IncludeResources = $false; HostilityType = $null;      FilterExpression = $null },
  [pscustomobject]@{ Name = "deaths";         DataType = "Deaths";        SourceId = $PlayerActorId; IncludeResources = $true;  HostilityType = $null;      FilterExpression = $null },
  [pscustomobject]@{ Name = "damage-taken";   DataType = "DamageTaken";   SourceId = $PlayerActorId; IncludeResources = $true;  HostilityType = $null;      FilterExpression = $null },
  [pscustomobject]@{ Name = "damage-done";    DataType = "DamageDone";    SourceId = $null;          IncludeResources = $false; HostilityType = $null;      FilterExpression = $null },
  [pscustomobject]@{ Name = "buffs";          DataType = "Buffs";         SourceId = $PlayerActorId; IncludeResources = $false; HostilityType = $null;      FilterExpression = $null },
  [pscustomobject]@{ Name = "debuffs";        DataType = "Debuffs";       SourceId = $PlayerActorId; IncludeResources = $false; HostilityType = $null;      FilterExpression = $null },
  [pscustomobject]@{ Name = "dispels";        DataType = "Dispels";       SourceId = $null;          IncludeResources = $false; HostilityType = $null;      FilterExpression = $null },
  [pscustomobject]@{ Name = "healing";        DataType = "Healing";       SourceId = $PlayerActorId; IncludeResources = $true;  HostilityType = $null;      FilterExpression = $null },
  [pscustomobject]@{ Name = "combatant-info"; DataType = "CombatantInfo"; SourceId = $PlayerActorId; IncludeResources = $false; HostilityType = $null;      FilterExpression = $null }
)

$datasetSummary = @()

foreach ($dataset in $datasetDefinitions) {
  $datasetDirectory = Join-Path $RunDirectory $dataset.Name
  New-Item -ItemType Directory -Force -Path $datasetDirectory | Out-Null

  $pageIndex = 0
  $nextPageTimestamp = $null
  $seenCursors = [System.Collections.Generic.HashSet[string]]::new()
  $totalEvents = 0
  $graphqlErrors = @()
  $truncated = $false

  while ($true) {
    if ($pageIndex -ge $MaxPagesPerDataset) {
      $truncated = $true
      break
    }

    $variables = @{
      code = $ReportCode
      fightIDs = @($FightId)
      dataType = $dataset.DataType
      limit = 1000
      translate = $false
      useAbilityIDs = $false
      useActorIDs = $false
    }

    if ($null -ne $dataset.SourceId) {
      $variables.sourceID = [int]$dataset.SourceId
    }
    if ($null -ne $nextPageTimestamp) {
      $variables.startTime = [double]$nextPageTimestamp
    }
    if ($dataset.IncludeResources) {
      $variables.includeResources = $true
    }
    if (-not [string]::IsNullOrWhiteSpace([string]$dataset.HostilityType)) {
      $variables.hostilityType = [string]$dataset.HostilityType
    }
    if (-not [string]::IsNullOrWhiteSpace([string]$dataset.FilterExpression)) {
      $variables.filterExpression = [string]$dataset.FilterExpression
    }

    $pageEnvelope = Invoke-WclGraphQl `
      -OperationName "ReportEvents" `
      -Query $EventsQuery `
      -Variables $variables

    $pagePath = Join-Path $datasetDirectory ("page-{0:D3}.json" -f $pageIndex)
    Write-JsonFile -Value $pageEnvelope -Path $pagePath

    if ($pageEnvelope.response.errors) {
      $graphqlErrors += @($pageEnvelope.response.errors)
      break
    }

    $eventsNode = $pageEnvelope.response.data.reportData.report.events
    $events = @($eventsNode.data)
    $totalEvents += $events.Count

    $next = $eventsNode.nextPageTimestamp
    if ($null -eq $next) {
      break
    }

    $cursorKey = [string]$next
    if (-not $seenCursors.Add($cursorKey)) {
      $truncated = $true
      break
    }

    $nextPageTimestamp = [double]$next
    $pageIndex += 1
  }

  $datasetSummary += [pscustomobject]@{
    name = $dataset.Name
    dataType = $dataset.DataType
    sourceId = $dataset.SourceId
    includeResources = [bool]$dataset.IncludeResources
    hostilityType = $dataset.HostilityType
    filterExpression = $dataset.FilterExpression
    pageCount = (Get-ChildItem -Path $datasetDirectory -Filter "page-*.json").Count
    eventCountBeforeWorkerDeduplication = $totalEvents
    truncated = $truncated
    graphqlErrorCount = $graphqlErrors.Count
  }
}

$afterRate = Invoke-WclGraphQl `
  -OperationName "RateLimitData" `
  -Query $RateLimitQuery `
  -Variables @{}
Write-JsonFile -Value $afterRate -Path (Join-Path $RunDirectory "rate-limit-after.json")

$exportManifest = [ordered]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  endpoints = @{
    token = $TokenUrl
    graphql = $GraphQlUrl
  }
  target = @{
    reportCode = $ReportCode
    fightId = $FightId
    characterName = $CharacterName
    realmSlug = $RealmSlug
    region = $Region
    zoneId = $ZoneId
  }
  resolved = @{
    reportRevision = $report.revision
    visibility = $report.visibility
    zone = $report.zone
    fight = @{
      id = $fight.id
      encounterID = $fight.encounterID
      name = $fight.name
      keystoneLevel = $fight.keystoneLevel
      keystoneBonus = $fight.keystoneBonus
      startTime = $fight.startTime
      endTime = $fight.endTime
    }
    playerActorId = $PlayerActorId
    ownedPetActorIds = $OwnedPetActorIds
  }
  datasets = $datasetSummary
  security = @{
    accessTokenWrittenToDisk = $false
    clientSecretWrittenToDisk = $false
  }
}

Write-JsonFile -Value $exportManifest -Path (Join-Path $RunDirectory "export-manifest.json")

if (Test-Path $ZipPath) {
  Remove-Item -Force $ZipPath
}
Compress-Archive -Path (Join-Path $RunDirectory "*") -DestinationPath $ZipPath -CompressionLevel Optimal

Write-Host ""
Write-Host "WCL export completed."
Write-Host "Directory: $RunDirectory"
Write-Host "ZIP:       $ZipPath"
Write-Host "Actor ID:  $PlayerActorId"
Write-Host "Pet IDs:   $($OwnedPetActorIds -join ', ')"
