import { z } from "zod";
import { createParser } from "eventsource-parser";
import { AppError } from "@agent-desk/contracts";
import type { RuntimeObservation } from "@agent-desk/agent-runtime";

const id = z.string().min(1).max(256);
const schemas = {
  "message.updated": z.object({
    sessionID: id,
    info: z.object({ id, role: z.enum(["user", "assistant"]) }),
  }),
  "message.part.updated": z.object({ sessionID: id, part: z.unknown() }),
  "message.part.delta": z.object({
    sessionID: id,
    messageID: id,
    partID: id,
    field: z.string(),
    delta: z.string(),
  }),
  "permission.asked": z.object({
    sessionID: id,
    id,
    permission: z.string().min(1),
    patterns: z.array(z.string()).optional(),
    metadata: z.unknown().optional(),
  }),
};
const partSchema = z.object({
  id,
  messageID: id,
  sessionID: id.optional(),
  type: z.string(),
  text: z.string().optional(),
  tool: z.string().optional(),
  state: z
    .object({
      status: z.string().optional(),
      input: z.unknown().optional(),
      output: z.unknown().optional(),
      error: z.string().optional(),
    })
    .optional(),
});
type TextPart = {
  messageID: string;
  role: "assistant" | "reasoning";
  text: string;
};

/** Native snapshots replace a part; deltas extend that same part. Session and
 * message identities are checked before mapping either to a workflow node. */
export class OpenCodeEvents {
  private roles = new Map<string, string>();
  private parts = new Map<string, TextPart>();
  private emitted = new Map<string, string>();
  constructor(
    private observe: (session: string, observation: RuntimeObservation) => void,
    private accepts: (session: string) => boolean,
    private redact: (text: string) => string,
  ) {}
  private key(session: string, item: string) {
    return `${session}:${item}`;
  }
  private output(
    session: string,
    partID: string,
    role: "assistant" | "reasoning" | "tool",
    text: string,
  ) {
    const key = this.key(session, partID),
      safe = this.redact(text).slice(0, 100000);
    if (!safe || this.emitted.get(key) === safe) return;
    this.emitted.set(key, safe);
    this.observe(session, { type: "output", id: partID, role, text: safe });
  }
  consume(raw: unknown) {
    const envelope = z
      .object({ type: z.string(), properties: z.unknown().optional() })
      .safeParse(raw);
    if (!envelope.success) throw this.invalid();
    const { type, properties } = envelope.data;
    if (!Object.hasOwn(schemas, type)) return;
    const parsed = schemas[type as keyof typeof schemas].safeParse(properties);
    if (!parsed.success) throw this.invalid();
    const session = parsed.data.sessionID;
    if (!this.accepts(session)) return;
    if (type === "message.updated") {
      const p = schemas["message.updated"].parse(properties);
      this.roles.set(this.key(session, p.info.id), p.info.role);
    } else if (type === "message.part.updated") {
      const p = schemas["message.part.updated"].parse(properties);
      const part = partSchema.safeParse(p.part);
      if (!part.success) throw this.invalid();
      const item = part.data;
      if (item.sessionID && item.sessionID !== session) throw this.invalid();
      if (this.roles.get(this.key(session, item.messageID)) !== "assistant")
        return;
      if (item.type === "text" || item.type === "reasoning") {
        const role = item.type === "reasoning" ? "reasoning" : "assistant";
        const text = (item.text ?? "").slice(0, 100000);
        this.parts.set(this.key(session, item.id), {
          messageID: item.messageID,
          role,
          text,
        });
        this.output(session, item.id, role, text);
      } else if (item.type === "tool") {
        this.output(
          session,
          item.id,
          "tool",
          `${item.tool ?? "tool"} · ${item.state?.status ?? ""}\n${item.state?.input ? JSON.stringify(item.state.input) : ""}\n${String(item.state?.output ?? item.state?.error ?? "").slice(0, 12000)}`,
        );
      }
    } else if (type === "message.part.delta") {
      const p = schemas["message.part.delta"].parse(properties);
      if (p.field !== "text") return;
      const part = this.parts.get(this.key(session, p.partID));
      if (
        !part ||
        part.messageID !== p.messageID ||
        this.roles.get(this.key(session, p.messageID)) !== "assistant"
      )
        return;
      part.text = (part.text + p.delta).slice(0, 100000);
      this.output(session, p.partID, part.role, part.text);
    } else if (type === "permission.asked") {
      const p = schemas["permission.asked"].parse(properties);
      this.observe(session, {
        type: "approval",
        id: p.id,
        tool: p.permission,
        detail: this.redact(
          JSON.stringify({ patterns: p.patterns, metadata: p.metadata }),
        ),
      });
    }
  }
  private invalid() {
    return new AppError(
      "runtime_events_protocol",
      "OpenCode 输出格式不匹配，本轮已停止。",
      502,
    );
  }
}

/** Reuse the SSE parser for CRLF, multiline data and arbitrary UTF-8 chunks. */
export function openCodeEventStream(events: OpenCodeEvents) {
  const decoder = new TextDecoder();
  const parser = createParser({
    maxBufferSize: 1_000_000,
    onError(error) {
      if (error.type === "max-buffer-size-exceeded")
        throw new AppError(
          "runtime_events_size",
          "OpenCode 输出事件过大，本轮已停止。",
          502,
        );
    },
    onEvent(event) {
      let raw: unknown;
      try {
        raw = JSON.parse(event.data);
      } catch {
        throw new AppError(
          "runtime_events_protocol",
          "OpenCode 输出格式不匹配，本轮已停止。",
          502,
        );
      }
      events.consume(raw);
    },
  });
  return {
    feed(chunk: Uint8Array) {
      parser.feed(decoder.decode(chunk, { stream: true }));
    },
  };
}
