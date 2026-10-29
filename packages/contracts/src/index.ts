import { z } from "zod";

import { CliSchema, ProtocolSchema } from "./agents";
export * from "./agents";
export const CommandSchema = z.object({ commandId: z.uuid() }).strict();
export const OrchestratorSchema = z
  .object({
    canCreateNodes: z.boolean(),
    maxNodes: z.number().int().min(1).max(12),
  })
  .strict();
export const PlanSchema = z
  .object({
    nodes: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(80),
            responsibility: z.string().trim().min(1).max(1000),
          })
          .strict(),
      )
      .max(11),
  })
  .strict();
export const PlanJsonSchema = z.toJSONSchema(PlanSchema);
export const MemberSchema = z
  .object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(80),
    cli: CliSchema,
    roles: z
      .array(z.enum(["coordinator", "worker"]))
      .min(1)
      .max(2),
    responsibility: z.string().trim().max(1000),
  })
  .strict();
export const CreateWorkflowSchema = z
  .object({
    commandId: z.uuid(),
    name: z.string().trim().min(1).max(100),
    task: z.string().trim().min(1).max(16000),
    directory: z.string().trim().min(1).max(4096),
    members: z.array(MemberSchema).min(1).max(12),
    permissionPolicy: z.enum(["ask", "read-only"]).default("ask"),
    orchestrator: OrchestratorSchema.optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      input.orchestrator &&
      input.orchestrator.maxNodes < input.members.length
    )
      context.addIssue({
        code: "custom",
        message: "Node limit must include preset nodes",
      });
    if (
      input.members.filter((member) => member.roles.includes("coordinator"))
        .length !== 1
    )
      context.addIssue({
        code: "custom",
        message: "Exactly one coordinator is required",
      });
    if (!input.members.some((member) => member.roles.includes("worker")))
      context.addIssue({
        code: "custom",
        message: "At least one working member is required",
      });
    if (
      new Set(input.members.map((member) => member.id)).size !==
      input.members.length
    )
      context.addIssue({ code: "custom", message: "Duplicate member ID" });
  });
export type CreateWorkflow = z.infer<typeof CreateWorkflowSchema>;
export const UpdateWorkflowSchema = CreateWorkflowSchema.safeExtend({
  expectedVersion: z.number().int().positive(),
});
export type UpdateWorkflow = z.infer<typeof UpdateWorkflowSchema>;
export const ArchiveWorkflowSchema = CommandSchema.extend({
  expectedVersion: z.number().int().positive(),
  archived: z.boolean(),
});
export const DuplicateWorkflowSchema = CommandSchema.extend({
  name: z.string().trim().min(1).max(100).optional(),
});
export type Workflow = Omit<CreateWorkflow, "commandId"> & {
  id: string;
  createdAt: number;
  version?: number;
  updatedAt?: number;
  archivedAt?: number;
};
export type RunState =
  | "dispatching"
  | "running"
  | "waiting_approval"
  | "needs_reconcile"
  | "stopping"
  | "stopped"
  | "failed"
  | "awaiting_confirmation"
  | "completed";
export type MemberState =
  | "queued"
  | "running"
  | "waiting_approval"
  | "idle"
  | "failed"
  | "stopped";
export type Message = {
  id: string;
  role: "user" | "assistant" | "tool" | "reasoning";
  text: string;
  time: number;
};
export type Approval = {
  id: string;
  nativeId: string;
  memberId: string;
  tool: string;
  detail: string;
  state: "pending" | "resolving" | "allowed" | "denied";
  createdAt: number;
};
export type RunMember = z.infer<typeof MemberSchema> & {
  state: MemberState;
  messages: Message[];
  error?: string;
};
export type Handoff = {
  id: string;
  from: string;
  to: string;
  text: string;
  time: number;
  kind: "task" | "result" | "message";
};
export type Run = {
  id: string;
  workflowId: string;
  namespace: "default";
  definition: Workflow;
  state: RunState;
  members: RunMember[];
  approvals: Approval[];
  handoffs?: Handoff[];
  createdAt: number;
  updatedAt: number;
  version: number;
  lastSequence: number;
  error?: string;
  phase?: "planning" | "working" | "summarizing" | "finished";
  activeMemberId?: string;
  cleanupState?: "releasing" | "released" | "unknown";
  retryOf?: string;
};
export type RunEvent = {
  schemaVersion: 1;
  eventId: string;
  runId: string;
  sequence: number;
  time: number;
  type: string;
  payload: Record<string, unknown>;
};
export type RunSummary = Pick<
  Run,
  "id" | "workflowId" | "state" | "createdAt" | "updatedAt"
> &
  Pick<Run, "phase" | "cleanupState" | "retryOf"> & { memberCount: number };

/** Terminal state alone does not prove a CLI was released. Legacy failed runs still require a stop. */
export function runBlocksStart(run: Pick<Run, "state" | "cleanupState">) {
  if (run.cleanupState === "unknown" || run.cleanupState === "releasing")
    return true;
  return (
    !["completed", "stopped"].includes(run.state) &&
    !(run.state === "failed" && run.cleanupState === "released")
  );
}
export type Installation = {
  cli: string;
  name: string;
  installed: boolean;
  supported: boolean;
  reason?: string;
  path?: string;
  commands?: string[];
  repository?: string;
};
export const SendMessageSchema = z
  .object({ commandId: z.uuid(), text: z.string().trim().min(1).max(16000) })
  .strict();
export const ResolveApprovalSchema = z
  .object({
    commandId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    decision: z.enum(["allow", "deny"]),
  })
  .strict();
export const ProfileSchema = z
  .object({
    protocol: ProtocolSchema,
    baseUrl: z.string().trim().pipe(z.url().max(2048)),
    model: z.string().trim().min(1).max(200),
    apiKey: z
      .string()
      .trim()
      .max(4096)
      .transform((value) => value || undefined)
      .optional(),
  })
  .strict()
  .superRefine((profile, context) => {
    let url: URL;
    try {
      url = new URL(profile.baseUrl);
    } catch {
      return;
    } // z.url already records the field error.
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["127.0.0.1", "localhost"].includes(url.hostname)
        ))
    )
      context.addIssue({
        code: "custom",
        path: ["baseUrl"],
        message:
          "服务地址请使用 HTTPS（本机可用 HTTP），不要包含用户名、密码、查询参数或片段。",
      });
    if (/\/(chat\/completions|messages|responses)\/?$/i.test(url.pathname))
      context.addIssue({
        code: "custom",
        path: ["baseUrl"],
        message:
          "请填写基础地址，去掉末尾的 /chat/completions、/messages 或 /responses。",
      });
  });
export type Profile = z.infer<typeof ProfileSchema>;
export type PublicProfile = Omit<Profile, "apiKey"> & {
  cli: string;
  hasApiKey: boolean;
};
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
