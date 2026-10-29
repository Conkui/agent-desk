import { z } from "zod";
import { CreateWorkflowSchema, MemberSchema } from "@agent-desk/contracts";

// Incomplete names/tasks are valid drafts. Only the committed request uses the full server schema.
const FieldsSchema = z
  .object(CreateWorkflowSchema.shape)
  .omit({ commandId: true })
  .extend({
    name: z.string().max(100),
    task: z.string().max(16000),
    directory: z.string().max(4096),
    members: z
      .array(MemberSchema.extend({ name: z.string().max(80) }))
      .min(1)
      .max(12),
    orchestrator: z.object({
      canCreateNodes: z.boolean(),
      maxNodes: z.number().int().min(0).max(12),
    }),
  })
  .strict()
  .superRefine((fields, context) => {
    if (
      fields.members.filter((member) => member.roles.includes("coordinator"))
        .length !== 1 ||
      new Set(fields.members.map((member) => member.id)).size !==
        fields.members.length
    )
      context.addIssue({ code: "custom", message: "Invalid draft members" });
  });
const SubmissionSchema = z
  .object({
    request: CreateWorkflowSchema,
    launchId: z.uuid(),
    workflowId: z.uuid().optional(),
  })
  .strict();
const CacheSchema = z
  .object({
    version: z.literal(1),
    fields: FieldsSchema,
    submission: SubmissionSchema.optional(),
  })
  .strict();
export type DraftFields = z.infer<typeof FieldsSchema>;
export type PendingSubmission = z.infer<typeof SubmissionSchema>;
export type CachedWorkflowDraft = z.infer<typeof CacheSchema>;
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
function browserStorage(): StoragePort | undefined {
  try {
    return typeof sessionStorage === "undefined" ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
}

/** One tab/workspace owns its draft. The in-memory copy also covers unavailable browser storage. */
export class WorkflowDraftStore {
  private memory = new Map<string, string>();
  constructor(
    private storage: () => StoragePort | undefined = browserStorage,
  ) {}
  private key(workspace: string) {
    return `agent-desk:new-workflow:${encodeURIComponent(workspace)}`;
  }
  private read(key: string) {
    try {
      return this.memory.get(key) ?? this.storage()?.getItem(key) ?? undefined;
    } catch {
      return this.memory.get(key);
    }
  }
  private write(key: string, value: string) {
    this.memory.set(key, value);
    try {
      this.storage()?.setItem(key, value);
    } catch {
      /* Editing remains usable in this tab. */
    }
  }
  private remove(key: string) {
    this.memory.delete(key);
    try {
      this.storage()?.removeItem(key);
    } catch {
      /* The in-memory tombstone prevents restoring a stale disk copy. */ this.memory.set(
        key,
        "",
      );
    }
  }
  load(workspace: string): CachedWorkflowDraft | undefined {
    try {
      const parsed = CacheSchema.safeParse(
        JSON.parse(this.read(this.key(workspace)) ?? "null"),
      );
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }
  save(workspace: string, fields: DraftFields, submission?: PendingSubmission) {
    const parsed = CacheSchema.safeParse({ version: 1, fields, submission });
    if (parsed.success)
      this.write(this.key(workspace), JSON.stringify(parsed.data));
  }
  clear(workspace: string) {
    this.remove(this.key(workspace));
    this.remove(this.key(workspace) + ":discarded");
  }
  discard(workspace: string) {
    const draft = this.load(workspace);
    if (draft)
      this.write(this.key(workspace) + ":discarded", JSON.stringify(draft));
    this.remove(this.key(workspace));
    return !!draft;
  }
  restore(workspace: string) {
    try {
      const parsed = CacheSchema.safeParse(
        JSON.parse(this.read(this.key(workspace) + ":discarded") ?? "null"),
      );
      if (!parsed.success) return false;
      this.write(this.key(workspace), JSON.stringify(parsed.data));
      this.remove(this.key(workspace) + ":discarded");
      return true;
    } catch {
      return false;
    }
  }
}
export const workflowDrafts = new WorkflowDraftStore();

export type SubmissionClient = {
  create: (request: PendingSubmission["request"]) => Promise<{ id: string }>;
  launch: (workflowId: string, commandId: string) => Promise<void>;
};
/** Persist each acknowledged boundary; retries always reuse the frozen create and launch identities. */
export async function submitWorkflow(
  submission: PendingSubmission,
  client: SubmissionClient,
  persist: () => void,
  launch: boolean,
) {
  if (!submission.workflowId) {
    const workflow = await client.create(submission.request);
    submission.workflowId = workflow.id;
    persist();
  }
  if (launch) await client.launch(submission.workflowId, submission.launchId);
  return submission.workflowId;
}
