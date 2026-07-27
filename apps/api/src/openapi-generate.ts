import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "@mplus/config";
import { buildApp } from "./app.js";
import { createApiContainer } from "./container.js";

const env = loadEnv();
// `skipQueues` avoids opening a real Redis/BullMQ connection just to generate the OpenAPI document.
const container = createApiContainer(env, { skipQueues: true });
const app = await buildApp({ env, container });
await app.ready();
const spec = app.swagger();
const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "openapi.json");
await writeFile(outPath, JSON.stringify(spec, null, 2), "utf8");
await app.close();
console.log(`OpenAPI written to ${outPath}`);
