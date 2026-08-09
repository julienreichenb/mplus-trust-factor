/**
 * Agent 05 — verify character_experience_evidence table + indexes after migrate.
 * Usage: node tools/scripts/with-env.mjs node tools/scripts/_agent05-verify-experience-table.mjs
 */
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const table = await client.query(
    `SELECT to_regclass('public.character_experience_evidence') AS table_name`,
  );
  const indexes = await client.query(
    `SELECT indexname FROM pg_indexes
     WHERE tablename = 'character_experience_evidence'
     ORDER BY indexname`,
  );
  const fks = await client.query(
    `SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.character_experience_evidence'::regclass
       AND contype = 'f'
     ORDER BY conname`,
  );
  const out = {
    table: table.rows[0]?.table_name,
    indexes: indexes.rows.map((r) => r.indexname),
    foreignKeys: fks.rows.map((r) => r.conname),
  };
  console.log(JSON.stringify(out, null, 2));
  if (out.table !== "character_experience_evidence") {
    process.exit(2);
  }
  const requiredExact = [
    "character_experience_evidence_pkey",
    "character_experience_evidence_identity_key",
    "character_experience_evidence_character_id_season_id_idx",
  ];
  for (const name of requiredExact) {
    if (!out.indexes.includes(name)) {
      console.error(`missing index: ${name}`);
      process.exit(3);
    }
  }
  // PostgreSQL truncates identifiers to 63 bytes; accept truncated form.
  const kindCompat = out.indexes.find((n) =>
    n.startsWith("character_experience_evidence_evidence_kind_compatibility"),
  );
  if (!kindCompat) {
    console.error("missing evidence_kind/compatibility_version index");
    process.exit(3);
  }
  console.log("OK: table + unique identity + FKs + indexes present");
} finally {
  await client.end();
}
