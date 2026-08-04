import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  findMonorepoConfigRoot,
  resolveConfiguredLocalArtifactRoot,
} from "./resolve-configured-root.js";

describe("resolveConfiguredLocalArtifactRoot", () => {
  const configRoot = findMonorepoConfigRoot(process.cwd()) ?? path.resolve(".");

  it("refuses missing configured path (no default guess)", () => {
    expect(resolveConfiguredLocalArtifactRoot({ configuredDir: undefined, configRoot }).ok).toBe(
      false,
    );
    expect(resolveConfiguredLocalArtifactRoot({ configuredDir: "", configRoot }).ok).toBe(false);
    expect(resolveConfiguredLocalArtifactRoot({ configuredDir: "   ", configRoot }).ok).toBe(false);
  });

  it("refuses remote / non-local backends", () => {
    for (const configuredDir of [
      "s3://bucket/path",
      "gs://bucket",
      "https://cdn.example/artifacts",
      "cas://sha256/abc",
      "file:///tmp/artifacts",
    ]) {
      expect(resolveConfiguredLocalArtifactRoot({ configuredDir, configRoot }).ok).toBe(false);
    }
  });

  it("refuses relative paths when config root is absent", () => {
    const result = resolveConfiguredLocalArtifactRoot({
      configuredDir: "./data/raw-artifacts",
      configRoot: null,
    });
    expect(result.ok).toBe(false);
  });

  it("resolves relative paths from repository/config root", () => {
    const result = resolveConfiguredLocalArtifactRoot({
      configuredDir: "./data/raw-artifacts",
      configRoot,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.absolutePath).toBe(path.resolve(configRoot, "./data/raw-artifacts"));
    expect(result.configRoot).toBe(path.resolve(configRoot));
  });

  it("does not resolve relative paths against a misleading package cwd", () => {
    const packageCwd = path.join(configRoot, "packages", "database");
    const wrong = path.resolve(packageCwd, "./data/raw-artifacts");
    const result = resolveConfiguredLocalArtifactRoot({
      configuredDir: "./data/raw-artifacts",
      configRoot,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.absolutePath).not.toBe(wrong);
    expect(result.absolutePath).toBe(path.resolve(configRoot, "data", "raw-artifacts"));
  });

  it("accepts absolute local paths", () => {
    const absolute = path.resolve(configRoot, "tmp-cas-test-root");
    const result = resolveConfiguredLocalArtifactRoot({
      configuredDir: absolute,
      configRoot: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.absolutePath).toBe(absolute);
  });
});
