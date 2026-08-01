---
purpose: cursor-agent-implementation-prompt
project: mplus-trust-factor
repository: julienreichenb/mplus-trust-factor
generated: 2026-08-01
---


# Prompt 15 — V2 cutover, destructive test reset, and legacy cleanup

## Preconditions

- all V2 stages green;
- calibration approved;
- test rollout accepted;
- backup and rollback validated;
- explicit user authorization.

## Objective

Cut test to V2, optionally reset experimental persistence, and retire V1 safely.

## Required plan

- exact tables/data retained, exported, dropped, rebuilt;
- calibration label export/import;
- static catalog/season seeds;
- migration and reset commands;
- environment guards;
- worker/API downtime plan;
- V2 model activation separate from migration;
- public pointer rebuild;
- post-cutover smoke and score cohort checks;
- rollback to previous model/application/backup.

## Cleanup

After stable acceptance:

- stop V1 writes;
- remove dead selectors and inline pipeline paths;
- remove obsolete flags/contracts;
- migrate or archive old reports;
- delete unreferenced artifacts by policy;
- update docs.

## Validation

- empty DB;
- upgraded/reset test DB;
- all full suites;
- representative live test cohort;
- services same image SHA;
- health/revision;
- queue drain;
- no provider duplication;
- addon artifacts restored correctly.

Stop before production deployment. Production requires separate explicit approval.
