/**
 * Tiny child used by isolated-runner lifecycle regressions.
 * Avoids shell-metacharacter issues from inline `node -e` scripts on Linux.
 */
const marker = process.env.MPLUS_ISOLATED_TEST_DB ?? "";
const url = process.env.DATABASE_URL ?? "";
const db = url.split("/").pop()?.split("?")[0] ?? "";
const raw = process.env.MPLUS_ISO_CHILD_EXIT;
const code = raw === undefined || raw === "" ? 1 : Number(raw);
console.log("ISO_OK");
console.log(marker);
console.log(db);
process.exit(Number.isFinite(code) ? code : 1);
