import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { pidFilePath, socketPath } from "./paths.js";

/**
 * Verify whether a PID belongs to a currently-running process.
 * `process.kill(pid, 0)` throws ESRCH if the process is gone.
 */
function isProcessAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err.code !== "ESRCH";
  }
}

/**
 * Acquire the daemon lock.
 * - If a live daemon is already running: throws DaemonAlreadyRunningError.
 * - If a stale PID/socket exists (previous crash): cleans them up.
 * - Otherwise: writes this process's PID to the lock file.
 */
export class DaemonAlreadyRunningError extends Error {
  constructor(public readonly pid: number) {
    super(`Another crypto-daemon is already running (pid ${pid})`);
    this.name = "DaemonAlreadyRunningError";
  }
}

export function acquireDaemonLock(): void {
  const pidPath = pidFilePath();
  const sockPath = socketPath();

  if (existsSync(pidPath)) {
    const existingPid = Number(readFileSync(pidPath, "utf-8").trim());
    if (isProcessAlive(existingPid) && existingPid !== process.pid) {
      throw new DaemonAlreadyRunningError(existingPid);
    }
    // Stale: remove
    try { unlinkSync(pidPath); } catch {}
    if (existsSync(sockPath)) {
      try { unlinkSync(sockPath); } catch {}
    }
  } else if (existsSync(sockPath)) {
    // Socket without PID file — orphaned, clean it up
    try { unlinkSync(sockPath); } catch {}
  }

  writeFileSync(pidPath, String(process.pid));
}

export function releaseDaemonLock(): void {
  const pidPath = pidFilePath();
  const sockPath = socketPath();
  try { if (existsSync(pidPath)) unlinkSync(pidPath); } catch {}
  try { if (existsSync(sockPath)) unlinkSync(sockPath); } catch {}
}
