# Product scope — M+ Trust Factor

## What it is

**M+ Trust Factor** predicts probable Mythic+ player reliability when composing a public group (pug).

It should:

- reduce invites where rating overstates contribution;
- surface excellent non-meta players above mediocre meta players;
- make uncertainty and evidence coverage visible;
- never present boost suspicion as a proven accusation.

Primary audience: roughly the top 20% of Mythic+ players who pug.

## Naming

| Term | Meaning |
|------|---------|
| **M+ Trust Factor** | Product name |
| **Trust Score** | Published, versioned score artifact for a character |
| **M+TS** | Short mark / shorthand |

Do not treat “Trust Factor” and “Trust Score” as interchangeable product names.

## Public skill dimensions

Exactly four public skill dimensions for DPS, tanks and healers:

1. Performance
2. Survival
3. Utility
4. Experience

Performance is currently damage-oriented for all roles (timer relevance). No separate public healer-HPS or tank-specific public model in this programme.

Authenticity / boost suspicion is a **separate** product pillar (flag + evidence), not a fifth skill dimension.

## Out of scope (near term)

- Production deployment until test is clean (`doc/operations/test-environment.md`, `doc/operations/ci-cd.md`).
- Forced grade quotas at assignment time.
- Changing missing-data mathematics without a new model version and explicit approval.

## Canonical decisions

Product decisions live under [`doc/product/`](./). Completed prompts are deleted after useful decisions are incorporated here; Git history is the archive.
