#!/usr/bin/env node
/**
 * Remove package dist/ and *.tsbuildinfo so the next `pnpm build` cannot skip emit
 * after a manual dist wipe (TypeScript incremental assumes outputs still exist).
 */
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const roots = ["packages", "apps", "tools"];

function walk(dir, visit) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "dist") {
        visit(full, "dir");
        continue;
      }
      walk(full, visit);
    } else if (entry.endsWith(".tsbuildinfo")) {
      visit(full, "file");
    }
  }
}

let removed = 0;
for (const root of roots) {
  walk(root, (path) => {
    rmSync(path, { recursive: true, force: true });
    removed += 1;
  });
}
console.log(`clean:dist removed ${removed} path(s)`);
