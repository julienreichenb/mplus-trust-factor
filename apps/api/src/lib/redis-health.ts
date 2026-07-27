/**
 * Redis readiness probe for /health/ready. Never logs connection strings.
 */
export async function checkRedisHealth(
  createConnection: () => {
    status?: string;
    connect?: () => Promise<unknown>;
    ping(): Promise<string>;
    quit(): Promise<unknown>;
    disconnect(): void;
  },
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = Date.now();
  let client: ReturnType<typeof createConnection> | null = null;
  try {
    client = createConnection();
    // ioredis may connect lazily; ensure the socket is up before ping.
    if (client.status !== "ready" && typeof client.connect === "function") {
      await Promise.race([
        client.connect(),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("redis connect timeout")), 2_000);
        }),
      ]);
    }
    const pong = await Promise.race([
      client.ping(),
      new Promise<string>((_, reject) => {
        setTimeout(() => reject(new Error("redis ping timeout")), 2_000);
      }),
    ]);
    if (String(pong).toUpperCase() !== "PONG") {
      return { ok: false, latencyMs: Date.now() - started, error: "unexpected ping response" };
    }
    return { ok: true, latencyMs: Date.now() - started };
  } catch {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: "redis unreachable",
    };
  } finally {
    if (client) {
      try {
        await client.quit();
      } catch {
        try {
          client.disconnect();
        } catch {
          /* ignore */
        }
      }
    }
  }
}
