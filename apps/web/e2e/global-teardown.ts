import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const PID_FILE = join(webRoot, "e2e", ".e2e-pids.json");

function killPid(pid: number): void {
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(pid, "SIGTERM");
    }
  } catch {
    // process may already be gone
  }
}

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
        killPid(pid);
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

export default async function globalTeardown(): Promise<void> {
  if (existsSync(PID_FILE)) {
    const payload = JSON.parse(readFileSync(PID_FILE, "utf8")) as {
      mockSupervisorPid?: number;
      fixtureSupervisorPid?: number;
    };
    if (payload.mockSupervisorPid) {
      killPid(payload.mockSupervisorPid);
    }
    if (payload.fixtureSupervisorPid) {
      killPid(payload.fixtureSupervisorPid);
    }
    unlinkSync(PID_FILE);
  }

  killPort(4173);
  killPort(3099);
  killPort(4199);
}
