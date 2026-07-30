# Proposed canonical tree

Target layout after cleanup PRs (not applied by Agent 01).

```text
/
├── README.md                          # CANONICAL — monorepo quickstart
├── AGENTS.md                          # ADD — pointer to .agent-context + doc/architecture/parallel-ownership.md
├── .agent-context/                    # CANONICAL — programme decisions/rules (stabilization)
├── .cursor/
│   └── rules/
│       └── mpts-frontend-brand.mdc    # ADD from PR#1 consolidation
├── .github/workflows/
│   ├── ci.yml                         # CANONICAL
│   └── cd.yml                         # FIX — deploy test from main (Agent 05)
├── doc/                               # CANONICAL documentation root
│   ├── adr/
│   ├── agents/                        # KEEP handoffs; ARCHIVE wave packs when waves close
│   ├── api/
│   ├── architecture/
│   │   ├── frontend/                  # ADD — consolidated brand/UX (replaces docs/frontend)
│   │   ├── system.md
│   │   ├── database.md
│   │   └── …
│   ├── bootstrap/                     # CANONICAL archive of wave-1 starter pack
│   ├── contracts/
│   ├── operations/
│   ├── plans/
│   ├── research/
│   ├── scoring/
│   ├── security/
│   └── testing/
├── docs/
│   └── audits/                        # KEEP audit outputs; do not put product docs here long-term
├── agents/                            # ARCHIVE → eventually remove after AGENTS.md + doc/bootstrap suffice
├── apps/
│   ├── api/
│   ├── web/
│   │   ├── public/brand/              # ADD mark SVG
│   │   └── src/design-tokens.css      # SINGLE token file
│   └── worker/
├── packages/
│   └── providers/warcraftlogs/src/
│       ├── probe/                     # See probe-matrix.csv — tip = survival v1.1.1 + utility observed
│       ├── evidence/                  # CANONICAL shared evidence
│       ├── analysis/                  # CANONICAL production survival path
│       ├── discovery/
│       ├── live/
│       └── index.ts                   # Trim research-only exports in a later cleanup PR
├── tools/
│   ├── scripts/                       # KEEP wired scripts; Agent 12 drops §B DELETE_SAFE orphans
│   ├── fixtures/                      # KEEP; optional later unify providers/v1 vs flat (Agent 12)
│   └── addon-exporter/
├── addon/
├── infra/
└── tests/
```

## Explicit non-goals for the canonical tree (near term)

- Do not delete utility v1–v3.2-opportunity or survival v1/v1.1 probe stacks while `package.json` scripts and calibration still reference them.
- Do not delete `RAID` from contracts solely for docs cleanliness — weight-0 is the current runtime policy.
- Do not remove historical `doc/agents/wave*` until dependent worktrees/PRs are closed.

## Root bootstrap files

Move exclusivity to `doc/bootstrap/`. Root copies:

```text
AGENT-OUTPUT-TEMPLATE.txt
API-SOURCES-AND-REQUEST-BUDGETS.txt
ARCHITECTURE-AND-DB.txt
COMMON-CONTEXT.txt
ENVIRONMENT-AND-SECRETS.txt
PROCESS-FLOWS.txt
README-FIRST.txt
WAVE-EXECUTION-PLAN.txt
```

→ `ARCHIVE` / delete after confirming no external tooling requires the root paths (README-FIRST currently assumes root).
