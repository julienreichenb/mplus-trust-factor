import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { AddonDbFormatError } from "./types.js";

const REPO = "RaiderIO/raiderio-addon";
const TAG_RE = /^v\d{12}$/;
const ASSET_RE = /^RaiderIO-v\d{12}\.zip$/;

export interface SelectedAddonRelease {
  repository: string;
  tag: string;
  publishedAt: string | null;
  assetName: string;
  assetUrl: string;
  githubAssetId: number;
  /** SHA-256 hex from GitHub asset digest when the API provides it. */
  assetSha256: string | null;
}

interface GithubRelease {
  tag_name?: string;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string | null;
  assets?: Array<{
    id: number;
    name: string;
    browser_download_url: string;
    content_type?: string;
    digest?: string | null;
  }>;
}

export function parseGithubAssetDigest(digest: string | null | undefined): string | null {
  if (!digest) return null;
  const match = /^sha256:([a-fA-F0-9]{64})$/.exec(digest.trim());
  const hex = match?.[1];
  return hex ? hex.toLowerCase() : null;
}

export async function selectLatestMainlineAddonRelease(fetchImpl: typeof fetch = fetch): Promise<SelectedAddonRelease> {
  const res = await fetchImpl(`https://api.github.com/repos/${REPO}/releases?per_page=30`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "mplus-trust-factor-key-distribution",
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
  });
  if (!res.ok) {
    throw new AddonDbFormatError("GITHUB", `GitHub releases HTTP ${res.status}`);
  }
  const releases = (await res.json()) as GithubRelease[];
  for (const release of releases) {
    if (release.draft || release.prerelease) continue;
    const tag = release.tag_name ?? "";
    if (!TAG_RE.test(tag)) continue;
    const asset = (release.assets ?? []).find((a) => ASSET_RE.test(a.name) && a.name === `RaiderIO-${tag}.zip`);
    if (!asset?.browser_download_url) continue;
    return {
      repository: REPO,
      tag,
      publishedAt: release.published_at ?? null,
      assetName: asset.name,
      assetUrl: asset.browser_download_url,
      githubAssetId: asset.id,
      assetSha256: parseGithubAssetDigest(asset.digest),
    };
  }
  throw new AddonDbFormatError("GITHUB", "No valid mainline Raider.IO addon release found");
}

export async function downloadReleaseZip(
  url: string,
  destDir: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ zipPath: string; sha256: string }> {
  await mkdir(destDir, { recursive: true });
  const zipPath = path.join(destDir, "raiderio-addon.zip");
  const res = await fetchImpl(url, {
    headers: {
      "User-Agent": "mplus-trust-factor-key-distribution",
      Accept: "application/octet-stream",
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
  });
  if (!res.ok || !res.body) {
    throw new AddonDbFormatError("DOWNLOAD", `Addon zip HTTP ${res.status}`);
  }
  const hash = createHash("sha256");
  const file = createWriteStream(zipPath);
  const nodeReadable = Readable.fromWeb(res.body as never);
  nodeReadable.on("data", (chunk: Buffer) => hash.update(chunk));
  await pipeline(nodeReadable, file);
  return { zipPath, sha256: hash.digest("hex") };
}

export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = path.join(tmpdir(), `rio-addon-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(dir, { recursive: true });
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

