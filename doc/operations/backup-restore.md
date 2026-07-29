# Backup and restore (per environment)

## Paths

| Environment | Directory |
|-------------|-----------|
| prod | `/opt/mplus/prod/backups` (filenames `mplus-prod-…`) |
| test | `/opt/mplus/test/backups` (filenames `mplus-test-…`) |

## Backup

```bash
./infra/scripts/backup-postgres.sh prod
./infra/scripts/backup-postgres.sh test
```

Refuses to run without `prod|test`.

## Restore

```bash
./infra/scripts/restore-postgres.sh test ./mplus-test-….sql.gz \
  'postgresql://mplus_test:…@…/mplus_trust_test_restore'
```

Safeguards:

- Missing/invalid environment → refuse
- Production-looking target URL → requires `RESTORE_CONFIRM=production`
- Test dump → production URL → requires `RESTORE_TEST_INTO_PROD=1` **and** production confirm

## Local verification

```bash
bash infra/scripts/restore-test-local.sh prod
bash infra/scripts/restore-test-local.sh test
```
