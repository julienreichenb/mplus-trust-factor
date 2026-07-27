import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SECRET_REDACT_PATHS, redactSecretsInObject } from "@mplus/observability";
import { assertFixtureSanitized, loadFixtureManifest } from "@mplus/test-utils";
import { envFlag, parseIdentityArgs, redactForOutput } from "../../tools/scripts/live-smoke-lib.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));

const PROVIDER_SECRET_NAMES = [
  "BLIZZARD_CLIENT_ID",
  "BLIZZARD_CLIENT_SECRET",
  "WCL_CLIENT_ID",
  "WCL_CLIENT_SECRET",
  "RAIDERIO_APP_KEY",
] as const;

function collectFiles(dir: string, predicate: (name: string) => boolean, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
      collectFiles(full, predicate, out);
    } else if (predicate(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("security: secret scanning", () => {
  it("keeps provider secret values empty in tracked env examples", () => {
    const envFiles = [
      resolve(root, ".env.example"),
      resolve(root, "apps/web/.env.example"),
      resolve(root, "apps/web/.env.mock"),
      resolve(root, "apps/web/.env.e2e-live"),
    ];

    for (const file of envFiles) {
      expect(existsSync(file), relative(root, file)).toBe(true);
      const text = readFileSync(file, "utf8");
      for (const name of PROVIDER_SECRET_NAMES) {
        const match = text.match(new RegExp(`^${name}=([^\\r\\n]*)$`, "m"));
        if (!match) continue;
        const value = match[1]?.trim() ?? "";
        expect(value, `${relative(root, file)} ${name}`).toBe("");
      }
    }

    const gitignore = readFileSync(resolve(root, ".gitignore"), "utf8");
    expect(gitignore).toMatch(/^\.env$/m);
  });

  it("never documents provider secrets under VITE_* in web env examples", () => {
    const webEnvExample = readFileSync(resolve(root, "apps/web/.env.example"), "utf8");
    for (const line of webEnvExample.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      expect(trimmed.startsWith("VITE_")).toBe(true);
      expect(trimmed).not.toMatch(/BLIZZARD|WCL_CLIENT|RAIDERIO_APP_KEY/i);
    }
  });

  it("scans fixture catalog for unsanitized secrets", () => {
    const manifest = loadFixtureManifest();
    for (const entry of manifest.fixtures) {
      assertFixtureSanitized(entry.path);
    }
  });

  it("defines redact paths covering provider credential env keys", () => {
    expect(SECRET_REDACT_PATHS).toContain("*.BLIZZARD_CLIENT_SECRET");
    expect(SECRET_REDACT_PATHS).toContain("*.WCL_CLIENT_SECRET");
    expect(SECRET_REDACT_PATHS).toContain("*.RAIDERIO_APP_KEY");
    expect(SECRET_REDACT_PATHS).toContain("*.BLIZZARD_CLIENT_ID");
    expect(SECRET_REDACT_PATHS).toContain("*.WCL_CLIENT_ID");
    expect(SECRET_REDACT_PATHS).toContain("*.reportCode");
    expect(SECRET_REDACT_PATHS).toContain("*.DATABASE_URL");
    expect(SECRET_REDACT_PATHS).toContain("*.REDIS_URL");
  });

  it("redacts secrets from log-shaped objects and smoke output helpers", () => {
    const redacted = redactSecretsInObject({
      BLIZZARD_CLIENT_SECRET: "super-secret",
      WCL_CLIENT_ID: "client-id",
      ok: true,
    });
    expect(redacted.BLIZZARD_CLIENT_SECRET).toBe("[Redacted]");
    expect(redacted.WCL_CLIENT_ID).toBe("[Redacted]");
    expect(redacted.ok).toBe(true);

    const smoke = redactForOutput({
      authorization: "Bearer abc.def",
      nested: { access_token: "tok", status: "ok" },
    }) as { authorization: string; nested: { access_token: string; status: string } };
    expect(smoke.authorization).toBe("[Redacted]");
    expect(smoke.nested.access_token).toBe("[Redacted]");
    expect(smoke.nested.status).toBe("ok");
  });

  it("does not embed provider secrets in browser source/config surfaces", () => {
    const webSrc = resolve(root, "apps/web/src");
    const files = collectFiles(webSrc, (name) => /\.(ts|tsx|vue|js)$/.test(name));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text, relative(root, file)).not.toMatch(
        /BLIZZARD_CLIENT_SECRET|WCL_CLIENT_SECRET|RAIDERIO_APP_KEY/,
      );
      expect(text, relative(root, file)).not.toMatch(/VITE_BLIZZARD_|VITE_WCL_|VITE_RAIDERIO_/);
    }
  });

  it("parses smoke identity args without a default player", () => {
    expect(envFlag(undefined, false)).toBe(false);
    expect(envFlag("true", false)).toBe(true);
    expect(() => parseIdentityArgs([])).toThrow(/Usage:/);
    const identity = parseIdentityArgs(["--region", "eu", "--realm", "Tarren-Mill", "--name", "Someone"]);
    expect(identity).toEqual({ region: "EU", realm: "tarren-mill", name: "Someone" });
  });
});
