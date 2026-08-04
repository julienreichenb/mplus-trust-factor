import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Walk upward from startDir until pnpm-workspace.yaml is found.
 * This is the repository / config root used to resolve relative RAW_ARTIFACTS_DIR.
 */
export function findMonorepoConfigRoot(startDir: string): string | null {
  let dir = path.resolve(startDir);
  for (;;) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export type ResolveConfiguredLocalArtifactRootInput = {
  /** Canonical app config value: RAW_ARTIFACTS_DIR. Must be explicitly set. */
  configuredDir: string | null | undefined;
  /** Repository / config root for relative paths (never package cwd alone). */
  configRoot: string | null | undefined;
};

export type ResolveConfiguredLocalArtifactRootResult =
  | {
      ok: true;
      configuredDir: string;
      absolutePath: string;
      configRoot: string;
      backend: "local-fs";
    }
  | {
      ok: false;
      reason: string;
    };

/**
 * Resolve the local CAS root from application artifact-store configuration.
 *
 * Fail-closed:
 * - missing / blank configuredDir
 * - remote object-storage / URL schemes
 * - missing or ambiguous configRoot when the path is relative
 * - null bytes / empty resolved path
 *
 * Does not invent a default path (including "./data/raw-artifacts").
 */
export function resolveConfiguredLocalArtifactRoot(
  input: ResolveConfiguredLocalArtifactRootInput,
): ResolveConfiguredLocalArtifactRootResult {
  const raw = typeof input.configuredDir === "string" ? input.configuredDir.trim() : "";
  if (!raw) {
    return {
      ok: false,
      reason: "Blocked: RAW_ARTIFACTS_DIR is absent from application configuration.",
    };
  }
  if (raw.includes("\0")) {
    return {
      ok: false,
      reason: "Blocked: RAW_ARTIFACTS_DIR contains an illegal null byte.",
    };
  }

  const lower = raw.toLowerCase();
  if (
    lower.startsWith("s3://") ||
    lower.startsWith("gs://") ||
    lower.startsWith("az://") ||
    lower.startsWith("http://") ||
    lower.startsWith("https://") ||
    lower.startsWith("cas://") ||
    lower.startsWith("file://")
  ) {
    return {
      ok: false,
      reason: `Blocked: RAW_ARTIFACTS_DIR is not a local filesystem path (${raw}).`,
    };
  }

  const isAbsolute = path.isAbsolute(raw);
  const configRoot =
    typeof input.configRoot === "string" && input.configRoot.trim()
      ? path.resolve(input.configRoot.trim())
      : null;

  if (!isAbsolute) {
    if (!configRoot) {
      return {
        ok: false,
        reason:
          "Blocked: relative RAW_ARTIFACTS_DIR requires an unambiguous repository/config root.",
      };
    }
  }

  const absolutePath = isAbsolute
    ? path.resolve(raw)
    : path.resolve(configRoot!, raw);

  if (!absolutePath || absolutePath === path.parse(absolutePath).root) {
    return {
      ok: false,
      reason: "Blocked: resolved RAW_ARTIFACTS_DIR is empty or filesystem root (ambiguous).",
    };
  }

  return {
    ok: true,
    configuredDir: raw,
    absolutePath,
    configRoot: configRoot ?? path.dirname(absolutePath),
    backend: "local-fs",
  };
}
