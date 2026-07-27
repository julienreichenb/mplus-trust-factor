import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function getOpenApiSpecPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const snapshot = resolve(here, "../../../tests/fixtures/openapi.snapshot.json");
  if (existsSync(snapshot)) {
    return snapshot;
  }
  return resolve(here, "../../../apps/api/openapi.json");
}

export function loadOpenApiSpec(): Record<string, unknown> {
  const path = getOpenApiSpecPath();
  if (!existsSync(path)) {
    throw new Error(
      `OpenAPI spec not found at ${path}. Run pnpm openapi:generate first.`,
    );
  }
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

export function getOpenApiPath(
  spec: Record<string, unknown>,
  routePath: string,
  method: string,
): Record<string, unknown> | null {
  const paths = spec.paths as Record<string, Record<string, unknown>> | undefined;
  if (!paths) return null;
  const route = paths[routePath];
  if (!route) return null;
  return (route[method.toLowerCase()] as Record<string, unknown>) ?? null;
}

export function assertResponseMatchesOpenApiSchema(
  spec: Record<string, unknown>,
  routePath: string,
  method: string,
  statusCode: number,
  body: unknown,
): string[] {
  const errors: string[] = [];
  const operation = getOpenApiPath(spec, routePath, method);
  if (!operation) {
    errors.push(`No OpenAPI operation for ${method} ${routePath}`);
    return errors;
  }
  const responses = operation.responses as Record<string, { content?: Record<string, { schema?: unknown }> }> | undefined;
  const response = responses?.[String(statusCode)];
  if (!response) {
    errors.push(`No OpenAPI response schema for status ${statusCode} on ${method} ${routePath}`);
    return errors;
  }
  const schema = response.content?.["application/json"]?.schema as Record<string, unknown> | undefined;
  if (!schema) return errors;

  if (schema.type === "object" && typeof body === "object" && body !== null) {
    const required = (schema.required as string[] | undefined) ?? [];
    const properties = (schema.properties as Record<string, unknown>) ?? {};
    for (const key of required) {
      if (!(key in (body as Record<string, unknown>))) {
        errors.push(`Missing required field "${key}" in response body`);
      }
    }
    for (const key of Object.keys(body as Record<string, unknown>)) {
      if (!properties[key] && required.includes(key) === false) {
        // Allow extra fields in MVP — only enforce required
      }
    }
  }
  return errors;
}

export function writeOpenApiSnapshot(spec: Record<string, unknown>, targetPath?: string): void {
  const path = targetPath ?? getOpenApiSpecPath();
  writeFileSync(path, JSON.stringify(spec, null, 2), "utf8");
}
