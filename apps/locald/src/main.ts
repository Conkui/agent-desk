import { mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
import { Store } from "@agent-desk/storage";
import { Profiles } from "@agent-desk/provider-config";
import { OpenCodeRuntime } from "@agent-desk/agent-adapters";
import { createLocalServer } from "./server";

const root = resolve(import.meta.dir, "../../..");
const home = resolve(
  process.env.AGENT_DESK_HOME ?? join(root, ".local/agent-desk"),
);
const workspace = resolve(process.env.AGENT_DESK_WORKSPACE ?? root);
const port = Number(process.env.AGENT_DESK_PORT ?? 4190);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Invalid port");
await mkdir(home, { recursive: true });
await mkdir(join(root, ".local/temp"), { recursive: true });
const store = new Store(join(home, "agent-desk.sqlite")),
  profiles = new Profiles(home);
const runtime = new OpenCodeRuntime(root, home, profiles);
const app = await createLocalServer({
  root,
  home,
  workspace,
  port,
  runtime,
  store,
  profiles,
  remoteOrigin: process.env.AGENT_DESK_PRIVATE_ORIGIN,
});
console.log(`Agent Desk: http://127.0.0.1:${app.server.port}/workflows`);
console.log(
  `Connection password file: ${join(home, "connection-password.txt")}`,
);
console.log(
  "Loopback only. No public computer port, router mapping, or public tunnel is enabled.",
);
if (process.env.AGENT_DESK_OPEN_BROWSER === "1") {
  const url = `http://127.0.0.1:${app.server.port}/workflows`;
  const executable =
    process.platform === "win32"
      ? "rundll32.exe"
      : process.platform === "darwin"
        ? "open"
        : "xdg-open";
  const args =
    process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  const browser = spawn(executable, args, {
    windowsHide: true,
    stdio: "ignore",
  });
  browser.on("error", () =>
    console.log("Open the displayed local URL in your browser."),
  );
  browser.unref();
}
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await app.close();
  store.close();
  process.exit(0);
}
process.on("SIGINT", () => void close());
process.on("SIGTERM", () => void close());
