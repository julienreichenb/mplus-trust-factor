import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import luaparse from "luaparse";

const ADDON_DIR = resolve(
  join(dirname(fileURLToPath(import.meta.url)), "../../../addon/MPlusTrust"),
);

function collectLuaFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...collectLuaFiles(full));
    } else if (entry.endsWith(".lua")) {
      files.push(full);
    }
  }
  return files;
}

function main(): void {
  const files = collectLuaFiles(ADDON_DIR);
  const errors: string[] = [];

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    try {
      luaparse.parse(source, { wait: false, luaVersion: "5.1" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${file}: ${message}`);
    }
  }

  if (errors.length > 0) {
    console.error(JSON.stringify({ status: "error", errors }, null, 2));
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify({ status: "ok", checked: files.length }, null, 2));
}

main();
