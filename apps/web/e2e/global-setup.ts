import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const PID_FILE = join(webRoot, "e2e", ".e2e-pids.json");

interface E2ePids {
  mockSupervisorPid?: number;
  fixtureSupervisorPid?: number;
}

function projectArgValue(): string {
  const projectArgIndex = process.argv.indexOf("--project");
  return projectArgIndex === -1 ? "" : (process.argv[projectArgIndex + 1] ?? "");
}

function shouldStartMock(): boolean {
  const projectValue = projectArgValue();
  if (!projectValue) return true;
  return projectValue.includes("mock");
}

function shouldStartFixtureLive(): boolean {
  const projectValue = projectArgValue();
  if (!projectValue) return true;
  return projectValue.includes("fixture-live");
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

async function startSupervisor(
  command: string,
  readyToken: string,
  previewUrl: string,
): Promise<ChildProcess> {
  const child = spawn(command, {
    cwd: webRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
    detached: process.platform !== "win32",
  });

  if (!child.pid) {
    throw new Error(`Failed to start E2E supervisor: ${command}`);
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for E2E supervisor: ${command}`));
    }, 240_000);

    let ready = false;

    const onData = (chunk: Buffer | string): void => {
      const text = chunk.toString();
      process.stdout.write(text);
      if (!ready && text.includes(readyToken)) {
        ready = true;
        clearTimeout(timeout);
        resolve();
      }
    };

    child.stdout?.on("data", onData);
    child.stderr?.on("data", (chunk) => {
      process.stderr.write(chunk.toString());
    });
    child.once("exit", (code) => {
      if (!ready) {
        clearTimeout(timeout);
        reject(new Error(`E2E supervisor exited early with code ${code ?? "unknown"}`));
      }
    });
  });

  await waitForPreview(previewUrl);

  if (process.platform !== "win32") {
    child.unref();
  }

  return child;
}

export default async function globalSetup(): Promise<void> {
  const pids: E2ePids = {};

  if (shouldStartMock()) {
    const mock = await startSupervisor(
      "pnpm exec tsx e2e/serve-preview.ts mock 4173",
      "E2E preview ready",
      "http://127.0.0.1:4173/",
    );
    pids.mockSupervisorPid = mock.pid;
  }

  if (shouldStartFixtureLive()) {
    const fixture = await startSupervisor(
      "pnpm exec tsx e2e/serve-fixture-live.ts",
      "E2E preview ready",
      "http://127.0.0.1:4199/",
    );
    pids.fixtureSupervisorPid = fixture.pid;
  }

  if (pids.mockSupervisorPid || pids.fixtureSupervisorPid) {
    writeFileSync(PID_FILE, JSON.stringify(pids), "utf8");
  }
}
