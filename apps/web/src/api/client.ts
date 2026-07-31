import { createMockApiClient } from "./mock/client";
import { createLiveApiClient } from "./live-client";
import type { ApiMode, MplusApiClient } from "./types";

export function resolveApiMode(): ApiMode {
  const mode = (import.meta.env.VITE_API_MODE as string | undefined)?.toLowerCase();
  if (mode === "live") return "live";
  return "mock";
}

export function createApiClient(): MplusApiClient {
  const mode = resolveApiMode();
  if (mode === "live") {
    return createLiveApiClient({
      baseUrl: import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000",
    });
  }
  return createMockApiClient();
}

/** Shared singleton for the SPA. Tests may call createMockApiClient() directly. */
export const api = createApiClient();

export { createMockApiClient } from "./mock/client";
export { validateModelConfig } from "./model-config";
export { resetMockState } from "./mock/fixtures";
