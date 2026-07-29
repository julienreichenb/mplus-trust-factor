/**
 * Server-side first-admin bootstrap (no HTTP endpoint).
 *
 *   pnpm iam:grant-admin -- --user-id <uuid>
 *   pnpm iam:grant-admin -- --battlenet-subject <provider-subject>
 */
import { loadEnv } from "@mplus/config";
import { createPrismaClient } from "@mplus/database";
import { grantAdminRole } from "./grant-admin.js";

function usage(): never {
  console.error(`Usage:
  pnpm iam:grant-admin -- --user-id <uuid>
  pnpm iam:grant-admin -- --battlenet-subject <provider-subject>

Immutable identifiers only. BattleTag, character name, and email are rejected.

After first Battle.net OAuth login, retrieve your ids:
  GET /api/v1/auth/me          → user.id
  GET /api/v1/me/battlenet     → account.providerAccountId
`);
  process.exit(2);
}

function parseArgs(argv: string[]) {
  let userId: string | undefined;
  let battlenetSubject: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--user-id") {
      userId = argv[++i];
      continue;
    }
    if (arg === "--battlenet-subject") {
      battlenetSubject = argv[++i];
      continue;
    }
    if (arg === "--help" || arg === "-h") usage();
    console.error(`Unknown or unsupported argument: ${arg}`);
    usage();
  }
  if (Boolean(userId) === Boolean(battlenetSubject)) {
    console.error("Provide exactly one of --user-id or --battlenet-subject.");
    usage();
  }
  return { userId, battlenetSubject };
}

async function main(): Promise<void> {
  const { userId, battlenetSubject } = parseArgs(process.argv.slice(2));
  const env = loadEnv();
  const prisma = createPrismaClient(env.DATABASE_URL);

  try {
    const result = await grantAdminRole(
      prisma,
      userId
        ? { kind: "userId", userId }
        : { kind: "battlenetSubject", subject: battlenetSubject! },
      { sessionSecret: env.SESSION_SECRET, actorLabel: "pnpm iam:grant-admin" },
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          alreadyAdmin: result.alreadyAdmin,
          userId: result.userId,
          displayName: result.displayName,
          battlenetSubject: result.battlenetSubject,
          battlenetAccountId: result.battlenetAccountId,
          role: result.roleKey,
          nextSteps: [
            "Refresh the session (re-sign-in or reload) and GET /api/v1/auth/me — permissions must include admin.*",
            "Set ADMIN_API_KEY_EMERGENCY_FALLBACK=false and restart the API",
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const code =
    error && typeof error === "object" && "code" in error ? String((error as { code: string }).code) : "GRANT_ADMIN_FAILED";
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ ok: false, code, message }, null, 2));
  process.exit(1);
});
