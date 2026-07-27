import type { MetaResponse } from "@mplus/contracts";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

export async function fetchMeta(): Promise<MetaResponse> {
  const response = await fetch(`${API_BASE}/api/v1/meta`);
  if (!response.ok) {
    throw new Error(`Meta request failed: ${response.status}`);
  }
  return (await response.json()) as MetaResponse;
}

export const apiClient = {
  fetchMeta,
};
