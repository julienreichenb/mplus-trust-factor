import { describe, expect, it, vi } from "vitest";
import { ExternalApiError } from "@mplus/contracts";
import { RaiderIoHttpClient } from "./http-client.js";

describe("RaiderIoHttpClient", () => {
  it("encodes query parameters and documented access_key only", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      headers: new Headers(),
      text: async () => JSON.stringify({ ok: true }),
    });

    const client = new RaiderIoHttpClient({
      baseUrl: "https://raider.io",
      appKey: "test-key",
      softRpm: 1000,
      maxConcurrency: 2,
      fetchImpl,
    });

    await client.getJson(
      "/api/v1/characters/profile",
      {
        region: "eu",
        realm: "tarren-mill",
        name: "Test Character",
        fields: "mythic_plus_ranks",
      },
      "characters.profile",
    );

    const calledUrl = fetchImpl.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain("region=eu");
    expect(calledUrl).toContain("realm=tarren-mill");
    expect(calledUrl).toContain("name=Test");
    expect(calledUrl).toContain("fields=mythic_plus_ranks");
    expect(calledUrl).toContain("access_key=test-key");
    expect(calledUrl).not.toMatch(/authorization/i);
  });

  it("retries on 429 honoring Retry-After then succeeds", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    let calls = 0;
    const fetchImpl = vi.fn().mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        return {
          status: 429,
          ok: false,
          headers: new Headers({ "Retry-After": "1" }),
          text: async () => "",
        };
      }
      return {
        status: 200,
        ok: true,
        headers: new Headers(),
        text: async () => JSON.stringify({ ok: true }),
      };
    });

    const client = new RaiderIoHttpClient({
      baseUrl: "https://raider.io",
      softRpm: 1000,
      maxConcurrency: 2,
      fetchImpl,
      sleep,
    });

    const result = await client.getJson("/api/v1/periods", {}, "periods");
    expect(result.body).toEqual({ ok: true });
    expect(calls).toBe(2);
    expect(sleep).toHaveBeenCalled();
  });

  it("maps live 400 missing character to NOT_FOUND", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 400,
      ok: false,
      headers: new Headers(),
      text: async () =>
        JSON.stringify({
          statusCode: 400,
          error: "Bad Request",
          message: "Could not find requested character",
        }),
    });

    const client = new RaiderIoHttpClient({
      baseUrl: "https://raider.io",
      softRpm: 1000,
      maxConcurrency: 2,
      fetchImpl,
      maxRetries: 0,
    });

    await expect(client.getJson("/api/v1/characters/profile", {}, "characters.profile")).rejects.toMatchObject({
      code: "NOT_FOUND",
      statusCode: 400,
    });
  });

  it("throws INVALID_RESPONSE for malformed JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      headers: new Headers(),
      text: async () => "not-json",
    });

    const client = new RaiderIoHttpClient({
      baseUrl: "https://raider.io",
      softRpm: 1000,
      maxConcurrency: 2,
      fetchImpl,
      maxRetries: 0,
    });

    await expect(client.getJson("/api/v1/periods", {}, "periods")).rejects.toBeInstanceOf(ExternalApiError);
  });

  it("retries transient 5xx then fails", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 503,
      ok: false,
      headers: new Headers(),
      text: async () => JSON.stringify({ message: "unavailable" }),
    });

    const client = new RaiderIoHttpClient({
      baseUrl: "https://raider.io",
      softRpm: 1000,
      maxConcurrency: 2,
      fetchImpl,
      sleep,
      maxRetries: 1,
    });

    await expect(client.getJson("/api/v1/periods", {}, "periods")).rejects.toMatchObject({
      retryable: true,
      statusCode: 503,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws TIMEOUT when abort occurs", async () => {
    const fetchImpl = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    });

    const client = new RaiderIoHttpClient({
      baseUrl: "https://raider.io",
      softRpm: 1000,
      maxConcurrency: 2,
      fetchImpl,
      timeoutMs: 5,
      maxRetries: 0,
    });

    await expect(client.getJson("/api/v1/periods", {}, "periods")).rejects.toMatchObject({
      code: "TIMEOUT",
    });
  });
});
