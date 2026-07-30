# Standalone Cursor prompt — Agent 04

This prompt is self-contained. You are operating inside the dedicated Git worktree
for branch `agent/04-admin-rbac`.

You are Agent 04: Admin RBAC and Bootstrap for the M+ Trust Factor repository.

Work only in the assigned worktree and branch.
Read `.agent-context/AGENT-RULES.md`, `PROJECT-DECISIONS.md`,
`CURRENT-REPOSITORY-FINDINGS.md`, and `AGENT-OUTPUT-TEMPLATE.md` first.

Repository snapshot used to prepare this task: main at
`7c6c407cff5cb9d63253f9746cae68c78fcdbd11`.
Always inspect the current branch because dependencies may have changed the code.

## Mission

Make admin capabilities usable and securely enforced in local and test environments.

## Identity decision

- Authorization key: immutable internal user ID / Battle.net OAuth subject.
- BattleTag/email: searchable display attributes only.
- The user's Battle.net account already exists in test.
- The user has not yet logged in locally.

## Required first-admin bootstrap

Design an idempotent bootstrap that can run during deployment/startup when explicitly configured.

Requirements:
- accepts an immutable Battle.net subject or user UUID;
- never accepts BattleTag/email as the authorization key;
- no public HTTP endpoint for first-admin creation;
- safe to run repeatedly;
- fails loudly when configured identity is missing or ambiguous;
- creates an audit event;
- test environment can grant the existing user automatically via an environment-scoped secret/variable;
- local environment supports granting after first OAuth login;
- does not silently leave emergency API-key fallback enabled.

Do not commit the user's real subject or secrets.

## Website/admin requirements

- authenticated session exposes roles/permissions;
- navigation and routes show admin pages only to authorized admins;
- direct navigation by a normal user returns access denied;
- server routes remain the security boundary;
- spell/ability catalog admin page is visible and functional;
- score-model admin page remains protected;
- character force-refresh action is admin-only;
- normal users retain ordinary read/search/account functionality;
- admin writes create audit events.

Add a minimal admin user/role management screen:
- search by BattleTag or email;
- display immutable user ID and linked provider identity;
- grant/revoke allowed roles;
- prevent accidental removal of the last active admin or require an explicit safe override;
- never expose OAuth tokens or raw secrets.

## Useful files

- `packages/database/prisma/schema.prisma`
- `apps/api/src/iam/**`
- `apps/api/src/routes/admin.ts`
- `apps/api/src/services/admin-service.ts`
- `apps/api/src/iam/grant-admin.cli.ts`
- auth/session routes and DTOs
- `apps/web/src/pages/AdminModelsPage.vue`
- router/navigation/auth store
- ability catalog query/UI
- audit-event code
- environment schemas/examples and deploy templates

## Tests

- anonymous: 401;
- authenticated user without permission: 403;
- admin: 200/allowed;
- UI route guard;
- hidden admin navigation for non-admin;
- API remains protected if UI checks are bypassed;
- bootstrap idempotency;
- missing bootstrap target fails visibly;
- grant/revoke audit;
- last-admin protection;
- force refresh denied to normal users.

## Coordination

Agent 03 owns refresh policy. Implement only permission enforcement and UI placement for force refresh, using the agreed API contract.
Agent 09 will later own bulk-job administration.



---

# Embedded context: PROJECT-DECISIONS.md

# Canonical project decisions for this programme

## Product objective

M+ Trust Factor predicts probable player reliability at the moment a public Mythic+ group is composed.

It should:
- reduce the risk of inviting players whose rating overstates their actual contribution;
- surface excellent non-meta players above mediocre meta players;
- make uncertainty and evidence coverage visible;
- never present a boost suspicion as a proven accusation.

Primary audience: approximately the top 20% of Mythic+ players who pug.

## Roles and dimensions

The same four dimensions remain public for DPS, tanks and healers:

- Performance
- Survival
- Utility
- Experience

For now, Performance remains damage-oriented for all three roles because tank and healer damage matters to high-key timers.
Do not introduce a separate healer-HPS or tank-specific public model in this programme.

## Ranking

Short term:
- absolute score and grade thresholds.

Long term:
- absolute score plus population comparisons once the database is sufficiently rich.

The model should naturally tend toward a useful tier distribution; never force quotas at grade assignment time.

## Boost suspicion

Boost/authenticity remains a core product pillar.

Current policy:
- display a clear, prominent, probabilistic suspicion flag;
- include evidence and uncertainty;
- do not change the numeric score or cap the grade until the detector is calibrated.

## Missing data and U

- If available evidence makes calculation impossible: grade `U`.
- If calculation is possible but confidence is weak: publish the score/grade and visibly flag uncertainty.
- Missing dimensions must not become a hidden bonus through unrestricted weight redistribution.
- Any change to current missing-data mathematics requires explicit user approval and a new model version.

## Refresh policy

- A published Trust Score is fresh for 7 days.
- Reading a fresh profile is strictly read-only and creates no refresh job.
- A stale profile returns the last published score immediately and may enqueue exactly one background refresh.
- Repeated reads while a refresh exists reuse that job.
- A completed refresh must not be re-armed by another page view.
- Provider freshness and score freshness are distinct concepts.
- A failed refresh keeps the last published snapshot and applies retry/backoff.
- Manual force refresh is admin-only.

## Common evidence sample

Normal target:
- one canonical best run per active-season dungeon;
- at most 8 baseline detailed runs;
- Performance, Survival and Utility reuse common detailed evidence whenever possible.

Exceptional ceiling may be configurable up to 12, but normal Utility fallback is stricter.

## Utility fallback

Baseline:
- use shared scoring/Survival evidence first;
- do not make redundant WCL calls.

Only `INSUFFICIENT_EVIDENCE_RETRYABLE` may trigger fallback.
A valid complete sample with zero attributable positive actions must not trigger fallback.

Initial fallback cap:
- at most 4 extra runs;
- prefer missing/underrepresented dungeons;
- one extra run per dungeon before duplicating;
- stop as soon as publication criteria are met;
- enforce explicit request-cost and rate-budget accounting.

## Admin

- Technical identity is the immutable internal user ID or Battle.net OAuth subject.
- BattleTag/email are display/search attributes, not authorization keys.
- Test already contains the user's Battle.net login.
- Local does not yet contain it.
- First-admin bootstrap must be idempotent and external to the protected admin UI.
- After bootstrap, roles are managed from the website.
- Admin routes remain protected server-side; hiding navigation is not security.

## Score model lifecycle

- Models are immutable/versioned.
- Drafts may be edited and validated.
- Activation occurs from the admin website, is transactional and audited.
- The database is the source of truth for the active model.
- Environment variables may initialize an empty database only; they must not be required for normal activation.
- Activation queues a progressive `RECALCULATE_ONLY` cohort job, not a provider-heavy refresh storm.

## Bulk processing

One resumable orchestrator supports:

- `FULL_REFRESH`: provider retrieval plus score calculation.
- `RECALCULATE_ONLY`: reuse persisted compatible evidence and call no providers unless explicitly required by incompatibility.

Selection:
- `minMythicPlusScore = number`: process characters at or above threshold.
- `minMythicPlusScore = null`: process every character in the database.

It must be:
- idempotent;
- batched;
- resumable;
- deduplicated;
- observable;
- pausable/cancellable where practical;
- budget-aware;
- admin-only.

## Git and deployment

- Feature worktree → PR/CI → `main`.
- `main` automatically deploys the test environment.
- Future `prod` accepts reviewed merges from `main` and deploys production.
- No direct production deployment from feature branches.
- Production remains out of scope until test is clean.

## Calibration cohort

When Agent 11 starts:
- user supplies 24 characters: 8 DPS, 8 tank, 8 healer;
- within each role: 2 excellent, 2 good, 2 average, 2 weak/overrated;
- agent adds 24 stratified public profiles;
- initial cohort total: 48.

---

# Embedded context: CURRENT-REPOSITORY-FINDINGS.md

# Current repository findings

Snapshot inspected: `main` at `7c6c407cff5cb9d63253f9746cae68c78fcdbd11`.

## CI failure run

Known run:
`https://github.com/julienreichenb/mplus-trust-factor/actions/runs/30502572844`

Deterministic failures:

1. `vitest.config.ts` sets PostgreSQL to `localhost:5433`, while GitHub Actions exposes PostgreSQL on `localhost:5432`.
   - Failing test: `apps/api/src/health.test.ts`.
   - Result: `/health/ready` returns 503 instead of 200.

2. `apps/worker/src/shutdown.test.ts` expects four workers.
   - `apps/worker/src/processors.ts` now creates five:
     refresh, analyze, recalculate, addon export, discover-owned-characters.

The Docker and migration-guard jobs are skipped because they depend on the failed quality job.

## CD mismatch

`.github/workflows/cd.yml` currently triggers push deployment from `integration/wave4.3`, not `main`.

The current workflow also:
- can skip deploy when secrets are missing without failing the workflow;
- verifies `/health/live` rather than full readiness;
- still contains temporary branch policy examples;
- needs an explicit test-versus-production source-branch policy.

## Refresh hot path

`apps/api/src/services/character-service.ts`:
- `getProfile()` uses `character.lastPublicRefreshAt` and a provider-oriented TTL;
- stale reads call `enqueueRefresh`;
- provider-newer-than-score and refresh-contract mismatch also enqueue;
- the same page read can reach several enqueue paths;
- `searchCharacter()` also enqueues when stale.

The implementation needs one centralized decision result, not independent enqueue side effects.

Important related files:
- `apps/api/src/lib/freshness.ts`
- `apps/api/src/lib/profile-enrichment.ts`
- `apps/worker/src/orchestration/enqueue.ts`
- `apps/worker/src/dedupe.ts`
- job repository implementation
- account/profile frontend polling code
- `packages/database/prisma/schema.prisma`

## Utility

Production-candidate observed contribution currently lives around:
- `packages/providers/warcraftlogs/src/probe/utility-v3_2-observed-config.ts`
- `packages/providers/warcraftlogs/src/probe/utility-v3_2-observed-contribution.ts`
- shared evidence modules under `packages/providers/warcraftlogs/src/evidence/`
- orchestration in `apps/worker/src/orchestration/refresh-pipeline.ts`

Utility is one-sided:
- observed positive contribution can raise score above 50;
- absent observed actions do not lower below 50;
- complete zero contribution and insufficient evidence must be distinguished.

## IAM/admin

Existing foundations:
- normalized role/permission tables in Prisma;
- `apps/api/src/iam/grant-admin.cli.ts`;
- admin permission prehandlers and audit events;
- `apps/web/src/pages/AdminModelsPage.vue`;
- admin score-model and mechanic-rule routes.

The current grant CLI intentionally accepts immutable user ID or Battle.net subject only.

## Model lifecycle

Admin UI already clones, validates, saves and activates drafts.
However:
- backtest is a fixture placeholder;
- active-model lookup still depends in places on `ACTIVE_SCORE_MODEL_KEY`;
- activation lacks a general progressive cohort recalculation strategy.

## Front-end PR duplication

Open PRs:
- #1 `design/mpts-brand-ui-system`
- #2 `design/mpts-brand-system`

Do not merge either as-is.
Use #1 as structural base, incorporate useful detail from #2, correct outdated product facts and open one replacement PR.

---

# Embedded context: AGENT-RULES.md

# Mandatory rules for every agent

## Start

1. Confirm current branch and worktree.
2. Read:
   - `.agent-context/PROJECT-DECISIONS.md`
   - `.agent-context/CURRENT-REPOSITORY-FINDINGS.md`
   - `.agent-context/AGENT-OUTPUT-TEMPLATE.md`
3. Read repository root `AGENTS.md`, `.cursor/rules/**` and canonical docs if present.
4. Inspect actual code. Documentation is evidence, not authority when it conflicts with runtime code.
5. Write a short implementation plan in your first response and continue unless a stop condition applies.

## Scope discipline

- Own only the files and contracts described in your prompt.
- Do not opportunistically refactor unrelated modules.
- Do not reformat the whole repository.
- Preserve backward compatibility unless explicitly instructed otherwise.
- Prefer extracting pure policy functions and testing them over adding more conditionals to orchestration.
- Preserve provenance, reproducibility, score-model versioning and last-known-good publication.

## Testing

At minimum run the narrowest relevant tests plus:
- lint for changed areas;
- TypeScript typecheck;
- build for affected packages/apps.

Run full `pnpm test` when practical.
Record every command and result.

Never claim a live provider path works without actually testing it.
Never spend live WCL budget unless the prompt explicitly allows it.

## Git

- Work only in the assigned branch/worktree.
- Rebase on updated `origin/main` before final handoff if dependencies were merged during the run.
- Commit all intended changes.
- Leave no unexplained generated files.
- Do not merge.
- Do not delete the branch/worktree.

## Final response

Use the exact handoff template.
State failures and untested paths honestly.

---

# Embedded context: AGENT-OUTPUT-TEMPLATE.md

# Required final response template

## Agent
- ID:
- Branch:
- Worktree:
- Final commit SHA:

## Outcome
- `COMPLETE`
- `COMPLETE_WITH_MANUAL_VALIDATION`
- `BLOCKED`
- `NEEDS_FOLLOW_UP`

## Scope delivered
- concise bullets

## Files changed
- grouped by subsystem

## Architecture/behaviour changes
- explain observable behaviour and important contracts

## Database/migrations
- migration names
- backward compatibility
- empty-database validation
- existing-database validation
- or `None`

## Commands executed
```text
command
result
```

## Tests
- passed
- failed
- skipped and why

## Manual validation still required
- exact steps

## Risks and regressions considered
- concise bullets

## Deviations from prompt
- list each or `None`

## Suggested merge order/conflicts
- files likely to conflict
- required dependencies

## Cleanup
- untracked files:
- temporary files:
- worktree must remain until review: yes

---

# Final instruction

Start by confirming the current branch and worktree path. Read the repository's actual
code and current canonical documentation. Then provide a concise implementation plan
and execute the task. Do not merge or remove the worktree. End with the exact required
handoff template embedded above.
