import { describe, expect, it } from "vitest";
import { InMemoryProviderCache } from "./cache.js";

describe("InMemoryProviderCache", () => {
  it("stores and retrieves values before TTL expiry", () => {
    const cache = new InMemoryProviderCache();
    cache.set("fp1", { score: 100 }, 60, 1000);
    const hit = cache.get<{ score: number }>("fp1", 2000);
    expect(hit.hit).toBe(true);
    if (hit.hit) expect(hit.value.score).toBe(100);
  });

  it("expires entries after TTL", () => {
    const cache = new InMemoryProviderCache();
    cache.set("fp1", { score: 100 }, 1, 1000);
    const miss = cache.get("fp1", 3000);
    expect(miss.hit).toBe(false);
  });

  it("dedupes concurrent in-flight requests", async () => {
    const cache = new InMemoryProviderCache();
    let calls = 0;
    const factory = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 10));
      return "result";
    };
    const [a, b] = await Promise.all([
      cache.dedupe("fp1", factory),
      cache.dedupe("fp1", factory),
    ]);
    expect(a).toBe("result");
    expect(b).toBe("result");
    expect(calls).toBe(1);
  });

  it("tracks negative cache entries", () => {
    const cache = new InMemoryProviderCache();
    cache.set("missing", { error: true }, 30, 1000, true);
    const hit = cache.get("missing", 2000);
    expect(hit.hit).toBe(true);
    if (hit.hit) expect(hit.negative).toBe(true);
  });
});
