import { resolveWorkspacePath } from "../refresh/extract/workspace-path.js";
import { isSimcCommitSha } from "../refresh/snapshot-identity.js";
import { writeJsonAtomic } from "../refresh/extract/atomic-write.js";
import { extractSimcSpellQuerySnapshot, SimcExtractionError } from "../refresh/extract/simc-runner.js";
import { resolveCatalogSimcBinary, SimcNotConfiguredError } from "../refresh/extract/simc-path.js";
import { SIMC_SPELLQUERY_EXPRESSIONS } from "../refresh/extract/simc-plan.js";

function arg(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  return idx >= 0 ? argv[idx + 1] : undefined;
}

const argv = process.argv.slice(2);
const simcBinArg = arg(argv, "--simc-bin");
/** @deprecated — use --expected-simc-revision */
const legacyRevision = arg(argv, "--simc-revision");
const expectedRevision = arg(argv, "--expected-simc-revision") ?? legacyRevision;
const branch = arg(argv, "--simc-branch");
const out = arg(argv, "--out");

if (!out) {
  console.error(`Usage:
  pnpm ability-catalog:simc:extract -- --simc-bin <simc.exe> --out <snapshot.json> [--expected-simc-revision <40-char-sha>] [--simc-branch name]

Binary self-identification is the source of truth (version, git revision, WoW build, LIVE/PTR).
--expected-simc-revision is an optional CI assertion, not the identity source.
SpellQuery expressions: ${SIMC_SPELLQUERY_EXPRESSIONS.join(", ")}`);
  process.exit(2);
}

if (expectedRevision && !isSimcCommitSha(expectedRevision) && expectedRevision.length !== 40) {
  // Allow prefix only when it is a hex prefix; full SHA preferred for assertions.
  if (!/^[0-9a-f]{7,40}$/i.test(expectedRevision)) {
    console.error("ERROR: --expected-simc-revision must be a git commit SHA (hex)");
    process.exit(2);
  }
}

let simcBin: string;
try {
  simcBin = resolveCatalogSimcBinary({
    overridePath: simcBinArg ? resolveWorkspacePath(simcBinArg) : null,
  }).path;
} catch (error) {
  if (error instanceof SimcNotConfiguredError) {
    console.error(`ERROR ${error.code}: ${error.message}`);
    process.exit(2);
  }
  throw error;
}

try {
  const snapshot = await extractSimcSpellQuerySnapshot({
    simcBin,
    expectedSimcRevision: expectedRevision,
    simcBranch: branch,
  });
  writeJsonAtomic(resolveWorkspacePath(out), snapshot);
  console.log(
    `Wrote PINNED SimC snapshot ${out} sha=${snapshot.simcCommitSha} precision=${snapshot.binaryIdentity?.revisionPrecision} app=${snapshot.binaryIdentity?.applicationVersion ?? "?"} wowBuild=${snapshot.binaryIdentity?.wowBuild ?? "?"} dataMode=${snapshot.binaryIdentity?.dataMode} binaryRev=${snapshot.binaryIdentity?.gitRevision} spells=${snapshot.spells.length} processes=${snapshot.extractionStats?.processCount} xmlBytes=${snapshot.extractionStats?.rawXmlBytes} durationMs=${snapshot.extractionStats?.durationMs}`,
  );
} catch (error) {
  if (error instanceof SimcExtractionError) {
    console.error(`ERROR ${error.code}: ${error.message}`);
    if (error.stderr) console.error(error.stderr);
    if (error.stdout) console.error(error.stdout);
    process.exit(1);
  }
  throw error;
}
