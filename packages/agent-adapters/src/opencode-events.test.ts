import { expect, test } from "bun:test";
import type { RuntimeObservation } from "@agent-desk/agent-runtime";
import { OpenCodeEvents, openCodeEventStream } from "./opencode-events";
import { redact } from "./index";

function fixture() {
  const observed: { session: string; event: RuntimeObservation }[] = [];
  const events = new OpenCodeEvents(
    (session, event) => observed.push({ session, event }),
    (session) => session === "session-a",
    (text) => redact(text, "private-test-key"),
  );
  const consume = (type: string, properties: unknown) =>
    events.consume({ type, properties });
  const message = (role = "assistant", sessionID = "session-a") =>
    consume("message.updated", { sessionID, info: { id: "message-a", role } });
  const part = (text = "", type = "text", sessionID = "session-a") =>
    consume("message.part.updated", {
      sessionID,
      part: { id: "part-a", messageID: "message-a", sessionID, type, text },
    });
  const delta = (
    text: string,
    sessionID = "session-a",
    messageID = "message-a",
  ) =>
    consume("message.part.delta", {
      sessionID,
      messageID,
      partID: "part-a",
      field: "text",
      delta: text,
    });
  return { observed, events, consume, message, part, delta };
}

test("deltas become immediate full part updates; final snapshots do not duplicate text", () => {
  const f = fixture();
  f.message();
  f.part();
  f.delta("正在");
  f.delta("检查");
  expect(
    f.observed.map((x) => (x.event.type === "output" ? x.event.text : "")),
  ).toEqual(["正在", "正在检查"]);
  f.part("正在检查");
  expect(f.observed).toHaveLength(2);
  f.part("检查完成");
  expect(f.observed.at(-1)?.event).toMatchObject({
    id: "part-a",
    role: "assistant",
    text: "检查完成",
  });
});
test("reasoning comes only from native reasoning parts and unknown/user/session deltas are ignored", () => {
  const f = fixture();
  f.message("user");
  f.part();
  f.delta("user text");
  f.delta("unknown part", "session-b");
  expect(f.observed).toHaveLength(0);
  f.message();
  f.delta("no known assistant part");
  // The user part did not create an assistant delta target.
  expect(f.observed).toHaveLength(0);
  f.part("", "reasoning");
  f.delta("计划先读取文件");
  f.delta("wrong message", "session-a", "another-message");
  f.delta("wrong session", "session-b");
  expect(f.observed).toHaveLength(1);
  expect(f.observed[0]).toMatchObject({
    session: "session-a",
    event: { role: "reasoning", text: "计划先读取文件" },
  });
});
test("native tool failures and permission requests preserve routing and redact credentials", () => {
  const f = fixture();
  f.message();
  f.consume("message.part.updated", {
    sessionID: "session-a",
    part: {
      id: "tool-a",
      messageID: "message-a",
      type: "tool",
      tool: "read",
      state: {
        status: "error",
        input: { filePath: "public.txt" },
        error: "private-test-key denied",
      },
    },
  });
  f.consume("permission.asked", {
    sessionID: "session-a",
    id: "permission-a",
    permission: "read",
    patterns: ["public.txt"],
    metadata: { detail: "private-test-key" },
  });
  expect(f.observed[0].event).toMatchObject({
    role: "tool",
    text: expect.stringContaining("[已隐藏] denied"),
  });
  expect(f.observed[1]).toMatchObject({
    session: "session-a",
    event: { type: "approval", id: "permission-a", tool: "read" },
  });
  expect(JSON.stringify(f.observed)).not.toContain("private-test-key");
  expect(() =>
    f.consume("permission.asked", {
      sessionID: "session-a",
      permission: "read",
    }),
  ).toThrow("输出格式");
});
test("SSE parser accepts CRLF and multiline JSON across single-byte UTF-8 fragments", () => {
  const f = fixture();
  const stream = openCodeEventStream(f.events);
  const frames = [
    {
      type: "message.updated",
      properties: {
        sessionID: "session-a",
        info: { id: "message-a", role: "assistant" },
      },
    },
    {
      type: "message.part.updated",
      properties: {
        sessionID: "session-a",
        part: { id: "part-a", messageID: "message-a", type: "text", text: "" },
      },
    },
    {
      type: "message.part.delta",
      properties: {
        sessionID: "session-a",
        partID: "part-a",
        messageID: "message-a",
        field: "text",
        delta: "实时输出🙂",
      },
    },
  ];
  const source =
    ": heartbeat\r\n\r\n" +
    frames
      .map(
        (value) =>
          JSON.stringify(value, null, 2)
            .split("\n")
            .map((line) => "data: " + line)
            .join("\r\n") + "\r\n\r\n",
      )
      .join("");
  for (const byte of new TextEncoder().encode(source))
    stream.feed(Uint8Array.of(byte));
  expect(f.observed).toHaveLength(1);
  expect(f.observed[0].event).toMatchObject({ text: "实时输出🙂" });
});
test("invalid or oversized SSE fails explicitly while unknown native events remain forward compatible", () => {
  const f = fixture();
  f.consume("server.heartbeat", {});
  f.consume("constructor", {});
  expect(f.observed).toHaveLength(0);
  expect(() =>
    openCodeEventStream(f.events).feed(
      new TextEncoder().encode("data: invalid\n\n"),
    ),
  ).toThrow("输出格式");
  expect(() =>
    openCodeEventStream(f.events).feed(
      new TextEncoder().encode("data: " + "x".repeat(1000001)),
    ),
  ).toThrow("事件过大");
  f.message();
  expect(() =>
    f.consume("message.part.updated", {
      sessionID: "session-a",
      part: {
        id: "part-a",
        messageID: "message-a",
        sessionID: "session-b",
        type: "text",
        text: "wrong",
      },
    }),
  ).toThrow("输出格式");
});
