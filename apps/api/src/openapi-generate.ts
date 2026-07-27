import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "@mplus/config";
import { buildApp } from "./app.js";

const env = loadEnv();
const app = await buildApp({ env });
await app.ready();
const spec = app.swagger();
const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "openapi.json");
await writeFile(outPath, JSON.stringify(spec, null, 2), "utf8");
await app.close();
console.log(`OpenAPI written to ${outPath}`);
