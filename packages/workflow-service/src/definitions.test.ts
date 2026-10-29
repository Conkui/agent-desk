import { expect, test } from "bun:test";
import { fixture, until } from "../../../tests/fixtures";
import { UpdateWorkflowSchema } from "@agent-desk/contracts";
test("definition edits are versioned and idempotent; old runs retain their original graph and task", async () => {
  const f = await fixture();
  try {
    const workflow = await f.service.create(f.input);
    const run = await f.service.start(workflow.id, crypto.randomUUID());
    await until(() => f.store.run(run.id).state === "awaiting_confirmation");
    const input = {
      ...f.input,
      commandId: crypto.randomUUID(),
      expectedVersion: 1,
      name: "Edited",
      task: "New task",
      members: [
        ...f.input.members,
        {
          ...f.input.members[0],
          id: crypto.randomUUID(),
          name: "New node",
          roles: ["worker"] as ["worker"],
        },
      ],
      orchestrator: { canCreateNodes: false, maxNodes: 3 },
    };
    const updated = await f.service.update(workflow.id, input);
    expect(updated.version).toBe(2);
    expect((await f.service.update(workflow.id, input)).version).toBe(2);
    expect(f.store.workflow(workflow.id).members).toHaveLength(2);
    expect(f.store.run(run.id).definition.task).toBe(f.input.task);
    expect(f.store.run(run.id).members).toHaveLength(1);
    await expect(
      f.service.update(workflow.id, {
        ...input,
        commandId: crypto.randomUUID(),
      }),
    ).rejects.toThrow("已在别处更新");
    await expect(
      f.service.update(workflow.id, {
        ...input,
        commandId: crypto.randomUUID(),
        expectedVersion: 2,
        directory: f.home,
      }),
    ).rejects.toThrow("授权工作目录");
    await f.service.confirm(run.id, crypto.randomUUID());
    const next = await f.service.start(workflow.id, crypto.randomUUID());
    await until(() => f.store.run(next.id).state === "awaiting_confirmation");
    expect(f.store.run(next.id).definition.task).toBe("New task");
    expect(f.store.run(next.id).members).toHaveLength(2);
    expect(
      UpdateWorkflowSchema.safeParse({ ...input, members: [] }).success,
    ).toBe(false);
  } finally {
    await f.close();
  }
});
