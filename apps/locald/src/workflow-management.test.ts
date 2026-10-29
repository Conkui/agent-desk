import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { createLocalServer } from "./server";
import { fixture, until } from "../../../tests/fixtures";

test("management HTTP validates commands, restores archives and retries the original snapshot", async () => {
  const f = await fixture();
  const app = await createLocalServer({
    root: resolve(import.meta.dir, "../../.."),
    home: f.home,
    workspace: f.workspace,
    port: 0,
    runtime: f.runtime,
    store: f.store,
    profiles: f.profiles,
  });
  const base = `http://127.0.0.1:${app.server.port}/api/v1`;
  try {
    const login = await fetch(base + "/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        password: (
          await Bun.file(f.home + "/connection-password.txt").text()
        ).trim(),
      }),
    });
    const headers = {
      cookie: login.headers.get("set-cookie")!.split(";")[0],
      "content-type": "application/json",
    };
    const post = (path: string, body: unknown) =>
      fetch(base + path, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    const workflow = await f.service.create(f.input);
    const copied = await post(`/workflows/${workflow.id}/duplicate`, {
      commandId: crypto.randomUUID(),
    });
    expect(copied.status).toBe(201);
    const copy = ((await copied.json()) as any).workflow;
    expect(copy.members[0].id).not.toBe(workflow.members[0].id);
    expect(
      (
        await post(`/workflows/${copy.id}/archive`, {
          commandId: crypto.randomUUID(),
          expectedVersion: 0,
          archived: true,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post(`/workflows/${copy.id}/archive`, {
          commandId: crypto.randomUUID(),
          expectedVersion: 1,
          archived: true,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await post(`/workflows/${copy.id}/runs`, {
          commandId: crypto.randomUUID(),
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await post(`/workflows/${copy.id}/archive`, {
          commandId: crypto.randomUUID(),
          expectedVersion: 2,
          archived: false,
        })
      ).status,
    ).toBe(200);
    const run = await f.service.start(workflow.id, crypto.randomUUID());
    await until(() => f.store.run(run.id).state === "awaiting_confirmation");
    expect(
      (await post(`/runs/${run.id}/retry`, { commandId: crypto.randomUUID() }))
        .status,
    ).toBe(409);
    await f.service.confirm(run.id, crypto.randomUUID());
    const retried = await post(`/runs/${run.id}/retry`, {
      commandId: crypto.randomUUID(),
    });
    expect(retried.status).toBe(202);
    const next = ((await retried.json()) as any).run;
    expect(next.retryOf).toBe(run.id);
    await until(() => f.store.run(next.id).state === "awaiting_confirmation");
    await f.service.confirm(next.id, crypto.randomUUID());
    expect(f.store.listRuns(copy.id)).toHaveLength(0);
  } finally {
    await app.close();
    await f.close();
  }
});
