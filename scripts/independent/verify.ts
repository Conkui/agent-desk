import { resolve, join } from "node:path";
import { mkdir, readdir } from "node:fs/promises";
import { Database } from "bun:sqlite";

const root = resolve(import.meta.dir, "../.."),
  home = join(root, ".local/agent-desk"),
  file = join(home, "verification.json");
const base = "http://127.0.0.1:" + String(process.env.AGENT_DESK_PORT ?? 4190);
const password = (
  await Bun.file(join(home, "connection-password.txt")).text()
).trim();
const login = await fetch(base + "/api/v1/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ password }),
});
if (!login.ok) throw new Error("Local connection failed");
const cookie = login.headers.get("set-cookie")!.split(";")[0];
async function call(path: string, body?: unknown) {
  const response = await fetch(base + "/api/v1" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json()) as any;
  if (!response.ok) throw new Error(data.message ?? "Local request failed");
  return data;
}
let ids: { runId: string; workflowId: string };
if (await Bun.file(file).exists()) {
  const prior = await Bun.file(file).json();
  ids = { runId: prior.runId, workflowId: prior.workflowId };
} else {
  if (!process.argv.includes("--live"))
    throw new Error(
      "No previous evidence. --live explicitly sends one short DeepSeek request.",
    );
  const bootstrap = await call("/bootstrap"),
    profile = bootstrap.profiles.find((item: any) => item.cli === "opencode");
  if (
    !profile ||
    new URL(profile.baseUrl).hostname !== "api.deepseek.com" ||
    profile.model !== "deepseek-flash"
  )
    throw new Error(
      "Live verification only permits the designated DeepSeek official profile.",
    );
  const directory = join(root, ".local/independent-smoke-workspace");
  await mkdir(directory, { recursive: true });
  const { workflow } = await call("/workflows", {
    commandId: crypto.randomUUID(),
    name: "独立版连通验证",
    task: "这是一次连通测试。只输出 AGENT_DESK_CONNECTED，不读写文件，不调用工具。",
    directory,
    permissionPolicy: "read-only",
    members: [
      {
        id: crypto.randomUUID(),
        name: "协调器",
        cli: "opencode",
        roles: ["coordinator", "worker"],
        responsibility: "完成一次简短连接检查",
      },
    ],
  });
  const { run } = await call(`/workflows/${workflow.id}/runs`, {
    commandId: crypto.randomUUID(),
  });
  ids = { runId: run.id, workflowId: workflow.id };
  await Bun.write(file, JSON.stringify(ids));
  console.log(
    "One short live verification dispatched. No GPT or Codex invocation.",
  );
}
let run: any;
for (let index = 0; index < 120; index++) {
  run = (await call(`/runs/${ids.runId}`)).run;
  if (!["dispatching", "running"].includes(run.state)) break;
  await Bun.sleep(1000);
}
const matched = run.members.some((member: any) =>
  member.messages.some(
    (message: any) =>
      message.role === "assistant" &&
      message.text.includes("AGENT_DESK_CONNECTED"),
  ),
);
if (run.state === "awaiting_confirmation" && matched)
  await call(`/runs/${run.id}/confirm-result`, {
    commandId: crypto.randomUUID(),
  });
else if (!["completed", "stopped"].includes(run.state))
  await call(`/runs/${run.id}/stop`, { commandId: crypto.randomUUID() });
let nativeModelConfirmed = false;
try {
  const path = join(home, "opencode", run.id, "data/opencode/opencode.db");
  if (await Bun.file(path).exists()) {
    const db = new Database(path, { readonly: true });
    const rows = db
      .query<
        { data: string },
        []
      >("SELECT data FROM message ORDER BY rowid DESC LIMIT 30")
      .all();
    nativeModelConfirmed = rows.some((row) => {
      const message = JSON.parse(row.data);
      return (
        message.role === "assistant" &&
        message.modelID === "deepseek-flash" &&
        message.providerID === "agent-desk"
      );
    });
    db.close();
  }
} catch {
  /* Native persistence evidence is optional, never inferred from configuration alone. */
}
const evidence = {
  ...ids,
  verifiedAt: new Date().toISOString(),
  outputMatched: matched,
  nativeModelConfirmed,
  model: "deepseek-flash",
  liveTaskDispatches: 1,
  runState: (await call(`/runs/${run.id}`)).run.state,
  publicComputerPort: false,
};
await Bun.write(file, JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
if (!matched)
  throw new Error("Live result not verified; no automatic retry was sent.");
