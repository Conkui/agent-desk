import { describe, expect, test } from "bun:test";
import { CreateWorkflowSchema } from "@agent-desk/contracts";
import { fixture, until } from "../../../tests/fixtures";

describe("independent workflow execution", () => {
  test("uses one working coordinator; retries the same command without a second process", async () => {
    const f = await fixture();
    try {
      const workflow = await f.service.create(f.input);
      const start = crypto.randomUUID();
      const first = await f.service.start(workflow.id, start);
      const second = await f.service.start(workflow.id, start);
      expect(first.id).toBe(second.id);
      await until(
        () => f.store.run(first.id).state === "awaiting_confirmation",
      );
      expect(f.runtime.starts).toHaveLength(1);
      expect(f.store.run(first.id).state).not.toBe("completed");
      await f.service.confirm(first.id, crypto.randomUUID());
      expect(f.store.run(first.id).state).toBe("completed");
      expect(f.runtime.stopped).toEqual([first.id]);
      expect(() => f.store.command(start, { other: true }, () => ({}))).toThrow(
        "请求编号",
      );
    } finally {
      await f.close();
    }
  });
  test("executes only assigned workers before the coordinator and keeps all output in the run", async () => {
    const f = await fixture();
    try {
      f.input.members.push({
        ...f.input.members[0],
        id: crypto.randomUUID(),
        name: "Worker",
        roles: ["worker"],
      });
      const workflow = await f.service.create(f.input),
        run = await f.service.start(workflow.id, crypto.randomUUID());
      await until(() => f.store.run(run.id).state === "awaiting_confirmation");
      expect(f.runtime.starts).toEqual([
        workflow.members[1].id,
        workflow.members[0].id,
      ]);
      expect(f.runtime.prompts.at(-1)).toContain("test result: Worker");
      const saved = f.store.run(run.id);
      expect(
        saved.members.every((member) => member.messages.length === 1),
      ).toBe(true);
      const events = f.store.events(run.id, 0);
      expect(events.map((event) => event.sequence)).toEqual(
        events.map((_, index) => index + 1),
      );
      expect(f.store.events(run.id, 2)[0].sequence).toBe(3);
    } finally {
      await f.close();
    }
  });
  test("native permission requests wait for a valid decision, reject stale and duplicate decisions", async () => {
    const f = await fixture();
    f.runtime.approvalMode = true;
    try {
      const workflow = await f.service.create(f.input),
        run = await f.service.start(workflow.id, crypto.randomUUID());
      await until(() => f.store.run(run.id).state === "waiting_approval");
      const pending = f.store.run(run.id),
        approval = pending.approvals[0];
      await expect(
        f.service.approval(
          run.id,
          approval.id,
          "allow",
          pending.version - 1,
          crypto.randomUUID(),
        ),
      ).rejects.toThrow("审批状态");
      await f.service.approval(
        run.id,
        approval.id,
        "allow",
        pending.version,
        crypto.randomUUID(),
      );
      await until(() => f.store.run(run.id).state === "awaiting_confirmation");
      expect(f.store.run(run.id).approvals[0].state).toBe("allowed");
      await expect(
        f.service.approval(
          run.id,
          approval.id,
          "allow",
          f.store.run(run.id).version,
          crypto.randomUUID(),
        ),
      ).rejects.toThrow("审批状态");
    } finally {
      await f.close();
    }
  });
  test("does not replay ambiguous execution on restart; rejects paths outside the authorized root", async () => {
    const f = await fixture();
    f.runtime.approvalMode = true;
    try {
      await expect(
        f.service.create({ ...f.input, directory: f.home }),
      ).rejects.toThrow("授权工作目录");
      const workflow = await f.service.create(f.input),
        run = await f.service.start(workflow.id, crypto.randomUUID());
      await until(() => f.store.run(run.id).state === "waiting_approval");
      f.store.reconcile();
      expect(f.store.run(run.id).state).toBe("needs_reconcile");
      await expect(
        f.service.start(workflow.id, crypto.randomUUID()),
      ).rejects.toThrow("仍在运行");
      await f.service.stop(run.id, crypto.randomUUID());
      await until(() => f.store.run(run.id).state === "stopped");
      expect(f.runtime.starts).toHaveLength(1);
    } finally {
      await f.close();
    }
  });
  test("rejects missing workers, two coordinators, and duplicate member identity", async () => {
    const f = await fixture();
    try {
      expect(
        CreateWorkflowSchema.safeParse({
          ...f.input,
          members: [{ ...f.input.members[0], roles: ["coordinator"] }],
        }).success,
      ).toBe(false);
      expect(
        CreateWorkflowSchema.safeParse({
          ...f.input,
          members: [f.input.members[0], f.input.members[0]],
        }).success,
      ).toBe(false);
    } finally {
      await f.close();
    }
  });
});
