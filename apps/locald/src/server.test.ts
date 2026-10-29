import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createLocalServer } from "./server";
import { fixture, until } from "../../../tests/fixtures";
import { LISTEN_HOST, privateOrigin } from "@agent-desk/transport";

describe("local boundary and independent HTTP", () => {
  test("binds only loopback, rejects public origins, cross-site requests, unpaired clients and oversized input", async () => {
    const f = await fixture(),
      app = await createLocalServer({
        root: resolve(import.meta.dir, "../../.."),
        home: f.home,
        workspace: f.workspace,
        port: 0,
        runtime: f.runtime,
        store: f.store,
        profiles: f.profiles,
      });
    try {
      expect(app.server.hostname).toBe(LISTEN_HOST);
      expect(() => privateOrigin("https://public.example.com")).toThrow();
      expect(() => privateOrigin("http://device.ts.net")).toThrow();
      expect(() => privateOrigin("https://10.attacker.example")).toThrow();
      expect(() => privateOrigin("https://192.168.attacker.example")).toThrow();
      expect(privateOrigin("https://100.100.10.20")).toBe(
        "https://100.100.10.20",
      );
      expect(privateOrigin("https://pc.example.ts.net")).toBe(
        "https://pc.example.ts.net",
      );
      const base = `http://127.0.0.1:${app.server.port}`;
      expect((await fetch(base + "/api/v1/workflows")).status).toBe(401);
      expect(
        (
          await fetch(base + "/api/v1/health", {
            headers: { host: "attacker.invalid" },
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await fetch(base + "/api/v1/health", {
            headers: { origin: "https://attacker.invalid" },
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await fetch(base + "/api/v1/auth/login", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "x".repeat(66000),
          })
        ).status,
      ).toBe(413);
      const password = (
        await readFile(f.home + "/connection-password.txt", "utf8")
      ).trim();
      const login = await fetch(base + "/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      expect(login.status).toBe(200);
      const cookie = login.headers.get("set-cookie")!.split(";")[0];
      expect(login.headers.get("set-cookie")).toContain("HttpOnly");
      const headers = { cookie, "content-type": "application/json" };
      const profile = {
        protocol: "openai-compatible",
        baseUrl: "https://api.example.invalid/v1",
        model: "test-model",
        apiKey: "fake-test-secret",
      };
      expect(
        (
          await fetch(base + "/api/v1/provider-profiles/codex", {
            method: "PUT",
            headers,
            body: JSON.stringify(profile),
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await fetch(base + "/api/v1/provider-profiles/opencode", {
            method: "PUT",
            headers,
            body: JSON.stringify(profile),
          })
        ).status,
      ).toBe(200);
      const bootstrap = await fetch(base + "/api/v1/bootstrap", { headers });
      expect(await bootstrap.text()).not.toContain("fake-test-secret");
      for (const invalid of [
        { ...profile, protocol: "authrapic" },
        { ...profile, baseUrl: "wrong url" },
        { ...profile, baseUrl: "https://example.invalid/v1/messages" },
      ]) {
        const response = await fetch(
          base + "/api/v1/provider-profiles/opencode",
          { method: "PUT", headers, body: JSON.stringify(invalid) },
        );
        expect(response.status).toBe(400);
        expect(await response.text()).not.toContain("fake-test-secret");
      }
      const anthropic = await fetch(
        base + "/api/v1/provider-profiles/opencode",
        {
          method: "PUT",
          headers,
          body: JSON.stringify({ ...profile, protocol: "anthropic" }),
        },
      );
      expect(anthropic.status).toBe(200);
      expect(await anthropic.text()).not.toContain("fake-test-secret");
      const create = await fetch(base + "/api/v1/workflows", {
        method: "POST",
        headers,
        body: JSON.stringify(f.input),
      });
      expect(create.status).toBe(201);
      const { workflow } = (await create.json()) as any;
      const edited = await fetch(base + `/api/v1/workflows/${workflow.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          ...f.input,
          commandId: crypto.randomUUID(),
          expectedVersion: 1,
          name: "Edited via HTTP",
        }),
      });
      expect(edited.status).toBe(200);
      expect(((await edited.json()) as any).workflow.version).toBe(2);
      const loaded = await fetch(base + `/api/v1/workflows/${workflow.id}`, {
        headers,
      });
      expect(((await loaded.json()) as any).workflow.name).toBe(
        "Edited via HTTP",
      );
      const stale = await fetch(base + `/api/v1/workflows/${workflow.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          ...f.input,
          commandId: crypto.randomUUID(),
          expectedVersion: 1,
        }),
      });
      expect(stale.status).toBe(409);
      const start = await fetch(
        base + `/api/v1/workflows/${workflow.id}/runs`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ commandId: crypto.randomUUID() }),
        },
      );
      const { run } = (await start.json()) as any;
      expect(start.status).toBe(202);
      await until(() => f.store.run(run.id).state === "awaiting_confirmation");
      const stream = await fetch(
        base + `/api/v1/runs/${run.id}/events?after=1`,
        { headers },
      );
      expect(stream.headers.get("content-type")).toBe("text/event-stream");
      const reader = stream.body!.getReader();
      let text = "";
      while (!text.includes("id: 2")) {
        const part = await reader.read();
        if (part.done) break;
        text += new TextDecoder().decode(part.value);
      }
      expect(text).toContain("id: 2");
      expect(text).not.toContain("id: 1\n");
      await reader.cancel();
      await fetch(base + "/api/v1/auth/logout", {
        method: "POST",
        headers,
        body: "{}",
      });
      expect(
        (await fetch(base + "/api/v1/workflows", { headers })).status,
      ).toBe(401);
    } finally {
      await app.close();
      await f.close();
    }
  });
});
