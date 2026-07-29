import type { AppEnv } from "@mplus/config";
import { pkceChallengeS256 } from "./crypto.js";

export interface BattleNetTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
  refresh_token?: string;
  id_token?: string;
}

export interface BattleNetUserInfo {
  sub?: string;
  id?: number | string;
  battletag?: string;
  [key: string]: unknown;
}

export interface WowAccountCharacter {
  id: number;
  name: string;
  realm?: { slug?: string; name?: string; id?: number };
  playable_class?: { id?: number };
  playable_race?: { id?: number };
  level?: number;
  faction?: { type?: string; name?: string };
}

export interface WowAccountProfile {
  id: number;
  characters?: WowAccountCharacter[];
}

export interface WowUserProfile {
  wow_accounts?: WowAccountProfile[];
  [key: string]: unknown;
}

export interface BattleNetOAuthClient {
  buildAuthorizeUrl(input: {
    redirectUri: string;
    state: string;
    codeVerifier: string;
    scopes: string;
  }): string;
  exchangeAuthorizationCode(input: {
    code: string;
    redirectUri: string;
    codeVerifier: string;
  }): Promise<BattleNetTokenResponse>;
  refreshAccessToken(refreshToken: string): Promise<BattleNetTokenResponse>;
  fetchUserInfo(accessToken: string): Promise<BattleNetUserInfo>;
  fetchWowAccountProfile(accessToken: string, region: string): Promise<WowUserProfile>;
}

export function createBattleNetOAuthClient(
  env: AppEnv,
  fetchImpl: typeof fetch = fetch,
): BattleNetOAuthClient {
  const basicAuth = Buffer.from(`${env.BLIZZARD_CLIENT_ID}:${env.BLIZZARD_CLIENT_SECRET}`).toString(
    "base64",
  );

  async function tokenRequest(body: URLSearchParams): Promise<BattleNetTokenResponse> {
    const response = await fetchImpl(env.BATTLENET_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
    });
    if (!response.ok) {
      throw new Error(`Battle.net token endpoint returned ${response.status}`);
    }
    return (await response.json()) as BattleNetTokenResponse;
  }

  return {
    buildAuthorizeUrl({ redirectUri, state, codeVerifier, scopes }) {
      const url = new URL(env.BATTLENET_OAUTH_AUTHORIZE_URL);
      url.searchParams.set("client_id", env.BLIZZARD_CLIENT_ID);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", scopes);
      url.searchParams.set("state", state);
      url.searchParams.set("code_challenge", pkceChallengeS256(codeVerifier));
      url.searchParams.set("code_challenge_method", "S256");
      return url.toString();
    },

    exchangeAuthorizationCode({ code, redirectUri, codeVerifier }) {
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      });
      return tokenRequest(body);
    },

    refreshAccessToken(refreshToken: string) {
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      });
      return tokenRequest(body);
    },

    async fetchUserInfo(accessToken: string) {
      const response = await fetchImpl(env.BATTLENET_OAUTH_USERINFO_URL, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`Battle.net userinfo returned ${response.status}`);
      }
      return (await response.json()) as BattleNetUserInfo;
    },

    async fetchWowAccountProfile(accessToken: string, region: string) {
      const normalized = region.trim().toLowerCase();
      const host = `https://${normalized}.api.blizzard.com`;
      const url = new URL("/profile/user/wow", host);
      url.searchParams.set("namespace", `profile-${normalized}`);
      url.searchParams.set("locale", env.BLIZZARD_DEFAULT_LOCALE);
      const response = await fetchImpl(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`WoW account profile returned ${response.status}`);
      }
      return (await response.json()) as WowUserProfile;
    },
  };
}
