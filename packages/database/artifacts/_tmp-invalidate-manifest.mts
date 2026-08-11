import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

/**
 * Gate-only: insert a newer incomplete decoy manifest so findFirst skips the
 * immutable complete one and discovery must call aliased encounterRankings.
 */
const prisma = new PrismaClient();
const PRIOR_ID = "d3268aeb-0f78-4b84-b7d4-3b1c0b445c41";

async function main() {
  const prior = await prisma.evidenceManifest.findUnique({
    where: { id: PRIOR_ID },
    include: { slots: true },
  });
  if (!prior) throw new Error(`prior manifest missing: ${PRIOR_ID}`);

  const doc = structuredClone(prior.document) as {
    selectedSlotCount: number;
    slots: Array<{ state: string }>;
    [k: string]: unknown;
  };
  for (const slot of doc.slots) {
    if (slot.state === "SELECTED") slot.state = "EMPTY";
  }
  doc.selectedSlotCount = 0;
  doc.gateForceRediscover = true;

  const contentHash = createHash("sha256")
    .update(`gate-force-rediscover:${PRIOR_ID}:${Date.now()}:${randomUUID()}`)
    .digest("hex");

  const created = await prisma.evidenceManifest.create({
    data: {
      characterId: prior.characterId,
      seasonId: prior.seasonId,
      specializationId: prior.specializationId,
      role: prior.role,
      refreshContractHash: prior.refreshContractHash,
      selectorVersion: prior.selectorVersion,
      highKeyPolicyId: prior.highKeyPolicyId,
      evidenceCutoffAt: prior.evidenceCutoffAt,
      expectedSlotCount: prior.expectedSlotCount,
      selectedSlotCount: 0,
      coverageState: "INCOMPLETE",
      schemaVersion: prior.schemaVersion,
      contentHash,
      document: doc as object,
      frozenAt: new Date(),
      slots: {
        create: prior.slots.map((s) => ({
          dungeonId: s.dungeonId,
          slotIndex: s.slotIndex,
          state: "EMPTY",
          dimensionValidity: s.dimensionValidity ?? {},
          invalidReasons: s.invalidReasons ?? [],
        })),
      },
    },
  });

  console.log(
    JSON.stringify({
      decoyCreated: true,
      decoyId: created.id,
      priorId: PRIOR_ID,
      selectedSlotCount: created.selectedSlotCount,
      frozenAt: created.frozenAt,
    }),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
