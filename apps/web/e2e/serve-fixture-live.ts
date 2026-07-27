import { execSync, spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const webRoot = join(repoRoot, "apps/web");
const apiPort = process.env.E2E_API_PORT ?? "3099";
const webPort = process.env.E2E_WEB_PORT ?? "4199";
const previewUrl = `http://127.0.0.1:${webPort}/`;

let apiProcess: ChildProcess | null = null;
let previewProcess: ChildProcess | null = null;

function killPort(port: number): void {
  if (process.platform === "win32") {
    try {
      const output = execSync(`netstat -ano | findstr :${port}`, { encoding: "utf8" });
      const pids = new Set<number>();
      for (const line of output.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.includes("LISTENING")) continue;
        const parts = trimmed.split(/\s+/);
        const pid = Number(parts[parts.length - 1]);
        if (Number.isInteger(pid) && pid > 0) pids.add(pid);
      }
      for (const pid of pids) {
        try {
          execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
          console.log(`Freed port ${port} (PID ${pid})`);
        } catch {
          // process may already be gone
        }
      }
    } catch {
      // no listeners on this port
    }
    return;
  }

  try {
    execSync(`lsof -ti:${port} | xargs -r kill -9`, { stdio: "ignore", shell: true });
  } catch {
    // no listeners on this port
  }
}

function run(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  blocking = true,
): Promise<ChildProcess | void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: "inherit", shell: true });
    child.on("error", reject);
    if (!blocking) {
      resolve(child);
      return;
    }
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function waitForHealth(url: string, attempts = 120): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // retry until the server is listening
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function shutdown(code = 0): void {
  previewProcess?.kill("SIGTERM");
  apiProcess?.kill("SIGTERM");
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

killPort(Number(apiPort));
killPort(Number(webPort));
await sleep(500);

apiProcess = spawn(
  "node",
  ["tools/scripts/with-env.mjs", "pnpm", "--filter", "@mplus/api", "run", "e2e:fixture-api"],
  {
    cwd: repoRoot,
    env: {
      ...process.env,
      E2E_API_PORT: apiPort,
      E2E_WEB_ORIGIN: `http://127.0.0.1:${webPort}`,
    },
    stdio: "inherit",
    shell: true,
    detached: false,
  },
);

apiProcess.on("exit", (code) => {
  if (code && code !== 0) {
    console.error(`E2E fixture API exited with code ${code}`);
    shutdown(code);
  }
});

await waitForHealth(`http://127.0.0.1:${apiPort}/health/live`);

const previewEnv = {
  ...process.env,
  VITE_API_MODE: "live",
  VITE_API_BASE_URL: `http://127.0.0.1:${apiPort}`,
};

await run("pnpm", ["exec", "vite", "build", "--mode", "e2e-live"], webRoot, previewEnv);
previewProcess = (await run(
  "pnpm",
  [
    "exec",
    "vite",
    "preview",
    "--host",
    "127.0.0.1",
    "--port",
    webPort,
    "--strictPort",
    "--outDir",
    "dist-e2e-live",
  ],
  webRoot,
  previewEnv,
  false,
)) as ChildProcess;

previewProcess.on("exit", (code) => {
  if (code && code !== 0) {
    shutdown(code);
  }
});

await waitForHealth(previewUrl);
console.log("E2E preview ready");

await Promise.all([
  new Promise<void>((resolve) => {
    apiProcess?.on("exit", () => resolve());
  }),
  new Promise<void>((resolve) => {
    previewProcess?.on("exit", () => resolve());
  }),
]);
