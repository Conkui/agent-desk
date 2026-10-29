import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { scanAgents } from "@agent-desk/agent-catalog";
import {
  AppError,
  type Installation,
  type Run,
  type RunMember,
  type Profile,
} from "@agent-desk/contracts";
import type { Runtime, RuntimeObservation } from "@agent-desk/agent-runtime";
import { Profiles, openCodeEnvironment } from "@agent-desk/provider-config";
import {
  usesTextPlan,
  parseTextPlan,
  providerFailure,
} from "./structured-output";
import { runtimeFailure } from "./runtime-failure";
import { OpenCodeEvents, openCodeEventStream } from "./opencode-events";

type Native = {
  child: Bun.Subprocess;
  url: string;
  auth: string;
  profile: Profile;
  abort: AbortController;
  sessions: Map<string, string>;
  observers: Map<string, (event: RuntimeObservation) => void>;
  permissionSessions: Map<string, string>;
  deniedSessions: Set<string>;
  permissionReplies: Map<string, Promise<unknown>>;
  toolIdsPath?: string;
  eventFailure?: AppError;
};
const names = {
  opencode: "OpenCode",
  claude: "Claude Code",
  dsh: "DeepSeek Harness",
  codex: "Codex",
};
export function redact(text: string, secret?: string) {
  return (secret ? text.split(secret).join("[已隐藏]") : text).replace(
    /sk-[A-Za-z0-9_-]{18,}/g,
    "[已隐藏]",
  );
}
export class OpenCodeRuntime implements Runtime {
  private servers = new Map<string, Native>();
  private cancelled = new Set<string>();
  constructor(
    private root: string,
    private home: string,
    private profiles: Profiles,
  ) {}
  private executable() {
    const local = join(
      this.root,
      ".local/agents/node_modules",
      process.platform === "win32"
        ? "opencode-windows-x64/bin/opencode.exe"
        : "opencode-linux-x64/bin/opencode",
    );
    return Bun.which("opencode") ?? (Bun.file(local).size ? local : null);
  }
  async scan(): Promise<Installation[]> {
    return scanAgents(this.root);
  }
  async prepare(run: Run) {
    if (run.members.some((member) => member.cli !== "opencode"))
      throw new AppError(
        "cli_not_supported",
        "当前独立版先支持 OpenCode 执行。",
      );
    if (!this.executable())
      throw new AppError("cli_missing", "未检测到 OpenCode。");
    await this.profiles.get("opencode");
  }
  private async request(
    native: Native,
    path: string,
    method = "GET",
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<any> {
    try {
      const response = await fetch(native.url + path, {
        method,
        headers: {
          authorization: native.auth,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
        redirect: "error",
      });
      if (!response.ok)
        throw new AppError(
          "runtime_request",
          `OpenCode 请求失败（${response.status}），未自动重试任务。`,
          502,
        );
      return response.status === 204 ? null : await response.json();
    } catch (error) {
      // Event-stream failure stops the child; retain that cause instead of
      // reporting only the resulting cancelled message request.
      throw (
        native.eventFailure ??
        runtimeFailure(error, native.abort.signal.aborted)
      );
    }
  }
  private async start(run: Run): Promise<Native> {
    const existing = this.servers.get(run.id);
    if (existing) return existing;
    const profile = await this.profiles.get("opencode"),
      password = crypto.randomUUID();
    const home = join(this.home, "opencode", run.id);
    await mkdir(home, { recursive: true });
    if (this.cancelled.has(run.id))
      throw new AppError("runtime_stopped", "运行已停止。", 409);
    const child = Bun.spawn(
      [
        this.executable()!,
        "--pure",
        "serve",
        "--hostname",
        "127.0.0.1",
        "--port",
        "0",
        "--mdns=false",
      ],
      {
        cwd: run.definition.directory,
        env: {
          ...openCodeEnvironment(profile, home, this.root),
          OPENCODE_SERVER_PASSWORD: password,
          OPENCODE_SERVER_USERNAME: "opencode",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const native: Native = {
      child,
      url: "",
      auth: "Basic " + btoa("opencode:" + password),
      profile,
      abort: new AbortController(),
      sessions: new Map(),
      observers: new Map(),
      permissionSessions: new Map(),
      deniedSessions: new Set(),
      permissionReplies: new Map(),
    };
    this.servers.set(run.id, native);
    await Bun.write(
      join(home, "process.json"),
      JSON.stringify({ pid: child.pid, createdAt: Date.now() }),
    );
    let settled = false;
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            reject(
              new AppError(
                "runtime_start_timeout",
                "OpenCode 启动超时，未重复启动。",
                504,
              ),
            );
          }
        }, 30000);
        const read = async (stream: ReadableStream<Uint8Array>) => {
          let buffer = "";
          for await (const chunk of stream) {
            buffer = (buffer + new TextDecoder().decode(chunk)).slice(-16000);
            const match = buffer.match(/http:\/\/127\.0\.0\.1:\d+/);
            if (match && !settled) {
              settled = true;
              clearTimeout(timer);
              native.url = match[0];
              resolve();
            }
          }
        };
        void read(child.stdout as ReadableStream<Uint8Array>).catch(() => {});
        void read(child.stderr as ReadableStream<Uint8Array>).catch(() => {});
        void child.exited.then(() => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(
              new AppError(
                "runtime_start_failed",
                "OpenCode 未能启动，请检查安装或配置。",
                502,
              ),
            );
          }
        });
      });
      // Validate the installed API without issuing a model request.
      const spec = await this.request(
        native,
        "/doc",
        "GET",
        undefined,
        AbortSignal.timeout(5000),
      );
      if (
        !spec.paths?.["/session/{sessionID}/message"] ||
        !spec.paths?.["/permission/{requestID}/reply"]
      )
        throw new AppError(
          "runtime_protocol",
          "当前 OpenCode 版本接口不匹配。",
        );
      native.toolIdsPath = spec.paths?.["/experimental/tool/ids"]
        ? "/experimental/tool/ids"
        : spec.paths?.["/tool/ids"]
          ? "/tool/ids"
          : undefined;
      await this.subscribe(native, run.id);
      return native;
    } catch (error) {
      await this.stop(run.id);
      throw error;
    }
  }
  private async subscribe(native: Native, runId: string) {
    const response = await fetch(native.url + "/event", {
      headers: { authorization: native.auth },
      signal: native.abort.signal,
      redirect: "error",
    });
    if (!response.ok || !response.body)
      throw new AppError("runtime_events", "无法订阅 OpenCode 输出。", 502);
    void (async () => {
      const events = new OpenCodeEvents(
        (session, event) => {
          if (event.type === "approval")
            native.permissionSessions.set(event.id, session);
          native.observers.get(session)?.(event);
        },
        (session) => native.observers.has(session),
        (text) => redact(text, native.profile.apiKey),
      );
      const stream = openCodeEventStream(events);
      for await (const chunk of response.body!) {
        stream.feed(chunk);
      }
      if (!native.abort.signal.aborted)
        throw new AppError(
          "runtime_events_closed",
          "OpenCode 输出连接已关闭，本轮已停止，未自动重试。",
          502,
        );
    })().catch((error) => {
      if (!native.abort.signal.aborted) {
        native.eventFailure =
          error instanceof AppError
            ? error
            : new AppError(
                "runtime_events_failed",
                "OpenCode 输出订阅中断，本轮已停止，未自动重试。",
                502,
              );
        void this.stop(runId).catch(
          () => {},
        ); /* losing approval delivery must not leave an unobserved active agent */
      }
    });
  }
  async execute(
    run: Run,
    member: RunMember,
    text: string,
    observe: (event: RuntimeObservation) => void,
    options?: { outputSchema?: Record<string, unknown> },
  ) {
    const native = await this.start(run);
    if (native.abort.signal.aborted)
      throw new AppError("runtime_stopped", "运行已停止。", 409);
    // Planning has no tool access and its permission mask must never carry into the work session.
    const sessionKey = options?.outputSchema ? `${member.id}:plan` : member.id;
    let session = native.sessions.get(sessionKey);
    if (!session) {
      const permission =
        run.definition.permissionPolicy === "read-only"
          ? [
              { permission: "*", pattern: "*", action: "deny" },
              { permission: "read", pattern: "*", action: "allow" },
              { permission: "glob", pattern: "*", action: "allow" },
              { permission: "grep", pattern: "*", action: "allow" },
              {
                permission: "external_directory",
                pattern: "*",
                action: "deny",
              },
            ]
          : [
              { permission: "*", pattern: "*", action: "ask" },
              {
                permission: "external_directory",
                pattern: "*",
                action: "deny",
              },
            ];
      permission.push(
        { permission: "read", pattern: "**/.local/**", action: "deny" },
        { permission: "read", pattern: "**/.env*", action: "deny" },
      );
      const created = await this.request(native, "/session", "POST", {
        title: member.name,
        permission,
      });
      session = created.id;
      if (typeof session !== "string")
        throw new AppError(
          "runtime_protocol",
          "OpenCode 未返回会话标识。",
          502,
        );
      native.sessions.set(sessionKey, session);
    }
    native.observers.set(session, observe);
    const textPlan = !!options?.outputSchema && usesTextPlan(native.profile);
    let disabledTools: Record<string, false> | undefined;
    if (textPlan) {
      if (!native.toolIdsPath)
        throw new AppError(
          "runtime_protocol",
          "当前 OpenCode 版本缺少工具列表接口，无法启动只规划阶段。",
          502,
        );
      const toolIds = await this.request(native, native.toolIdsPath);
      if (
        !Array.isArray(toolIds) ||
        !toolIds.every((id) => typeof id === "string")
      )
        throw new AppError(
          "runtime_protocol",
          "OpenCode 工具列表格式不匹配。",
          502,
        );
      disabledTools = Object.fromEntries(
        toolIds.map((id: string) => [id, false]),
      );
    }
    const result = await this.request(
      native,
      `/session/${encodeURIComponent(session)}/message`,
      "POST",
      {
        model: { providerID: "agent-desk", modelID: native.profile.model },
        parts: [
          {
            type: "text",
            text: textPlan
              ? `${text}\n\n仅输出一个符合以下 JSON Schema 的 JSON 对象，不要调用工具，不要添加说明：\n${JSON.stringify(options!.outputSchema)}`
              : text,
          },
        ],
        ...(disabledTools ? { tools: disabledTools } : {}),
        ...(options?.outputSchema && !textPlan
          ? {
              format: {
                type: "json_schema",
                schema: options.outputSchema,
                retryCount: 0,
              },
            }
          : {}),
      },
      native.abort.signal,
    );
    // A rejected native tool can end the turn with finish=tool-calls and no
    // final text. It is an interrupted task, never a completed worker result.
    if (native.deniedSessions.has(session)) {
      await native.permissionReplies.get(session);
      throw new AppError(
        "runtime_permission_denied",
        "你拒绝了工具操作，本轮已停止。",
        409,
      );
    }
    if (result?.info?.error) throw providerFailure(result.info.error);
    if (result?.info?.finish === "tool-calls")
      throw new AppError(
        "runtime_incomplete",
        "节点在工具调用后中断，未返回最终结果。",
        502,
      );
    for (const part of result?.parts ?? [])
      if (part.type === "text" || part.type === "reasoning")
        observe({
          type: "output",
          id: part.id,
          text: redact(String(part.text ?? ""), native.profile.apiKey),
          role: part.type === "reasoning" ? "reasoning" : "assistant",
        });
    return textPlan
      ? parseTextPlan(
          (result?.parts ?? [])
            .filter((part: { type: string }) => part.type === "text")
            .map((part: { text?: string }) => part.text ?? "")
            .join("\n"),
        )
      : result?.info?.structured;
  }
  async approve(runId: string, nativeId: string, decision: "allow" | "deny") {
    const native = this.servers.get(runId);
    if (!native)
      throw new AppError(
        "runtime_missing",
        "运行进程已离线，请核对后重新运行。",
        409,
      );
    const session = native.permissionSessions.get(nativeId);
    if (!session)
      throw new AppError(
        "runtime_permission_missing",
        "该审批已不在当前执行中。",
        409,
      );
    // Record intent before the reply: the native turn may finish before the
    // permission endpoint acknowledges it. An ambiguous delivery is reconciled
    // by the service and is never treated as permission to continue.
    if (decision === "deny") native.deniedSessions.add(session);
    const reply = this.request(
      native,
      `/permission/${encodeURIComponent(nativeId)}/reply`,
      "POST",
      {
        reply: decision === "allow" ? "once" : "reject",
      },
    );
    native.permissionReplies.set(session, reply);
    try {
      await reply;
      native.permissionSessions.delete(nativeId);
    } finally {
      if (native.permissionReplies.get(session) === reply)
        native.permissionReplies.delete(session);
    }
  }
  async stop(runId: string) {
    this.cancelled.add(runId);
    const native = this.servers.get(runId);
    const manifest = join(this.home, "opencode", runId, "process.json");
    if (!native) {
      if (await Bun.file(manifest).exists()) {
        // PID reuse must never authorize killing a process. Only an absent PID can be cleared automatically.
        let absent = false;
        try {
          const record = await Bun.file(manifest).json();
          if (Number.isSafeInteger(record.pid) && record.pid > 0) {
            try {
              process.kill(record.pid, 0);
            } catch (error) {
              absent = (error as NodeJS.ErrnoException).code === "ESRCH";
            }
          }
        } catch {
          /* Malformed manifests and permission errors remain unknown. */
        }
        if (!absent)
          throw new AppError(
            "runtime_ownership_unknown",
            "旧进程不属于当前后台，需人工核对；未声称已停止。",
            409,
          );
        await rm(manifest, { force: true });
      }
      return;
    }
    native.abort.abort();
    if (native.child.exitCode === null) {
      if (process.platform === "win32") {
        const killer = Bun.spawn(
          ["taskkill", "/PID", String(native.child.pid), "/T", "/F"],
          { stdout: "ignore", stderr: "ignore" },
        );
        await killer.exited;
      } else native.child.kill("SIGTERM");
    }
    await Promise.race([
      native.child.exited,
      new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(
              new AppError("stop_timeout", "停止尚未确认，请核对进程。", 504),
            ),
          5000,
        ),
      ),
    ]);
    this.servers.delete(runId);
    await rm(manifest, { force: true });
  }
  async dispose() {
    for (const id of this.servers.keys()) await this.stop(id);
  }
}
