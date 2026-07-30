# IAM and admin

## Identity

- Authorization key: immutable internal **user ID** or Battle.net OAuth **subject**.
- BattleTag / email / character name are display or search attributes only — never grant keys.

## First-admin bootstrap

CLI: `apps/api/src/iam/grant-admin.cli.ts` (wired via package scripts / `pnpm` IAM grant helpers).

Accepts exactly one of:

- `--user-id <uuid>`
- `--battlenet-subject <provider-subject>`

Bootstrap must be idempotent and external to the protected admin UI. After bootstrap, roles are managed from the website. Hiding nav is **not** security — routes stay server-protected.

## Environment notes

- Test already contains the user’s Battle.net login.
- Local may not yet.

## Related surfaces

- Admin score models UI: `apps/web/src/pages/AdminModelsPage.vue`
- Permission prehandlers + audit events in API
- Prisma role/permission tables
