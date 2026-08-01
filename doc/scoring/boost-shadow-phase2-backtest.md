# Boost shadow Phase 2 — offline / backtest harness

Shadow-only research harness around Phase 1 feature extractors.

Runtime: `packages/scoring/src/boost-shadow/backtest/`.  
Persisted read adapter: `tools/boost-shadow-backtest/load-persisted-evidence.ts`.

**Not** a production scoring path. Does **not** write authenticity, Trust Score, red flags, addon bits, or `BoostFeatureSnapshot`.

## Guarantees

| Constraint | Status |
|------------|--------|
| Shadow-only | yes |
| Production score effect | none |
| Authenticity write-back | none |
| Public flags | none |
| Addon change | none |
| Provider calls | none |
| Database migration | none |
| Verified ownership usage | none (Phase 4) |
| Model activation | none |

## CLI

```bash
pnpm --filter @mplus/scoring run build
pnpm --filter @mplus/scoring run boost-shadow:backtest -- --fixture --out ./tmp/boost-shadow-phase2
pnpm --filter @mplus/scoring run boost-shadow:backtest -- --bundle ./path/to/bundle.json --out ./tmp/boost-shadow-phase2 --public-safe
```

Run twice on the same fixture with fixed `generatedAt` — JSON/CSV/MD are byte-stable.

## Manifest schema (`boost-shadow-cohort-v1`)

Private runs use **stable internal `characterId`** values. Do not commit real player identities.

```ts
interface BoostShadowCohortManifestV1 {
  schemaVersion: "boost-shadow-cohort-v1";
  cohortId: string;
  description: string;
  createdAt: string; // ISO
  highKeyPolicyVersion: "high-key-v1-eval"; // shared Phase 1 policy
  seasonId: string;
  members: Array<{
    memberId: string;
    characterId: string;
    role?: "DPS" | "TANK" | "HEALER" | null;
    keyBand?: string | null;
    label?: ResearchLabelV1 | null;
    evaluationCutoff?: string | null; // ISO; blocks future leakage
  }>;
}
```

Operator-facing region/realm/name refs (`boost-shadow-operator-input-v1`) must be resolved to `characterId` **before** building the private manifest.

## Evidence bundle (`boost-shadow-evidence-bundle-v1`)

```ts
interface BoostShadowEvidenceBundleV1 {
  schemaVersion: "boost-shadow-evidence-bundle-v1";
  manifest: BoostShadowCohortManifestV1;
  evidenceByMemberId: Record<string, BoostShadowMemberEvidenceV1>;
  generatedAt: string;
  source: "fixture" | "persisted_export";
}
```

Each member package includes persisted runs, optional rating snapshots, and read-only production authenticity compare fields. **Ownership evidence is rejected** in Phase 2.

## Report schema (`boost-shadow-backtest-report-v1`)

Artifacts: `report.json`, `report.csv`, `report.md`, plus `report.public.*` (identity-redacted).

Includes: feature availability/missingness, distributions, correlation matrix, pairwise overlap, label distribution, confusion/PR (research labels only), temporal stability, role/key-band slices, fixed-team vs repeated-stronger analysis, authenticity compare-only, evidence coverage, split provenance.

Experimental classifier is labelled `OFFLINE_NON_PRODUCT` — not a production boost probability.

## Experiment parameters (hypotheses)

`BoostShadowExperimentParamsV1` documents offline hypotheses (holdout fraction, pattern bands, experimental rule thresholds). Phase 1 high-key / feature constants remain authoritative for extraction.

## Known evidence limitations

- `RunParticipant.mythicRatingAtRun` is often sparse; missing stays omitted (not zero).
- `CharacterSnapshot` has no native `seasonId`; Phase 2 attaches the manifest season **only after** authoritative `Season.startsAt`/`endsAt` window filtering (and `evaluationCutoff`). Missing `startsAt` fails closed (snapshot fallback omitted).
- Production authenticity is compare-only and **as-of** each member's cutoff (`calculatedAt <= evaluationCutoff`) — **never** ground truth.
- Split metadata (`latestRunAt`, cohort fingerprint, duplicates, coverage) uses the same as-of filter so future runs cannot influence assignment.
- Verified-alt mitigation is out of scope until Phase 4.
- Historical ownership link/unlink reconstruction is incomplete in the live schema.

## Decisions still requiring approval before Phase 3

1. Migration for private `BoostFeatureSnapshot` (or analysis-batch equivalent).
2. Retention TTL for shadow diagnostics.
3. Any draft ScoreModel / analysis-batch adapter (Phase 5+).
4. Wiring verified ownership into public reroll flags (forbidden in shadow; privacy/product approval).
5. Final product thresholds (future model decision — not Phase 2 experiment params).
