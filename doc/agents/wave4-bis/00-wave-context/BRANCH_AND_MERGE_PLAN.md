# Branch and Merge Plan

## Preparation

1. Merge Agent 36 into the integration branch.
2. Confirm that `c47c339` is included.
3. Run database generation, migrations, build and tests.
4. Create the Wave 4.3 integration branch.

```powershell
git checkout integration/wave4.2
git merge --no-ff agent/wave4.6-persistence-refresh-hardening
git checkout -b integration/wave4.3
```

## Worktrees

```powershell
git worktree add -b agent/wave4.3-experience `
  "..-experience-rework" `
  integration/wave4.3

git worktree add -b agent/wave4.3-battlenet-iam `
  "..8-battlenet-iam" `
  integration/wave4.3

git worktree add -b agent/wave4.3-refresh-orchestration `
  "..9-refresh-orchestration" `
  integration/wave4.3

git worktree add -b agent/wave4.3-cicd-vps `
  ".. -cicd-vps" `
  integration/wave4.3
```

## Recommended merge order

1. Experience
2. Battle.net OAuth/IAM
3. Refresh orchestration
4. CI/CD

CI/CD may be developed in parallel but should merge after resolving workflow and Docker changes introduced by other branches.

## Agent 35

Do not merge the full Utility branch while Utility remains experimental.

Agent 35 should merge from Wave 4.3 periodically:

```powershell
git checkout agent/wave4.5-wcl-utility-probe
git merge integration/wave4.3
```

Shared WCL ingestion may later be extracted into a production-safe commit or branch separate from Utility scoring experiments.
