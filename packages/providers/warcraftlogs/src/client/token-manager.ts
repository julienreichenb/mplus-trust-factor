export interface WclTokenConfig {
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
  expirySafetyMarginMs?: number;
}

export interface WclAccessToken {
  accessToken: string;
  expiresAtMs: number;
}

export type TokenFetcher = (config: WclTokenConfig) => Promise<WclAccessToken>;

/**
 * Deduplicates concurrent token refresh and caches until expiry minus safety margin.
 */
export class WclTokenManager {
  private cached: WclAccessToken | null = null;
  private inflight: Promise<WclAccessToken> | null = null;
  private readonly safetyMarginMs: number;

  constructor(
    private readonly config: WclTokenConfig,
    private readonly fetchToken: TokenFetcher = defaultFetchToken,
  ) {
    this.safetyMarginMs = config.expirySafetyMarginMs ?? 60_000;
  }

  async getToken(): Promise<string> {
    const now = Date.now();
    if (this.cached && now < this.cached.expiresAtMs - this.safetyMarginMs) {
      return this.cached.accessToken;
    }
    if (!this.inflight) {
      this.inflight = this.fetchToken(this.config).finally(() => {
        this.inflight = null;
      });
    }
    this.cached = await this.inflight;
    return this.cached.accessToken;
  }

  clearCache(): void {
    this.cached = null;
  }
}

export async function defaultFetchToken(config: WclTokenConfig): Promise<WclAccessToken> {
  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`WCL token request failed (${response.status}): ${body}`);
  }
  const json = (await response.json()) as { access_token: string; expires_in: number };
  return {
    accessToken: json.access_token,
    expiresAtMs: Date.now() + json.expires_in * 1000,
  };
}
