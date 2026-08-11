import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../../../tools/fixtures/warcraftlogs");

export type WclFixtureScenario =
  | "character-with-rankings"
  | "wallidrixe-performance"
  | "hidden-character"
  | "no-public-logs"
  | "same-latest-highest"
  | "public-mplus-report"
  | "report-revision-bump"
  | "paginated-events"
  | "rate-limit-near-stop"
  | "graphql-partial-errors"
  | "invalid-json-scalar"
  | "archived-report-unavailable"
  | "private-reports-skipped"
  | "ambiguous-actor-report";

export interface WclFixtureBundle {
  scenario: WclFixtureScenario;
  resolveCharacter: unknown;
  zoneRankings: unknown;
  /** Optional points_and_damage payload for Performance (production path). */
  zoneRankingsPointsAndDamage?: unknown;
  rateLimitData: unknown;
  report?: unknown;
  events?: Record<string, unknown>;
}

const SCENARIO_FILES: Record<WclFixtureScenario, string> = {
  "character-with-rankings": "character-with-rankings.json",
  "wallidrixe-performance": "wallidrixe-performance.json",
  "hidden-character": "hidden-character.json",
  "no-public-logs": "no-public-logs.json",
  "same-latest-highest": "same-latest-highest.json",
  "public-mplus-report": "public-mplus-report.json",
  "report-revision-bump": "report-revision-bump.json",
  "paginated-events": "paginated-events.json",
  "rate-limit-near-stop": "rate-limit-near-stop.json",
  "graphql-partial-errors": "graphql-partial-errors.json",
  "invalid-json-scalar": "invalid-json-scalar.json",
  "archived-report-unavailable": "archived-report-unavailable.json",
  "private-reports-skipped": "private-reports-skipped.json",
  "ambiguous-actor-report": "ambiguous-actor-report.json",
};

export function resolveFixtureRoot(): string {
  return FIXTURE_ROOT;
}

export function loadFixtureScenario(scenario: WclFixtureScenario): WclFixtureBundle {
  const file = join(FIXTURE_ROOT, SCENARIO_FILES[scenario]);
  if (!existsSync(file)) {
    throw new Error(`Missing WCL fixture: ${file}`);
  }
  const raw = JSON.parse(readFileSync(file, "utf8")) as WclFixtureBundle;
  return raw;
}

export function loadFixtureByIdentity(name: string, realmSlug: string): WclFixtureBundle {
  const normalizedName = name.toLowerCase();
  const normalizedRealm = realmSlug.toLowerCase();

  if (normalizedName === "hiddenplayer") {
    return loadFixtureScenario("hidden-character");
  }
  if (normalizedName === "nologsplayer") {
    return loadFixtureScenario("no-public-logs");
  }
  if (normalizedName === "sameplayer") {
    return loadFixtureScenario("same-latest-highest");
  }
  if (normalizedName === "privateplayer") {
    return loadFixtureScenario("private-reports-skipped");
  }
  if (normalizedName === "wallidrixe" || normalizedRealm === "archimonde") {
    return loadFixtureScenario("wallidrixe-performance");
  }
  if (normalizedName === "fixtureplayer" || normalizedRealm === "tarren-mill") {
    return loadFixtureScenario("character-with-rankings");
  }
  return loadFixtureScenario("no-public-logs");
}

export function loadReportFixture(reportCode: string): WclFixtureBundle {
  if (reportCode === "AbCdEf12XyZ3") {
    return loadFixtureScenario("public-mplus-report");
  }
  if (reportCode === "RevBump999") {
    return loadFixtureScenario("report-revision-bump");
  }
  if (reportCode === "PageEvt888") {
    return loadFixtureScenario("paginated-events");
  }
  if (reportCode === "AmbActor99") {
    return loadFixtureScenario("ambiguous-actor-report");
  }
  if (reportCode === "Archived001") {
    return loadFixtureScenario("archived-report-unavailable");
  }
  return loadFixtureScenario("public-mplus-report");
}
