import { expect, test } from "bun:test";
import { fixture, until } from "../../../tests/fixtures";
import { AppError, runBlocksStart } from "@agent-desk/contracts";

test("an archive committed while a start is being prepared prevents dispatch", async () => {
  const f = await fixture();
  let preparing = false;
  let finish!: () => void;
  f.runtime.prepare = async () => {
    preparing = true;
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
  };
  try {
    const workflow = await f.service.create(f.input);
    const starting = f.service.start(workflow.id, crypto.randomUUID());
    await until(() => preparing);
    await f.service.archive(workflow.id, 1, true, crypto.randomUUID());
    finish();
    await expect(starting).rejects.toThrow("还原");
    expect(f.store.listRuns(workflow.id)).toHaveLength(0);
    expect(f.runtime.starts).toHaveLength(0);
  } finally {
    finish?.();
    await f.close();
  }
});

test("archive is reversible and versioned, duplication never copies history or member identities", async () => {
  const f = await fixture();
  try {
    const original = await f.service.create(f.input);
    const archiveId = crypto.randomUUID();
    const archived = await f.service.archive(original.id, 1, true, archiveId);
    expect(archived.archivedAt).toBeNumber();
    expect(
      (await f.service.archive(original.id, 1, true, archiveId)).version,
    ).toBe(2);
    await expect(
      f.service.start(original.id, crypto.randomUUID()),
    ).rejects.toThrow("还原");
    await expect(
      f.service.archive(original.id, 1, false, crypto.randomUUID()),
    ).rejects.toThrow("已更新");
    const copyId = crypto.randomUUID();
    const copy = await f.service.duplicate(original.id, copyId);
    expect((await f.service.duplicate(original.id, copyId)).id).toBe(copy.id);
    expect(copy.archivedAt).toBeUndefined();
    expect(copy.members[0].id).not.toBe(original.members[0].id);
    expect(f.store.listRuns(copy.id)).toHaveLength(0);
    const restored = await f.service.archive(
      original.id,
      2,
      false,
      crypto.randomUUID(),
    );
    expect(restored.archivedAt).toBeUndefined();
    const run = await f.service.start(original.id, crypto.randomUUID());
    await until(() => f.store.run(run.id).state === "awaiting_confirmation");
    await expect(
      f.service.archive(original.id, 3, true, crypto.randomUUID()),
    ).rejects.toThrow("结束");
    await f.service.confirm(run.id, crypto.randomUUID());
  } finally {
    await f.service.waitForCleanup();
    await f.close();
  }
});

test("failed execution releases the CLI without losing its failure and retries the immutable task once", async () => {
  const f = await fixture();
  const execute = f.runtime.execute.bind(f.runtime);
  let fail = true;
  f.runtime.execute = async (...args) => {
    if (fail) throw new AppError("runtime_disconnected", "本机连接中断。", 502);
    return execute(...args);
  };
  try {
    const workflow = await f.service.create(f.input);
    const run = await f.service.start(workflow.id, crypto.randomUUID());
    await until(() => f.store.run(run.id).cleanupState === "released");
    const failed = f.store.run(run.id);
    expect(failed.state).toBe("failed");
    expect(
      f.store.events(run.id, 0).find((event) => event.type === "run.failed")
        ?.payload.code,
    ).toBe("runtime_disconnected");
    expect(f.runtime.stopped).toContain(run.id);
    expect(runBlocksStart(failed)).toBe(false);
    await f.service.update(workflow.id, {
      ...f.input,
      commandId: crypto.randomUUID(),
      expectedVersion: 1,
      task: "Changed task",
    });
    fail = false;
    const commandId = crypto.randomUUID();
    const retried = await f.service.retry(run.id, commandId);
    expect((await f.service.retry(run.id, commandId)).id).toBe(retried.id);
    await until(
      () => f.store.run(retried.id).state === "awaiting_confirmation",
    );
    expect(retried.definition.task).toBe(f.input.task);
    expect(retried.retryOf).toBe(run.id);
    expect(f.store.workflow(workflow.id).task).toBe("Changed task");
    expect(f.runtime.starts).toHaveLength(1);
    expect(f.store.run(retried.id).phase).toBe("finished");
    await f.service.confirm(retried.id, crypto.randomUUID());
  } finally {
    await f.service.waitForCleanup();
    await f.close();
  }
});

test("unconfirmed cleanup blocks both new runs and retry; explicit stopping can release it", async () => {
  const f = await fixture();
  f.runtime.execute = async () => {
    throw Error("mock failure");
  };
  const stop = f.runtime.stop.bind(f.runtime);
  f.runtime.stop = async () => {
    throw Error("mock stop failure");
  };
  try {
    const workflow = await f.service.create(f.input);
    const run = await f.service.start(workflow.id, crypto.randomUUID());
    await until(() => f.store.run(run.id).cleanupState === "unknown");
    expect(runBlocksStart(f.store.run(run.id))).toBe(true);
    await expect(f.service.retry(run.id, crypto.randomUUID())).rejects.toThrow(
      "结束",
    );
    await expect(
      f.service.start(workflow.id, crypto.randomUUID()),
    ).rejects.toThrow("运行");
    f.runtime.stop = stop;
    const stopped = await f.service.stop(run.id, crypto.randomUUID());
    expect(stopped.state).toBe("failed");
    expect(stopped.cleanupState).toBe("released");
    expect(runBlocksStart(stopped)).toBe(false);
  } finally {
    await f.service.waitForCleanup();
    await f.close();
  }
});

test("planning JSON is excluded from the final user result", async () => {
  const f = await fixture();
  const execute = f.runtime.execute.bind(f.runtime);
  f.runtime.execute = async (run, member, text, observe, options) => {
    if (options?.outputSchema) {
      observe({
        type: "output",
        id: "plan-output",
        role: "assistant",
        text: '{"nodes":[]}',
      });
      return { nodes: [] };
    }
    return execute(run, member, text, observe, options);
  };
  try {
    const workflow = await f.service.create({
      ...f.input,
      orchestrator: { canCreateNodes: true, maxNodes: 2 },
    });
    const run = await f.service.start(workflow.id, crypto.randomUUID());
    await until(() => f.store.run(run.id).state === "awaiting_confirmation");
    const result = f.store.run(run.id).handoffs?.at(-1)?.text;
    expect(result).toContain("test result");
    expect(result).not.toContain('"nodes"');
    await f.service.confirm(run.id, crypto.randomUUID());
  } finally {
    await f.service.waitForCleanup();
    await f.close();
  }
});
