import { expect, test } from "bun:test";
import { fixture, until } from "../../../../tests/fixtures";
import {
  WorkflowDraftStore,
  submitWorkflow,
  type DraftFields,
  type PendingSubmission,
} from "./workflow-draft";

function storage() {
  const data = new Map<string, string>();
  return {
    data,
    port: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
      removeItem: (key: string) => {
        data.delete(key);
      },
    },
  };
}
function fields(input: PendingSubmission["request"]): DraftFields {
  const { commandId, ...draft } = input;
  return { ...draft, orchestrator: { canCreateNodes: false, maxNodes: 2 } };
}

test("incomplete drafts survive reload with stable node identities and stay scoped to their workspace", async () => {
  const f = await fixture(),
    disk = storage();
  try {
    const store = new WorkflowDraftStore(() => disk.port),
      draft = { ...fields(f.input), name: "", task: "unfinished" };
    store.save(f.workspace, draft);
    const reloaded = new WorkflowDraftStore(() => disk.port).load(f.workspace)!;
    expect(reloaded.fields.name).toBe("");
    expect(reloaded.fields.task).toBe("unfinished");
    expect(reloaded.fields.members[0].id).toBe(f.input.members[0].id);
    expect(store.load(f.home)).toBeUndefined();
    expect(store.discard(f.workspace)).toBe(true);
    expect(store.load(f.workspace)).toBeUndefined();
    expect(store.restore(f.workspace)).toBe(true);
    expect(store.load(f.workspace)?.fields.task).toBe("unfinished");
    store.clear(f.workspace);
    expect(store.load(f.workspace)).toBeUndefined();
    expect(store.restore(f.workspace)).toBe(false);
  } finally {
    await f.close();
  }
});

test("invalid cache is ignored and unavailable storage preserves in-tab editing and undo", async () => {
  const f = await fixture(),
    disk = storage();
  try {
    const store = new WorkflowDraftStore(() => disk.port);
    store.save(f.workspace, fields(f.input));
    const key = [...disk.data.keys()][0];
    const raw = JSON.parse(disk.data.get(key)!);
    raw.fields.members[0].cli = "shell-injection";
    disk.data.set(key, JSON.stringify(raw));
    expect(
      new WorkflowDraftStore(() => disk.port).load(f.workspace),
    ).toBeUndefined();
    const blocked = new WorkflowDraftStore(() => ({
      getItem: () => {
        throw Error("unavailable");
      },
      setItem: () => {
        throw Error("quota");
      },
      removeItem: () => {
        throw Error("unavailable");
      },
    }));
    blocked.save(f.workspace, fields(f.input));
    expect(blocked.load(f.workspace)?.fields.task).toBe(f.input.task);
    blocked.discard(f.workspace);
    expect(blocked.load(f.workspace)).toBeUndefined();
    expect(blocked.restore(f.workspace)).toBe(true);
    expect(blocked.load(f.workspace)?.fields.members).toHaveLength(1);
  } finally {
    await f.close();
  }
});

test("losing the create response then reloading does not create a second workflow or change its node IDs", async () => {
  const f = await fixture(),
    disk = storage(),
    cache = new WorkflowDraftStore(() => disk.port);
  try {
    let lost = true;
    const submission: PendingSubmission = {
      request: f.input,
      launchId: crypto.randomUUID(),
    };
    cache.save(f.workspace, fields(f.input), submission);
    const client = {
      create: async (input: PendingSubmission["request"]) => {
        const workflow = await f.service.create(input);
        if (lost) {
          lost = false;
          throw Error("response lost");
        }
        return workflow;
      },
      launch: async (id: string, commandId: string) => {
        await f.service.start(id, commandId);
      },
    };
    await expect(
      submitWorkflow(
        submission,
        client,
        () => cache.save(f.workspace, fields(f.input), submission),
        false,
      ),
    ).rejects.toThrow("lost");
    const restored = new WorkflowDraftStore(() => disk.port).load(
      f.workspace,
    )!.submission!;
    const id = await submitWorkflow(
      restored,
      client,
      () => cache.save(f.workspace, fields(f.input), restored),
      true,
    );
    expect(f.store.listWorkflows()).toHaveLength(1);
    expect(f.store.workflow(id).members[0].id).toBe(f.input.members[0].id);
    const run = f.store.listRuns(id)[0];
    await until(() => f.store.run(run.id).state === "awaiting_confirmation");
    expect(f.runtime.starts).toHaveLength(1);
    await f.service.confirm(run.id, crypto.randomUUID());
  } finally {
    await f.service.waitForCleanup();
    await f.close();
  }
});

test("losing the launch response restores the saved workflow and replays only the original launch command", async () => {
  const f = await fixture(),
    disk = storage(),
    cache = new WorkflowDraftStore(() => disk.port);
  try {
    let lost = true,
      creates = 0;
    const submission: PendingSubmission = {
      request: f.input,
      launchId: crypto.randomUUID(),
    };
    cache.save(f.workspace, fields(f.input), submission);
    const client = {
      create: async (input: PendingSubmission["request"]) => {
        creates++;
        return f.service.create(input);
      },
      launch: async (id: string, commandId: string) => {
        await f.service.start(id, commandId);
        if (lost) {
          lost = false;
          throw Error("response lost");
        }
      },
    };
    await expect(
      submitWorkflow(
        submission,
        client,
        () => cache.save(f.workspace, fields(f.input), submission),
        true,
      ),
    ).rejects.toThrow("lost");
    const restored = new WorkflowDraftStore(() => disk.port).load(
      f.workspace,
    )!.submission!;
    expect(restored.workflowId).toBeString();
    expect(restored.launchId).toBe(submission.launchId);
    await submitWorkflow(
      restored,
      client,
      () => cache.save(f.workspace, fields(f.input), restored),
      true,
    );
    expect(creates).toBe(1);
    expect(f.store.listRuns(restored.workflowId!)).toHaveLength(1);
    const run = f.store.listRuns(restored.workflowId!)[0];
    await until(() => f.store.run(run.id).state === "awaiting_confirmation");
    expect(f.runtime.starts).toHaveLength(1);
    await f.service.confirm(run.id, crypto.randomUUID());
  } finally {
    await f.service.waitForCleanup();
    await f.close();
  }
});
