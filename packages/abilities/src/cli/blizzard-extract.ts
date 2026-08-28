import { resolveWorkspacePath } from "../refresh/extract/workspace-path.js";
import { existsSync, readFileSync } from "node:fs";
import { BlizzardTokenManager, getRegionConfig, resolveRegionKey, type BlizzardRegionKey } from "@mplus/provider-blizzard";
import { writeJsonAtomic } from "../refresh/extract/atomic-write.js";
import {
  extractBlizzardRefreshSnapshot,
  BlizzardExtractionError,
} from "../refresh/extract/blizzard-collector.js";

function arg(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  return idx >= 0 ? argv[idx + 1] : undefined;
}

const argv = process.argv.slice(2);
const regionKey = resolveRegionKey(arg(argv, "--region") ?? "eu") as BlizzardRegionKey;
const locale = arg(argv, "--locale") ?? getRegionConfig(regionKey).defaultLocale;
const out = arg(argv, "--out");
const spellIds = new Set(
  (arg(argv, "--spell-ids") ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0),
);
const fromSimc = arg(argv, "--from-simc-snapshot");
const wowBuild = arg(argv, "--wow-build");
if (fromSimc) {
  if (!existsSync(resolveWorkspacePath(fromSimc))) {
    console.error(`ERROR: SimC snapshot not found: ${fromSimc}`);
    process.exit(2);
  }
  const simc = JSON.parse(readFileSync(resolveWorkspacePath(fromSimc), "utf8")) as { spells?: { spellId?: number }[] };
  for (const spell of simc.spells ?? []) {
    if (Number.isInteger(spell.spellId) && (spell.spellId ?? 0) > 0) spellIds.add(spell.spellId!);
  }
}

if (!out) {
  console.error(`Usage:
  pnpm ability-catalog:blizzard:extract -- --region eu --locale en_GB --out snapshot.json [--spell-ids 12472,15286] [--from-simc-snapshot simc.json]

Uses BLIZZARD_CLIENT_ID / BLIZZARD_CLIENT_SECRET. Tooling only; not character refresh.`);
  process.exit(2);
}

const clientId = process.env.BLIZZARD_CLIENT_ID ?? "";
const clientSecret = process.env.BLIZZARD_CLIENT_SECRET ?? "";
if (!clientId || !clientSecret) {
  console.error("ERROR AUTH_FAILURE: BLIZZARD_CLIENT_ID and BLIZZARD_CLIENT_SECRET are required");
  process.exit(1);
}

const region = getRegionConfig(regionKey);
const tokens = new BlizzardTokenManager({ clientId, clientSecret });

try {
  const snapshot = await extractBlizzardRefreshSnapshot({
    region: regionKey,
    locale,
    namespace: region.staticNamespace,
    spellIds: [...spellIds],
    wowBuild: wowBuild ?? undefined,
    getter: async ({ path }) => {
      const token = await tokens.getAccessToken();
      const url = new URL(path.replace(/^\//, ""), `${region.apiHost}/`);
      url.searchParams.set("namespace", region.staticNamespace);
      url.searchParams.set("locale", locale);
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      let data: unknown = {};
      try {
        data = await response.json();
      } catch {
        data = {};
      }
      return { statusCode: response.status, data };
    },
  });
  writeJsonAtomic(resolveWorkspacePath(out), snapshot);
  console.log(
    `Wrote PINNED Blizzard snapshot ${out} namespace=${snapshot.namespace} locale=${snapshot.locale} classes=${snapshot.playableClasses?.length ?? 0} specs=${snapshot.playableSpecializations?.length ?? 0} races=${snapshot.playableRaces?.length ?? 0} spellIdentities=${snapshot.spells?.length ?? 0} requestedIds=${spellIds.size} (spell identity never claims spec toolkit completeness)`,
  );
} catch (error) {
  if (error instanceof BlizzardExtractionError) {
    console.error(`ERROR ${error.code}: ${error.message}`);
    process.exit(1);
  }
  throw error;
}
