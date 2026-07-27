import { mapStatusToError } from "./errors.js";
import { OAUTH_TOKEN_URL, TOKEN_SAFETY_WINDOW_MS } from "./config.js";

export interface TokenManagerOptions {
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  tokenUrl?: string;
  safetyWindowMs?: number;
}

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

export class BlizzardTokenManager {
  private cached: CachedToken | null = null;
  private inflight: Promise<string> | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly tokenUrl: string;
  private readonly safetyWindowMs: number;

  constructor(private readonly options: TokenManagerOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => Date.now());
    this.tokenUrl = options.tokenUrl ?? OAUTH_TOKEN_URL;
    this.safetyWindowMs = options.safetyWindowMs ?? TOKEN_SAFETY_WINDOW_MS;
  }

  async getAccessToken(): Promise<string> {
    const now = this.now();
    if (this.cached && this.cached.expiresAtMs - this.safetyWindowMs > now) {
      return this.cached.accessToken;
    }
    if (this.inflight) {
      return this.inflight;
    }
    this.inflight = this.refresh().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  /** Test helper: inspect whether a cached token exists. */
  getCachedExpiryMs(): number | null {
    return this.cached?.expiresAtMs ?? null;
  }

  private async refresh(): Promise<string> {
    if (!this.options.clientId || !this.options.clientSecret) {
      throw mapStatusToError({
        statusCode: null,
        message: "Blizzard client credentials are not configured",
        reason: "CONFIGURATION_ERROR",
      });
    }

    const basic = Buffer.from(`${this.options.clientId}:${this.options.clientSecret}`, "utf8").toString(
      "base64",
    );
    const body = new URLSearchParams({ grant_type: "client_credentials" });

    let response: Response;
    try {
      response = await this.fetchImpl(this.tokenUrl, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });
    } catch (error) {
      throw mapStatusToError({
        statusCode: null,
        message: `Blizzard token request failed: ${error instanceof Error ? error.message : String(error)}`,
        reason: "TRANSIENT_NETWORK",
      });
    }

    if (!response.ok) {
      throw mapStatusToError({
        statusCode: response.status,
        message: `Blizzard token endpoint returned ${response.status}`,
        reason: response.status === 401 ? "UNAUTHORIZED_PROVIDER" : "PROVIDER_UNAVAILABLE",
      });
    }

    const json = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token || typeof json.expires_in !== "number") {
      throw mapStatusToError({
        statusCode: response.status,
        message: "Blizzard token response missing access_token or expires_in",
        reason: "INVALID_PROVIDER_RESPONSE",
      });
    }

    this.cached = {
      accessToken: json.access_token,
      expiresAtMs: this.now() + json.expires_in * 1000,
    };
    return json.access_token;
  }
}
