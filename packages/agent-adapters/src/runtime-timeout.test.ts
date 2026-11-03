import { expect, test } from "bun:test";
import { OpenCodeRuntime } from "./index";

test("long turns can still be cancelled, while normal requests keep their default timeout", async () => {
  let received = false;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    fetch(req) {
      if (new URL(req.url).pathname === "/short")
        return Response.json({ ok: true });
      received = true;
      return new Promise<Response>(() => {});
    },
  });
  const original = globalThis.fetch;
  const options: Array<boolean | undefined> = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    options.push((init as RequestInit & { timeout?: boolean })?.timeout);
    return original(input, init);
  }) as typeof fetch;
  const runtime = new OpenCodeRuntime("unused", "unused", {} as any) as any;
  const native = {
    url: `http://127.0.0.1:${server.port}`,
    auth: "Basic test-only",
    abort: new AbortController(),
  };
  try {
    expect(await runtime.request(native, "/short")).toEqual({ ok: true });
    const pending = runtime.request(
      native,
      "/session/test/message",
      "POST",
      {},
      native.abort.signal,
      true,
    );
    for (let i = 0; i < 100 && !received; i++) await Bun.sleep(5);
    expect(received).toBe(true);
    native.abort.abort();
    await expect(pending).rejects.toMatchObject({ code: "runtime_cancelled" });
    expect(options).toEqual([undefined, false]);
  } finally {
    native.abort.abort();
    globalThis.fetch = original;
    server.stop(true);
  }
});
