import { join } from "node:path";
import { userInfo } from "node:os";

/**
 * Resolve the directory where runtime sockets/pid files live.
 * Priority: $CRYPTO_AGENT_RUNTIME_DIR → $XDG_RUNTIME_DIR → /tmp
 */
export function runtimeDir(): string {
  return (
    process.env.CRYPTO_AGENT_RUNTIME_DIR ||
    process.env.XDG_RUNTIME_DIR ||
    "/tmp"
  );
}

function uidSuffix(): string {
  try {
    const info = userInfo();
    return String(info.uid ?? info.username ?? "default");
  } catch {
    return "default";
  }
}

export function socketPath(): string {
  const override = process.env.CRYPTO_AGENT_SOCK;
  if (override) return override;
  return join(runtimeDir(), `crypto-agent-${uidSuffix()}.sock`);
}

export function pidFilePath(): string {
  const override = process.env.CRYPTO_AGENT_PID;
  if (override) return override;
  return join(runtimeDir(), `crypto-agent-${uidSuffix()}.pid`);
}
