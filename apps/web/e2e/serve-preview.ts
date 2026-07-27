import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2] ?? "mock";
const port = process.argv[3] ?? (mode === "live" ? "4174" : "4173");
const viteMode = mode === "live" ? "e2e-live" : "mock";
const previewUrl = `http://127.0.0.1:${port}/`;

const env = {
  ...process.env,
  VITE_API_MODE: mode,
  ...(mode === "live"
    ? { VITE_API_BASE_URL: process.env.VITE_API_BASE_URL ?? "http://127.0.0.1:3001" }
    : {}),
};

function run(command: string, args: string[], blocking = true): Promise<ChildProcess | void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: webRoot,
      env,
      stdio: "inherit",
      shell: true,
    });
    child.on("error", reject);
    if (!blocking) {
      resolve(child);
      return;
    }
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

async function waitForPreview(url: string, attempts = 120): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // retry until preview is listening
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for preview at ${url}`);
}

const outDir = viteMode === "e2e-live" ? "dist-e2e-live" : "dist-mock";

await run("pnpm", ["exec", "vite", "build", "--mode", viteMode]);
const preview = (await run(
  "pnpm",
  [
    "exec",
    "vite",
    "preview",
    "--host",
    "127.0.0.1",
    "--port",
    port,
    "--strictPort",
    "--outDir",
    outDir,
  ],
  false,
)) as ChildProcess;

preview.on("exit", (code) => {
  if (code && code !== 0) {
    process.exit(code);
  }
});

process.on("exit", () => {
  preview.kill("SIGTERM");
});

await waitForPreview(previewUrl);
console.log(`E2E preview ready at ${previewUrl}`);
