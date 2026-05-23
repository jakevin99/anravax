/**
 * Starts the API after freeing API_PORT if another Node process is listening.
 * Avoids stale servers missing newly added routes.
 */
import { spawn } from "node:child_process";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.API_PORT ?? 4000);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..", "..");
const entry = path.join(root, "server", "index.js");

function killListenersOnPort(targetPort) {
  try {
    if (process.platform === "win32") {
      const out = execSync(`netstat -ano | findstr :${targetPort}`, { encoding: "utf8" });
      const pids = new Set();
      for (const line of out.split(/\r?\n/)) {
        if (!line.includes("LISTENING")) continue;
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && /^\d+$/.test(pid) && pid !== "0") pids.add(pid);
      }
      for (const pid of pids) {
        try {
          execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
          // eslint-disable-next-line no-console
          console.log(`[anivax] Stopped previous listener on port ${targetPort} (PID ${pid}).`);
        } catch {
          /* ignore */
        }
      }
    } else {
      execSync(`lsof -ti tcp:${targetPort} | xargs -r kill -9`, { stdio: "ignore" });
    }
  } catch {
    /* port already free */
  }
}

killListenersOnPort(port);

const child = spawn(process.execPath, [entry], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
