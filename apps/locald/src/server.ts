import { resolve, relative, isAbsolute, join } from "node:path";
import { z } from "zod";
import {
  AppError,
  CommandSchema,
  CreateWorkflowSchema,
  UpdateWorkflowSchema,
  ArchiveWorkflowSchema,
  DuplicateWorkflowSchema,
  type Run,
  ResolveApprovalSchema,
  SendMessageSchema,
} from "@agent-desk/contracts";
import { Store } from "@agent-desk/storage";
import type { Runtime } from "@agent-desk/agent-runtime";
import { Profiles } from "@agent-desk/provider-config";
import { Workflows } from "@agent-desk/workflow-service";
import {
  DeviceAccess,
  checkRequestBoundary,
  privateOrigin,
  LISTEN_HOST,
} from "@agent-desk/transport";

export type ServerOptions = {
  root: string;
  home: string;
  workspace: string;
  port: number;
  remoteOrigin?: string;
  runtime: Runtime;
  store: Store;
  profiles: Profiles;
};
export async function createLocalServer(options: ServerOptions) {
  const summarize = (run: Run) => ({
    id: run.id,
    workflowId: run.workflowId,
    state: run.state,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    memberCount: run.members.length,
    phase: run.phase,
    cleanupState: run.cleanupState,
    retryOf: run.retryOf,
  });
  const { store, runtime, profiles } = options,
    remoteOrigin = privateOrigin(options.remoteOrigin);
  const access = new DeviceAccess(options.home, store, !!remoteOrigin);
  await access.initialize();
  const workflows = new Workflows(store, runtime, options.workspace);
  store.reconcile();
  const json = (body: unknown, status = 200, extra: HeadersInit = {}) =>
    Response.json(body, {
      status,
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        ...extra,
      },
    });
  async function body<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      throw new AppError("content_type", "请使用 JSON 请求。", 415);
    const reader = request.body?.getReader(),
      decoder = new TextDecoder();
    let text = "",
      size = 0;
    if (reader)
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > 65536) {
            await reader.cancel();
            throw new AppError("body_too_large", "请求内容过大。", 413);
          }
          text += decoder.decode(part.value, { stream: true });
        }
        text += decoder.decode();
      } finally {
        reader.releaseLock();
      }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new AppError("invalid_json", "请求内容无效。");
    }
    const parsed = schema.safeParse(value);
    if (!parsed.success)
      throw new AppError(
        "invalid_request",
        "请求字段无效，请检查任务、成员或配置。",
      );
    return parsed.data;
  }
  const server = Bun.serve({
    hostname: LISTEN_HOST,
    port: options.port,
    idleTimeout: 30,
    async fetch(request) {
      try {
        checkRequestBoundary(request, server.port!, remoteOrigin);
        const path = new URL(request.url).pathname,
          method = request.method;
        if (path === "/api/v1/health")
          return json({
            name: "Agent Desk",
            version: "0.1.0",
            protocolVersion: 1,
            network: {
              listenHost: LISTEN_HOST,
              publicPort: false,
              relayEnabled: false,
            },
          });
        if (path === "/api/v1/auth/login" && method === "POST") {
          const input = await body(
            request,
            z.object({ password: z.string().max(4096) }).strict(),
          );
          return json({ connected: true }, 200, {
            "set-cookie": access.login(
              input.password,
              !!remoteOrigin &&
                (request.headers.get("host") === new URL(remoteOrigin).host ||
                  request.headers.get("origin") === remoteOrigin),
            ),
          });
        }
        if (path.startsWith("/api/")) {
          if (!access.authorized(request))
            throw new AppError(
              "connection_required",
              "请先输入设备连接密码。",
              401,
            );
          if (path === "/api/v1/auth/logout" && method === "POST")
            return json({ connected: false }, 200, {
              "set-cookie": access.logout(request),
            });
          if (path === "/api/v1/bootstrap" && method === "GET")
            return json({
              name: "Agent Desk",
              workspace: options.workspace,
              network: {
                listenHost: LISTEN_HOST,
                privateOrigin: remoteOrigin ?? null,
                publicPort: false,
                relayEnabled: false,
              },
              installations: await runtime.scan(),
              profiles: await profiles.list(),
            });
          if (path === "/api/v1/devices/local/scan" && method === "POST")
            return json({ installations: await runtime.scan() });
          if (path === "/api/v1/workflows" && method === "GET")
            return json({
              workflows: store.listWorkflows(),
              runs: store.listRuns().map(summarize),
            });
          if (path === "/api/v1/workflows" && method === "POST")
            return json(
              {
                workflow: await workflows.create(
                  await body(request, CreateWorkflowSchema),
                ),
              },
              201,
            );
          const definition = path.match(/^\/api\/v1\/workflows\/([^/]+)$/);
          if (definition && method === "GET")
            return json({
              workflow: store.workflow(definition[1]),
              runs: store.listRuns(definition[1]).map(summarize),
            });
          if (definition && method === "PATCH")
            return json({
              workflow: await workflows.update(
                definition[1],
                await body(request, UpdateWorkflowSchema),
              ),
            });
          const manage = path.match(
            /^\/api\/v1\/workflows\/([^/]+)\/(archive|duplicate)$/,
          );
          if (manage && method === "POST") {
            if (manage[2] === "archive") {
              const input = await body(request, ArchiveWorkflowSchema);
              return json({
                workflow: await workflows.archive(
                  manage[1],
                  input.expectedVersion,
                  input.archived,
                  input.commandId,
                ),
              });
            }
            const input = await body(request, DuplicateWorkflowSchema);
            return json(
              {
                workflow: await workflows.duplicate(
                  manage[1],
                  input.commandId,
                  input.name,
                ),
              },
              201,
            );
          }
          const retry = path.match(/^\/api\/v1\/runs\/([^/]+)\/retry$/);
          if (retry && method === "POST")
            return json(
              {
                run: await workflows.retry(
                  retry[1],
                  (await body(request, CommandSchema)).commandId,
                ),
              },
              202,
            );
          const start = path.match(/^\/api\/v1\/workflows\/([^/]+)\/runs$/);
          if (start && method === "POST")
            return json(
              {
                run: await workflows.start(
                  start[1],
                  (await body(request, CommandSchema)).commandId,
                ),
              },
              202,
            );
          const runPath = path.match(/^\/api\/v1\/runs\/([^/]+)$/);
          if (runPath && method === "GET")
            return json({ run: store.run(runPath[1]) });
          const events = path.match(/^\/api\/v1\/runs\/([^/]+)\/events$/);
          if (events && method === "GET") {
            let after = Number(
              request.headers.get("last-event-id") ??
                new URL(request.url).searchParams.get("after") ??
                0,
            );
            const run = store.run(events[1]);
            if (
              !Number.isSafeInteger(after) ||
              after < 0 ||
              after > run.lastSequence
            )
              throw new AppError(
                "invalid_sequence",
                "事件位置无效，请重新读取运行。",
                409,
              );
            let timer: ReturnType<typeof setInterval> | undefined;
            const encoder = new TextEncoder();
            const stream = new ReadableStream({
              start(controller) {
                let ticks = 0;
                const send = () => {
                  try {
                    if (!access.authorized(request)) {
                      controller.close();
                      if (timer) clearInterval(timer);
                      return;
                    }
                    for (const event of store.events(events[1], after)) {
                      controller.enqueue(
                        encoder.encode(
                          `id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`,
                        ),
                      );
                      after = event.sequence;
                    }
                    if (++ticks % 25 === 0)
                      controller.enqueue(encoder.encode(": heartbeat\n\n"));
                  } catch {
                    if (timer) clearInterval(timer);
                    try {
                      controller.close();
                    } catch {}
                  }
                };
                controller.enqueue(encoder.encode(": connected\n\n"));
                send();
                timer = setInterval(send, 400);
              },
              cancel() {
                if (timer) clearInterval(timer);
              },
            });
            return new Response(stream, {
              headers: {
                "content-type": "text/event-stream",
                "cache-control": "no-store",
                "x-accel-buffering": "no",
              },
            });
          }
          const action = path.match(
            /^\/api\/v1\/runs\/([^/]+)\/(stop|confirm-result)$/,
          );
          if (action && method === "POST") {
            const { commandId } = await body(request, CommandSchema);
            return json({
              run:
                action[2] === "stop"
                  ? await workflows.stop(action[1], commandId)
                  : await workflows.confirm(action[1], commandId),
            });
          }
          const message = path.match(
            /^\/api\/v1\/runs\/([^/]+)\/members\/([^/]+)\/messages$/,
          );
          if (message && method === "POST") {
            const input = await body(request, SendMessageSchema);
            return json(
              {
                run: await workflows.send(
                  message[1],
                  message[2],
                  input.text,
                  input.commandId,
                ),
              },
              202,
            );
          }
          const approval = path.match(
            /^\/api\/v1\/runs\/([^/]+)\/approvals\/([^/]+)\/resolve$/,
          );
          if (approval && method === "POST") {
            const input = await body(request, ResolveApprovalSchema);
            return json({
              run: await workflows.approval(
                approval[1],
                approval[2],
                input.decision,
                input.expectedVersion,
                input.commandId,
              ),
            });
          }
          const profile = path.match(/^\/api\/v1\/provider-profiles\/([^/]+)$/);
          if (profile && method === "PUT")
            return json({
              profiles: await profiles.save(
                profile[1],
                await body(request, z.unknown()),
              ),
            });
          throw new AppError("not_found", "接口不存在。", 404);
        }
        if (method !== "GET" && method !== "HEAD")
          throw new AppError("method_not_allowed", "不支持此操作。", 405);
        const dist = resolve(options.root, "apps/console/dist");
        const file = resolve(dist, "." + decodeURIComponent(path)),
          rel = relative(dist, file);
        if (rel.startsWith("..") || isAbsolute(rel))
          throw new AppError("path_forbidden", "路径不可访问。", 403);
        const target = Bun.file(path === "/" ? join(dist, "index.html") : file);
        const asset = (await target.exists())
          ? target
          : Bun.file(join(dist, "index.html"));
        if (!(await asset.exists()))
          return new Response("Agent Desk: run the console build first.", {
            status: 503,
          });
        return new Response(method === "HEAD" ? null : asset, {
          headers: {
            "content-security-policy":
              "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
            "x-content-type-options": "nosniff",
            "referrer-policy": "no-referrer",
            "cache-control": "no-cache",
          },
        });
      } catch (error) {
        return json(
          {
            code: error instanceof AppError ? error.code : "internal_error",
            message:
              error instanceof AppError
                ? error.message
                : "操作失败；敏感诊断未返回浏览器。",
            requestId: crypto.randomUUID(),
          },
          error instanceof AppError ? error.status : 500,
        );
      }
    },
  });
  return {
    server,
    workflows,
    access,
    async close() {
      store.reconcile();
      await workflows.waitForCleanup();
      await runtime.dispose();
      server.stop(true);
    },
  };
}
