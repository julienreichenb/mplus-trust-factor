import { afterEach, describe, expect, it, vi } from "vitest";
import { createLiveApiClient } from "./live-client";
import { formatRealmDisplayName, normalizeRealmOption, normalizeRealmOptions } from "./realm-options";

describe("realm-options", () => {
  it("derives a human label when the API name equals the slug", () => {
    expect(normalizeRealmOption({ slug: "tarren-mill", name: "tarren-mill" })).toEqual({
      slug: "tarren-mill",
      name: "Tarren Mill",
      region: "EU",
      locale: null,
      connectedRealmId: null,
      displayLabel: "Tarren Mill — EU",
      category: null,
      timezone: null,
    });
  });

  it("preserves a distinct API display name", () => {
    expect(normalizeRealmOption({ slug: "tarren-mill", name: "Tarren Mill" })).toEqual({
      slug: "tarren-mill",
      name: "Tarren Mill",
      region: "EU",
      locale: null,
      connectedRealmId: null,
      displayLabel: "Tarren Mill — EU",
      category: null,
      timezone: null,
    });
  });

  it("formats multi-word slugs", () => {
    expect(formatRealmDisplayName("twisting-nether")).toBe("Twisting Nether");
  });
});

describe("createLiveApiClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("omits Content-Type and body for POST requests without a payload", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.body).toBeUndefined();
      const headers = new Headers(init?.headers);
      expect(headers.has("Content-Type")).toBe(false);
      return new Response(
        JSON.stringify({
          characterId: "char-1",
          refreshStatus: "QUEUED",
          job: null,
          cooldownSecondsRemaining: 0,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createLiveApiClient({ baseUrl: "http://localhost:3000" });
    await client.refreshCharacter({ region: "EU", realmSlug: "tarren-mill", name: "Aleria" });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/refresh");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
  });

  it("sets Content-Type when a JSON body is provided", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.body).toBe(JSON.stringify({ confirm: true }));
      const headers = new Headers(init?.headers);
      expect(headers.get("Content-Type")).toBe("application/json");
      return new Response(
        JSON.stringify({
          id: "model-1",
          previousActiveId: null,
          previousActiveVersion: null,
          bulkOperationId: "bulk-1",
          bulkEnqueueError: null,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createLiveApiClient({ baseUrl: "http://localhost:3000" });
    await client.activateModel("model-1");

    expect(fetchMock).toHaveBeenCalledOnce();
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.has(["X", "Admin", "Api", "Key"].join("-"))).toBe(false);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: "include" });
  });

  it("sends a DELETE request with no body for deleteModel", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe("DELETE");
      expect(init?.body).toBeUndefined();
      return new Response(
        JSON.stringify({ id: "model-1", key: "default", version: 7, name: "Draft", status: "DRAFT" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createLiveApiClient({ baseUrl: "http://localhost:3000" });
    const result = await client.deleteModel("model-1");

    expect(result).toMatchObject({ id: "model-1", status: "DRAFT" });
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/api/v1/admin/score-models/model-1");
  });

  it("surfaces 409 SCORE_MODEL_DRAFT_IN_USE dependency counts from deleteModel", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: {
              code: "SCORE_MODEL_DRAFT_IN_USE",
              message: "Draft default v7 is referenced by durable history and cannot be deleted",
              requestId: "req-1",
              details: { counts: { scoreSnapshots: 0, characterRedFlags: 0, addonExports: 0, analysisBatches: 0, bulkOperations: 2 } },
            },
          },
          { status: 409 },
        ),
      ),
    );

    const client = createLiveApiClient({ baseUrl: "http://localhost:3000" });
    await expect(client.deleteModel("model-1")).rejects.toMatchObject({
      status: 409,
      code: "SCORE_MODEL_DRAFT_IN_USE",
      details: { counts: { bulkOperations: 2 } },
    });
  });

  it("normalizes live realm responses to slug + human label", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          realms: [
            { id: "1", regionCode: "EU", slug: "tarren-mill", name: "tarren-mill" },
            { id: "2", regionCode: "EU", slug: "kazzak", name: "Kazzak" },
          ],
        }),
      ),
    );

    const client = createLiveApiClient({ baseUrl: "http://localhost:3000" });
    const realms = await client.searchRealms("EU", "tar");

    expect(realms).toEqual([
      {
        slug: "tarren-mill",
        name: "Tarren Mill",
        region: "EU",
        locale: null,
        connectedRealmId: null,
        displayLabel: "Tarren Mill — EU",
        category: null,
        timezone: null,
      },
      {
        slug: "kazzak",
        name: "Kazzak",
        region: "EU",
        locale: null,
        connectedRealmId: null,
        displayLabel: "Kazzak — EU",
        category: null,
        timezone: null,
      },
    ]);
    expect(normalizeRealmOptions(realms)).toEqual(realms);
  });
});
