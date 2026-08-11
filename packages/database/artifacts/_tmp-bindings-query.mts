import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const seasonId = "965c666a-7e90-42d1-8cc8-e9da6467d6d7";

async function main() {
  const rows = await prisma.seasonDungeon.findMany({
    where: { seasonId },
    include: { dungeon: true },
    orderBy: { dungeon: { slug: "asc" } },
  });
  const bindings = rows
    .map((r) => {
      const encounterId =
        r.dungeon.wclZoneOrEncounterId != null
          ? Number(r.dungeon.wclZoneOrEncounterId)
          : null;
      return {
        slug: r.dungeon.slug,
        encounterId:
          encounterId != null && Number.isFinite(encounterId) && encounterId > 0
            ? encounterId
            : null,
      };
    })
    .filter((b) => b.encounterId != null);
  console.log(
    JSON.stringify(
      {
        seasonDungeonRows: rows.length,
        encounterBindingCount: bindings.length,
        bindings,
      },
      null,
      2,
    ),
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
