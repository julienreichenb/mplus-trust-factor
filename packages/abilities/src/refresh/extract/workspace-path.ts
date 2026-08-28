import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

export function findWorkspaceRoot(start = process.cwd()): string {
  let dir = start;
  while (true) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

export function resolveWorkspacePath(pathValue: string): string {
  if (isAbsolute(pathValue)) return pathValue;
  return resolve(findWorkspaceRoot(), pathValue);
}
