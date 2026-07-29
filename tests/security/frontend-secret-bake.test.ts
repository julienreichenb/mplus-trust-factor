import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const forbiddenPatterns = [
  /VITE_ADMIN_API_KEY/i,
  /X-Admin-Api-Key/i,
  /x-admin-api-key/i,
];

const secretLikeValues = [
  process.env.ADMIN_API_KEY,
  process.env.SESSION_SECRET,
  process.env.PROVIDER_TOKEN_ENCRYPTION_SECRET,
  process.env.BLIZZARD_CLIENT_SECRET,
].filter((v): v is string => Boolean(v && v.length >= 8));

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

describe("frontend secret bake guard", () => {
  it("does not reference VITE_ADMIN_API_KEY or admin API key headers in SPA source", () => {
    const webSrc = join(root, "apps/web/src");
    const files = walk(webSrc).filter(
      (f) => /\.(ts|tsx|vue|js|mjs)$/.test(f) && !/\.test\.(ts|tsx|js)$/.test(f),
    );
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const pattern of forbiddenPatterns) {
        if (pattern.test(text)) {
          offenders.push(`${relative(root, file)} matches ${pattern}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("web .env.example does not define VITE_ADMIN_API_KEY", () => {
    const example = readFileSync(join(root, "apps/web/.env.example"), "utf8");
    expect(example).not.toMatch(/VITE_ADMIN_API_KEY/);
  });

  it("built web assets (when present) do not contain admin secrets", () => {
    const dist = join(root, "apps/web/dist");
    if (!existsSync(dist)) {
      // Build may not have run yet in isolation; source guard above still applies.
      return;
    }
    const assets = walk(dist).filter((f) => /\.(js|css|html|map)$/.test(f));
    const hits: string[] = [];
    for (const file of assets) {
      const text = readFileSync(file, "utf8");
      if (/VITE_ADMIN_API_KEY/i.test(text) || /X-Admin-Api-Key/i.test(text)) {
        hits.push(relative(root, file));
      }
      for (const secret of secretLikeValues) {
        if (text.includes(secret)) {
          hits.push(`${relative(root, file)} contains env secret`);
        }
      }
    }
    expect(hits).toEqual([]);
  });
});
