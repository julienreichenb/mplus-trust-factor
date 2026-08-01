import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  DEV_PACKAGE_FILTER,
  detectWorktreeContext,
  ensureWorktreeEnv,
  envExamplePath,
  envPath,
  formatCapabilitySummary,
  hasEnvValue,
  isLocalDatabaseUrl,
  listFillableEnvKeys,
  mergeEmptyEnvKeys,
  missingEnvGuidance,
  parseBootstrapFlags,
  parseEnvFile,
  parseWorktreeListPorcelain,
  pathsEqual,
  resolveRepoRoot,
  runBootstrap,
  summarizeCapabilities,
} from "../tools/scripts/bootstrap.mjs";

const LOCAL_DB =
  "DATABASE_URL=postgresql://mplus:mplus@localhost:5433/mplus_trust?schema=public\nREDIS_URL=redis://localhost:6379\n";

function failThrow(msg: string): never {
  throw new Error(msg);
}

describe("bootstrap.mjs helpers", () => {
  it("resolves the repository root from the script location", () => {
    const root = resolveRepoRoot();
    expect(root.length).toBeGreaterThan(0);
    expect(DEV_PACKAGE_FILTER).toBe("./packages/**");
  });

  it("parses dotenv content without mutating process.env", () => {
    const parsed = parseEnvFile(
      ["# comment", "", "FOO=bar", "DATABASE_URL=postgresql://mplus:mplus@localhost:5433/mplus_trust"].join(
        "\n",
      ),
    );
    expect(parsed.FOO).toBe("bar");
    expect(parsed.DATABASE_URL).toContain("localhost:5433");
    expect(process.env.FOO).toBeUndefined();
  });

  it("accepts only loopback database URLs", () => {
    expect(
      isLocalDatabaseUrl("postgresql://mplus:mplus@localhost:5433/mplus_trust?schema=public"),
    ).toBe(true);
    expect(isLocalDatabaseUrl("postgres://mplus:mplus@127.0.0.1:5433/mplus_trust")).toBe(true);
    expect(isLocalDatabaseUrl("postgresql://mplus:mplus@[::1]:5433/mplus_trust")).toBe(true);
    expect(isLocalDatabaseUrl("postgresql://mplus:mplus@db.example.com:5432/mplus_trust")).toBe(
      false,
    );
  });

  it("compares paths with spaces correctly", () => {
    const spaced = join("C:", "Users", "Julie Smith", "proj");
    expect(pathsEqual(spaced, spaced)).toBe(true);
    expect(pathsEqual(spaced, join("C:", "Users", "Other", "proj"))).toBe(false);
  });

  it("parses --copy-env and --from-example flags", () => {
    expect(parseBootstrapFlags([])).toEqual({ copyEnv: false, fromExample: false });
    expect(parseBootstrapFlags(["--copy-env"])).toEqual({ copyEnv: true, fromExample: false });
    expect(parseBootstrapFlags(["--from-example"])).toEqual({ copyEnv: false, fromExample: true });
  });
});

describe("git worktree porcelain parsing", () => {
  it("parses primary and linked worktrees including paths with spaces", () => {
    const porcelain = [
      "worktree /Users/me/VS Projects/mplus-main",
      "HEAD abc",
      "branch refs/heads/main",
      "",
      "worktree /Users/me/VS Projects/mplus-worktrees/feature branch",
      "HEAD def",
      "branch refs/heads/feature",
      "",
    ].join("\n");
    const entries = parseWorktreeListPorcelain(porcelain);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.path).toBe("/Users/me/VS Projects/mplus-main");
    expect(entries[1]?.path).toBe("/Users/me/VS Projects/mplus-worktrees/feature branch");
  });

  it("detects primary worktree from porcelain via injected git", () => {
    const primary = resolve("/repo", "primary with spaces");
    const linked = resolve("/repo", "linked wt");
    const runGit = vi.fn((args: string[]) => {
      if (args[0] === "worktree") {
        return {
          status: 0,
          stdout: [
            `worktree ${primary}`,
            "HEAD aaa",
            "branch refs/heads/main",
            "",
            `worktree ${linked}`,
            "HEAD bbb",
            "branch refs/heads/feat",
            "",
          ].join("\n"),
          stderr: "",
        };
      }
      return { status: 1, stdout: "", stderr: "unexpected" };
    });
    const ctx = detectWorktreeContext(linked, runGit);
    expect(pathsEqual(ctx.primaryPath, primary)).toBe(true);
    expect(pathsEqual(ctx.currentPath, linked)).toBe(true);
    expect(ctx.isPrimary).toBe(false);
  });

  it("fails clearly when git worktree detection fails", () => {
    const runGit = vi.fn(() => ({
      status: 128,
      stdout: "",
      stderr: "fatal: not a git repository",
    }));
    expect(() => detectWorktreeContext("/not-a-repo", runGit)).toThrow(
      /git worktree detection failed/,
    );
  });

  it("falls back via rev-parse when root path is not listed verbatim", () => {
    const primary = resolve("/repo/main");
    const runGit = vi.fn((args: string[]) => {
      if (args[0] === "worktree") {
        return {
          status: 0,
          stdout: [`worktree ${primary}`, "HEAD aaa", "branch refs/heads/main", ""].join("\n"),
          stderr: "",
        };
      }
      if (args[0] === "rev-parse") {
        return { status: 0, stdout: `${primary}\n`, stderr: "" };
      }
      return { status: 1, stdout: "", stderr: "no" };
    });
    // Unlisted synthetic root forces rev-parse / fallback path.
    const ctx = detectWorktreeContext(resolve("/repo/other-checkout"), runGit);
    expect(pathsEqual(ctx.primaryPath, primary)).toBe(true);
    expect(pathsEqual(ctx.currentPath, primary)).toBe(true);
    expect(ctx.isPrimary).toBe(true);
  });
});

describe("capabilities", () => {
  it("requires both Blizzard credentials for OAuth and live provider", () => {
    expect(
      summarizeCapabilities({
        BLIZZARD_CLIENT_ID: "id-only",
      }).battleNetOauth,
    ).toBe(false);
    expect(
      summarizeCapabilities({
        BLIZZARD_CLIENT_SECRET: "secret-only",
      }).blizzardLive,
    ).toBe(false);
    expect(
      summarizeCapabilities({
        BLIZZARD_CLIENT_ID: "id",
        BLIZZARD_CLIENT_SECRET: "secret",
      }).battleNetOauth,
    ).toBe(true);
    expect(
      summarizeCapabilities({
        BLIZZARD_CLIENT_ID: "id",
        BLIZZARD_CLIENT_SECRET: "secret",
      }).blizzardLive,
    ).toBe(true);
  });

  it("never includes secret values in capability summary text", () => {
    const secret = "super-secret-value-do-not-leak";
    const caps = summarizeCapabilities({
      DATABASE_URL: "postgresql://mplus:mplus@localhost:5433/mplus_trust",
      REDIS_URL: "redis://localhost:6379",
      BLIZZARD_CLIENT_ID: "client-id",
      BLIZZARD_CLIENT_SECRET: secret,
      WCL_CLIENT_ID: "wcl-id",
      WCL_CLIENT_SECRET: secret,
    });
    const text = formatCapabilitySummary(caps);
    expect(text).toContain("Battle.net OAuth configured: yes");
    expect(text).not.toContain(secret);
    expect(text).not.toContain("client-id");
    expect(text).not.toContain("wcl-id");
    expect(text).not.toContain("postgresql://");
  });

  it("treats whitespace-only values as missing", () => {
    expect(hasEnvValue({ BLIZZARD_CLIENT_ID: "  " }, "BLIZZARD_CLIENT_ID")).toBe(false);
  });

  it("lists only empty local keys that primary can fill", () => {
    expect(
      listFillableEnvKeys(
        { BLIZZARD_CLIENT_ID: "", REDIS_URL: "redis://localhost:6379", KEEP: "local" },
        {
          BLIZZARD_CLIENT_ID: "from-primary",
          BLIZZARD_CLIENT_SECRET: "secret",
          REDIS_URL: "redis://other",
          KEEP: "primary-should-not-win",
        },
      ),
    ).toEqual(["BLIZZARD_CLIENT_ID", "BLIZZARD_CLIENT_SECRET"]);
  });

  it("merges empty keys without clobbering local values or logging secrets", () => {
    const secret = "primary-secret-value";
    const local = [
      "DATABASE_URL=postgresql://mplus:mplus@localhost:5433/mplus_trust",
      "BLIZZARD_CLIENT_ID=",
      "BLIZZARD_CLIENT_SECRET=",
      "REDIS_URL=redis://localhost:6379",
      "",
    ].join("\n");
    const primary = [
      "DATABASE_URL=postgresql://other/db",
      `BLIZZARD_CLIENT_ID=client-from-primary`,
      `BLIZZARD_CLIENT_SECRET=${secret}`,
      "REDIS_URL=redis://primary:6379",
      "WCL_CLIENT_ID=wcl",
      "",
    ].join("\n");
    const { contents, filledKeys } = mergeEmptyEnvKeys(local, primary);
    expect(filledKeys).toEqual([
      "BLIZZARD_CLIENT_ID",
      "BLIZZARD_CLIENT_SECRET",
      "WCL_CLIENT_ID",
    ]);
    const parsed = parseEnvFile(contents);
    expect(parsed.DATABASE_URL).toContain("localhost:5433");
    expect(parsed.REDIS_URL).toBe("redis://localhost:6379");
    expect(parsed.BLIZZARD_CLIENT_ID).toBe("client-from-primary");
    expect(parsed.BLIZZARD_CLIENT_SECRET).toBe(secret);
    expect(parsed.WCL_CLIENT_ID).toBe("wcl");
  });
});

describe("ensureWorktreeEnv", () => {
  it("never overwrites non-empty values in an existing current-worktree .env", async () => {
    const current = join("/tmp", "current wt");
    const primary = join("/tmp", "primary wt");
    const writeFile = vi.fn();
    const copyFile = vi.fn();
    const result = await ensureWorktreeEnv({
      root: current,
      flags: { copyEnv: true },
      exists: (p: string) =>
        pathsEqual(p, join(current, ".env")) || pathsEqual(p, join(primary, ".env")),
      readFile: (p: string) => {
        if (pathsEqual(p, join(current, ".env"))) {
          return "BLIZZARD_CLIENT_ID=local-id\nBLIZZARD_CLIENT_SECRET=local-secret\n";
        }
        return "BLIZZARD_CLIENT_ID=primary-id\nBLIZZARD_CLIENT_SECRET=primary-secret\n";
      },
      writeFile,
      copyFile,
      promptYesNo: vi.fn(async () => true),
      runGit: vi.fn(),
      detectContext: () => ({
        primaryPath: primary,
        currentPath: current,
        isPrimary: false,
        entries: [],
      }),
      log: () => undefined,
      fail: failThrow,
    });
    expect(result.source).toBe("existing");
    expect(writeFile).not.toHaveBeenCalled();
    expect(copyFile).not.toHaveBeenCalled();
  });

  it("fills empty OAuth keys from primary with --copy-env without replacing the file wholesale", async () => {
    const current = join("/tmp", "current wt");
    const primary = join("/tmp", "primary wt");
    const secret = "primary-only-secret";
    let written = "";
    const result = await ensureWorktreeEnv({
      root: current,
      flags: { copyEnv: true },
      exists: (p: string) =>
        pathsEqual(p, join(current, ".env")) || pathsEqual(p, join(primary, ".env")),
      readFile: (p: string) => {
        if (pathsEqual(p, join(current, ".env"))) {
          return [
            "DATABASE_URL=postgresql://mplus:mplus@localhost:5433/mplus_trust",
            "BLIZZARD_CLIENT_ID=",
            "BLIZZARD_CLIENT_SECRET=",
            "",
          ].join("\n");
        }
        return [
          "DATABASE_URL=postgresql://should-not-replace/db",
          "BLIZZARD_CLIENT_ID=filled-id",
          `BLIZZARD_CLIENT_SECRET=${secret}`,
          "",
        ].join("\n");
      },
      writeFile: (_p: string, contents: string) => {
        written = contents;
      },
      copyFile: vi.fn(),
      promptYesNo: vi.fn(async () => false),
      runGit: vi.fn(),
      detectContext: () => ({
        primaryPath: primary,
        currentPath: current,
        isPrimary: false,
        entries: [],
      }),
      log: () => undefined,
      fail: failThrow,
    });
    expect(result.source).toBe("merged-primary");
    expect(result.filledKeys).toEqual(["BLIZZARD_CLIENT_ID", "BLIZZARD_CLIENT_SECRET"]);
    const parsed = parseEnvFile(written);
    expect(parsed.DATABASE_URL).toContain("localhost:5433");
    expect(parsed.BLIZZARD_CLIENT_ID).toBe("filled-id");
    expect(parsed.BLIZZARD_CLIENT_SECRET).toBe(secret);
  });

  it("requires explicit approval before filling empty keys from primary", async () => {
    const current = join("/tmp", "current wt");
    const primary = join("/tmp", "primary wt");
    const writeFile = vi.fn();
    const promptYesNo = vi.fn(async () => false);
    const result = await ensureWorktreeEnv({
      root: current,
      flags: {},
      exists: (p: string) =>
        pathsEqual(p, join(current, ".env")) || pathsEqual(p, join(primary, ".env")),
      readFile: (p: string) => {
        if (pathsEqual(p, join(current, ".env"))) return "BLIZZARD_CLIENT_ID=\n";
        return "BLIZZARD_CLIENT_ID=from-primary\n";
      },
      writeFile,
      copyFile: vi.fn(),
      promptYesNo,
      runGit: vi.fn(),
      detectContext: () => ({
        primaryPath: primary,
        currentPath: current,
        isPrimary: false,
        entries: [],
      }),
      log: () => undefined,
      fail: failThrow,
    });
    expect(result.source).toBe("existing");
    expect(writeFile).not.toHaveBeenCalled();
    expect(promptYesNo).toHaveBeenCalledOnce();
  });

  it("detects primary worktree .env when current is missing", async () => {
    const primary = join("/tmp", "primary repo");
    const current = join("/tmp", "linked wt");
    const copyFile = vi.fn();
    const result = await ensureWorktreeEnv({
      root: current,
      flags: { copyEnv: true },
      exists: (p: string) => pathsEqual(p, join(primary, ".env")),
      copyFile,
      runGit: vi.fn(),
      detectContext: () => ({
        primaryPath: primary,
        currentPath: current,
        isPrimary: false,
        entries: [],
      }),
      log: () => undefined,
      fail: failThrow,
    });
    expect(result.source).toBe("primary");
    expect(copyFile).toHaveBeenCalledOnce();
    const [src, dest] = copyFile.mock.calls[0] as [string, string];
    expect(pathsEqual(src, envPath(primary))).toBe(true);
    expect(pathsEqual(dest, envPath(current))).toBe(true);
  });

  it("requires explicit approval before copying from primary", async () => {
    const primary = join("/tmp", "primary");
    const current = join("/tmp", "linked");
    const copyFile = vi.fn();
    await expect(
      ensureWorktreeEnv({
        root: current,
        flags: {},
        exists: (p: string) => pathsEqual(p, join(primary, ".env")),
        copyFile,
        promptYesNo: async () => false,
        runGit: vi.fn(),
        detectContext: () => ({
          primaryPath: primary,
          currentPath: current,
          isPrimary: false,
          entries: [],
        }),
        log: () => undefined,
        fail: failThrow,
      }),
    ).rejects.toThrow(/copy declined|\.env\.example|--copy-env/i);
    expect(copyFile).not.toHaveBeenCalled();
  });

  it("copies non-interactively with --copy-env", async () => {
    const primary = join("/tmp", "primary with spaces");
    const current = join("/tmp", "linked with spaces");
    const copyFile = vi.fn();
    const promptYesNo = vi.fn(async () => false);
    await ensureWorktreeEnv({
      root: current,
      flags: { copyEnv: true },
      exists: (p: string) => pathsEqual(p, join(primary, ".env")),
      copyFile,
      promptYesNo,
      runGit: vi.fn(),
      detectContext: () => ({
        primaryPath: primary,
        currentPath: current,
        isPrimary: false,
        entries: [],
      }),
      log: () => undefined,
      fail: failThrow,
    });
    expect(promptYesNo).not.toHaveBeenCalled();
    expect(copyFile).toHaveBeenCalledOnce();
    const [src, dest] = copyFile.mock.calls[0] as [string, string];
    expect(pathsEqual(src, envPath(primary))).toBe(true);
    expect(pathsEqual(dest, envPath(current))).toBe(true);
  });

  it("falls back to .env.example guidance when no source .env exists", async () => {
    const root = join("/tmp", "solo wt");
    await expect(
      ensureWorktreeEnv({
        root,
        flags: {},
        exists: (p: string) => pathsEqual(p, join(root, ".env.example")),
        copyFile: vi.fn(),
        promptYesNo: async () => false,
        runGit: vi.fn(),
        detectContext: () => ({
          primaryPath: root,
          currentPath: root,
          isPrimary: true,
          entries: [],
        }),
        log: () => undefined,
        fail: failThrow,
      }),
    ).rejects.toThrow(/\.env\.example|--from-example|--copy-env/i);
  });

  it("creates .env from example with --from-example", async () => {
    const root = join("/tmp", "solo wt");
    const copyFile = vi.fn();
    const result = await ensureWorktreeEnv({
      root,
      flags: { fromExample: true },
      exists: (p: string) => pathsEqual(p, join(root, ".env.example")),
      copyFile,
      promptYesNo: vi.fn(),
      runGit: vi.fn(),
      detectContext: () => ({
        primaryPath: root,
        currentPath: root,
        isPrimary: true,
        entries: [],
      }),
      log: () => undefined,
      fail: failThrow,
    });
    expect(result.source).toBe("example");
    expect(copyFile).toHaveBeenCalledOnce();
    const [src, dest] = copyFile.mock.calls[0] as [string, string];
    expect(pathsEqual(src, envExamplePath(root))).toBe(true);
    expect(pathsEqual(dest, envPath(root))).toBe(true);
  });

  it("never logs secret values while copying", async () => {
    const primary = join("/tmp", "primary");
    const current = join("/tmp", "linked");
    const secret = "leaked-secret-should-not-appear";
    const logs: string[] = [];
    await ensureWorktreeEnv({
      root: current,
      flags: { copyEnv: true },
      exists: (p: string) => pathsEqual(p, join(primary, ".env")),
      copyFile: () => undefined,
      runGit: vi.fn(),
      detectContext: () => ({
        primaryPath: primary,
        currentPath: current,
        isPrimary: false,
        entries: [],
      }),
      log: (msg: string) => logs.push(msg),
      fail: failThrow,
    });
    const joined = logs.join("\n");
    expect(joined).toContain(".env");
    expect(joined).not.toContain(secret);
    expect(joined).not.toMatch(/BLIZZARD_CLIENT_SECRET=/);
  });
});

describe("runBootstrap orchestration", () => {
  it("prints OAuth disabled without failing when credentials are missing", async () => {
    const logs: string[] = [];
    const previous = process.env.DATABASE_URL;
    const previousBlizzardId = process.env.BLIZZARD_CLIENT_ID;
    const previousBlizzardSecret = process.env.BLIZZARD_CLIENT_SECRET;
    const previousWclId = process.env.WCL_CLIENT_ID;
    const previousWclSecret = process.env.WCL_CLIENT_SECRET;
    delete process.env.DATABASE_URL;
    delete process.env.BLIZZARD_CLIENT_ID;
    delete process.env.BLIZZARD_CLIENT_SECRET;
    delete process.env.WCL_CLIENT_ID;
    delete process.env.WCL_CLIENT_SECRET;
    try {
      await runBootstrap({
        root: "/repo",
        runPnpm: vi.fn(),
        waitForTcp: vi.fn(async () => undefined),
        argv: [],
        exists: (p: string) => p.endsWith(".env") || p.endsWith(".env.example"),
        readFile: () => LOCAL_DB,
        copyFile: vi.fn(),
        runGit: vi.fn(),
        detectContext: () => ({
          primaryPath: "/repo",
          currentPath: "/repo",
          isPrimary: true,
          entries: [],
        }),
        log: (msg: string) => logs.push(msg),
        fail: failThrow,
      });
    } finally {
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
      if (previousBlizzardId === undefined) delete process.env.BLIZZARD_CLIENT_ID;
      else process.env.BLIZZARD_CLIENT_ID = previousBlizzardId;
      if (previousBlizzardSecret === undefined) delete process.env.BLIZZARD_CLIENT_SECRET;
      else process.env.BLIZZARD_CLIENT_SECRET = previousBlizzardSecret;
      if (previousWclId === undefined) delete process.env.WCL_CLIENT_ID;
      else process.env.WCL_CLIENT_ID = previousWclId;
      if (previousWclSecret === undefined) delete process.env.WCL_CLIENT_SECRET;
      else process.env.WCL_CLIENT_SECRET = previousWclSecret;
    }
    expect(logs.some((l) => l.includes("Battle.net OAuth configured: no"))).toBe(true);
    expect(
      logs.some((l) =>
        l.includes(
          "Battle.net OAuth disabled: configure BLIZZARD_CLIENT_ID and BLIZZARD_CLIENT_SECRET in this worktree's .env.",
        ),
      ),
    ).toBe(true);
    expect(logs.at(-1)).toBe(
      "  pnpm test    — isolated disposable mplus_itest_* database (never mutates mplus_trust)",
    );
    expect(logs.some((l) => l === "bootstrap: ready.")).toBe(true);
    expect(logs.some((l) => l.includes("pnpm dev"))).toBe(true);
  });

  it("refuses non-local DATABASE_URL before install/migrate/seed", async () => {
    const runPnpm = vi.fn();
    const previous = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      await expect(
        runBootstrap({
          root: "/repo",
          runPnpm,
          waitForTcp: vi.fn(),
          exists: (p: string) => p.endsWith(".env"),
          readFile: () =>
            "DATABASE_URL=postgresql://mplus:mplus@db.prod.internal:5432/mplus_trust\n",
          copyFile: vi.fn(),
          runGit: vi.fn(),
          detectContext: () => ({
            primaryPath: "/repo",
            currentPath: "/repo",
            isPrimary: true,
            entries: [],
          }),
          log: () => undefined,
          fail: failThrow,
        }),
      ).rejects.toThrow(/not a local loopback URL/);
    } finally {
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
    }
    expect(runPnpm).not.toHaveBeenCalled();
  });

  it("runs setup steps in order and does not start pnpm dev", async () => {
    const calls: string[][] = [];
    const previous = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      await runBootstrap({
        root: "/repo",
        runPnpm: (args: string[]) => {
          calls.push(args);
        },
        waitForTcp: vi.fn(async () => undefined),
        exists: (p: string) => p.endsWith(".env"),
        readFile: () => LOCAL_DB,
        copyFile: vi.fn(),
        runGit: vi.fn(),
        detectContext: () => ({
          primaryPath: "/repo",
          currentPath: "/repo",
          isPrimary: true,
          entries: [],
        }),
        log: () => undefined,
        fail: failThrow,
      });
    } finally {
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
    }
    expect(calls).toEqual([
      ["install"],
      ["run", "dev:infra"],
      ["run", "db:generate"],
      ["--filter", "./packages/**", "--if-present", "run", "build"],
      ["run", "db:migrate"],
      ["run", "db:seed"],
    ]);
    expect(calls.some((args) => args.includes("dev") && !args.includes("dev:infra"))).toBe(false);
  });

  it("documents .env.example when guidance is requested", () => {
    const message = missingEnvGuidance("/repo with spaces");
    expect(message).toContain("cp .env.example .env");
    expect(message).toContain("--copy-env");
    expect(message).toContain("--from-example");
    expect(message).toMatch(/worktree/i);
  });
});
