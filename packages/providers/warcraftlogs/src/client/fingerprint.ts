import { createHash } from "node:crypto";
import { buildRequestFingerprint } from "@mplus/domain";

export function hashGraphQlBody(operationName: string, variables: Record<string, unknown>): string {
  const canonical = JSON.stringify({ operationName, variables: sortKeys(variables) });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function buildGraphQlFingerprint(input: {
  region: string;
  operationName: string;
  variables: Record<string, unknown>;
}): string {
  return buildRequestFingerprint({
    provider: "warcraftlogs",
    region: input.region,
    endpointKey: input.operationName,
    pathParams: {},
    queryParams: {},
    bodyHash: hashGraphQlBody(input.operationName, input.variables),
    authScopeType: "client_credentials",
  });
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeys(obj[key]);
        return acc;
      }, {});
  }
  return value;
}
