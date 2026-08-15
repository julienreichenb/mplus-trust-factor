import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { seedProductionFaq } from "./seed-faq.js";

function loadRootEnv(): void {
  const rootEnv = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../.env");
  if (!existsSync(rootEnv) || process.env.DATABASE_URL) {
    return;
  }
  for (const line of readFileSync(rootEnv, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadRootEnv();

const prisma = new PrismaClient();

try {
  const report = await seedProductionFaq(prisma);
  console.log(
    `FAQ seed complete: inserted=${report.inserted} skipped=${report.skipped} total=${report.ids.length}`,
  );
  console.log(
    "Insert-missing only: existing titles, descriptions, publication, and positions are left unchanged.",
  );
  console.log(
    "If an admin deleted a seeded row, rerunning recreates that stable id with the original catalog copy.",
  );
} finally {
  await prisma.$disconnect();
}
