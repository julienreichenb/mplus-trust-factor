import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Caddy public routing topology", () => {
  const caddyfile = readFileSync(join(process.cwd(), "infra/caddy/Caddyfile"), "utf8");

  it("does not reverse_proxy /metrics to the API on the public edge", () => {
    expect(caddyfile).toMatch(/@metrics\s+path\s+\/metrics/);
    expect(caddyfile).toMatch(/handle\s+@metrics[\s\S]*?respond\s+404/);

    const apiMatcher = caddyfile.match(/@api\s+path\s+([^\n]+)/);
    expect(apiMatcher?.[1]).toBeTruthy();
    expect(apiMatcher?.[1]).not.toMatch(/\/metrics/);
  });

  it("documents private-network scrape for Prometheus", () => {
    expect(caddyfile).toMatch(/private Docker network/i);
  });
});
