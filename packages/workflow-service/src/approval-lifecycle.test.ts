import { expect, test } from "bun:test";
import { AppError, runBlocksStart } from "@agent-desk/contracts";
import { fixture, until } from "../../../tests/fixtures";

test("denial stops the workflow before downstream nodes and a late reply cannot revive it", async () => {
  const f = await fixture();
  let finish!: () => void;
  let replies = 0;
  f.runtime.execute = async (run, member, text, observe) => {
    f.runtime.starts.push(member.id);
    observe({
      type: "approval",
      id: "native-deny",
      tool: "read",
      detail: "public.txt",
    });
    await new Promise<void>((resolve) => (finish = resolve));
    throw new AppError(
      "runtime_permission_denied",
      "你拒绝了工具操作，本轮已停止。",
      409,
    );
  };
  f.runtime.approve = async () => {
    replies++;
    finish();
    await until(() => f.store.listRuns()[0].state === "stopped");
  };
  try {
    const workflow = await f.service.create({
      ...f.input,
      members: [
        ...f.input.members,
        ...[1, 2].map((i) => ({
          ...f.input.members[0],
          id: crypto.randomUUID(),
          name: `Worker ${i}`,
          roles: ["worker"] as "worker"[],
        })),
      ],
    });
    const run = await f.service.start(workflow.id, crypto.randomUUID());
    await until(() => f.store.run(run.id).state === "waiting_approval");
    const current = f.store.run(run.id),
      commandId = crypto.randomUUID();
    await f.service.approval(
      run.id,
      current.approvals[0].id,
      "deny",
      current.version,
      commandId,
    );
    await until(() => f.store.run(run.id).cleanupState === "released");
    const result = f.store.run(run.id);
    expect(result.state).toBe("stopped");
    expect(result.phase).toBe("finished");
    expect(result.approvals[0].state).toBe("denied");
    expect(result.members.every((m) => m.state === "stopped")).toBe(true);
    expect(f.runtime.starts).toEqual([workflow.members[1].id]);
    expect(result.handoffs?.some((h) => h.kind === "result")).toBe(false);
    expect(runBlocksStart(result)).toBe(false);
    expect(
      f.store.events(run.id, 0).find((e) => e.type === "run.permission_denied")
        ?.payload.code,
    ).toBe("runtime_permission_denied");
    await f.service.approval(
      run.id,
      current.approvals[0].id,
      "deny",
      current.version,
      commandId,
    );
    expect(replies).toBe(1);
  } finally {
    await f.service.waitForCleanup();
    await f.close();
  }
});

test("an allowed turn finishing before its approval acknowledgement keeps its result state", async () => {
  const f = await fixture();
  f.runtime.approvalMode = true;
  const approve = f.runtime.approve.bind(f.runtime);
  f.runtime.approve = async () => {
    await approve();
    await until(() => f.store.listRuns()[0].state === "awaiting_confirmation");
  };
  try {
    const workflow = await f.service.create(f.input),
      run = await f.service.start(workflow.id, crypto.randomUUID());
    await until(() => f.store.run(run.id).state === "waiting_approval");
    const current = f.store.run(run.id);
    await f.service.approval(
      run.id,
      current.approvals[0].id,
      "allow",
      current.version,
      crypto.randomUUID(),
    );
    const result = f.store.run(run.id);
    expect(result.state).toBe("awaiting_confirmation");
    expect(result.members[0].state).toBe("idle");
    expect(result.approvals[0].state).toBe("allowed");
    await f.service.confirm(run.id, crypto.randomUUID());
  } finally {
    await f.service.waitForCleanup();
    await f.close();
  }
});
