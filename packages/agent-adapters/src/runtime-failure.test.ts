import { expect, test } from "bun:test";
import { runtimeFailure } from "./runtime-failure";
import { OpenCodeRuntime } from "./index";
import { AppError } from "@agent-desk/contracts";

test("native failures retain useful categories without persisting raw error messages", () => {
  const inputs = [
    [{ name: "TimeoutError", message: "private-key" }, "runtime_timeout"],
    [{ code: "ETIMEDOUT", message: "private-key" }, "runtime_timeout"],
    [{ code: "ECONNRESET", message: "private-key" }, "runtime_disconnected"],
    [
      { code: "ConnectionClosed", message: "private-key" },
      "runtime_disconnected",
    ],
    [{ name: "AbortError", message: "private-key" }, "runtime_cancelled"],
    [new SyntaxError("private-key"), "runtime_protocol"],
    [new Error("private-key"), "runtime_transport"],
  ] as const;
  for (const [input, code] of inputs) {
    const result = runtimeFailure(input);
    expect(result.code).toBe(code);
    expect(result.message).not.toContain("private-key");
  }
  const prior = new AppError("provider_error", "fixed diagnostic", 502);
  expect(runtimeFailure(prior)).toBe(prior);
  expect(runtimeFailure(new Error("private-key"), true).code).toBe(
    "runtime_cancelled",
  );
});

test("a gracefully closed native event stream stops execution and preserves its cause", async () => {
  let close!: () => void;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    fetch(req) {
      if (new URL(req.url).pathname === "/event")
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  'data: {"type":"server.connected","properties":{}}\n\n',
                ),
              );
              close = () => controller.close();
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        );
      return new Promise<Response>(() => {});
    },
  });
  const runtime = new OpenCodeRuntime("unused", "unused", {} as any) as any;
  const native = {
    url: `http://127.0.0.1:${server.port}`,
    auth: "Basic local-test",
    abort: new AbortController(),
    roles: new Map(),
    observers: new Map(),
  };
  let stopped = 0;
  runtime.stop = async () => {
    stopped++;
    native.abort.abort();
  };
  try {
    await runtime.subscribe(native, "local-test");
    const pending = runtime.request(
      native,
      "/message",
      "POST",
      {},
      native.abort.signal,
    );
    setTimeout(close, 20);
    await expect(pending).rejects.toMatchObject({
      code: "runtime_events_closed",
    });
    expect(stopped).toBe(1);
  } finally {
    native.abort.abort();
    server.stop(true);
  }
});
