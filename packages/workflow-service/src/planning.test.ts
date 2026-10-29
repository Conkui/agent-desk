import { expect, test } from "bun:test";
import { fixture, until } from "../../../tests/fixtures";

test("orchestrator planning creates real run nodes, dispatches them and records both handoff directions", async () => {
  const f = await fixture();
  const execute = f.runtime.execute.bind(f.runtime);
  f.runtime.execute = async (run, member, text, observe, options?: any) => {
    if (options?.outputSchema) {
      observe({
        type: "output",
        id: "reasoning",
        role: "reasoning",
        text: "检查分工",
      });
      return {
        nodes: [{ name: "Review", responsibility: "Check the result" }],
      };
    }
    return execute(run, member, text, observe);
  };
  try {
    const workflow = await f.service.create({
      ...f.input,
      orchestrator: { canCreateNodes: true, maxNodes: 3 },
    });
    const run = await f.service.start(workflow.id, crypto.randomUUID());
    await until(() => f.store.run(run.id).state === "awaiting_confirmation");
    const saved = f.store.run(run.id),
      worker = saved.members.find((member) => member.name === "Review")!;
    expect(saved.members).toHaveLength(2);
    expect(f.runtime.starts[0]).toBe(worker.id);
    expect(
      saved.handoffs?.some(
        (item) =>
          item.from === worker.id &&
          item.to === workflow.members[0].id &&
          item.text.includes("test result"),
      ),
    ).toBe(true);
    expect(
      saved.handoffs?.some(
        (item) => item.to === worker.id && item.kind === "task",
      ),
    ).toBe(true);
    expect(
      saved.members[0].messages.some((message) => message.role === "reasoning"),
    ).toBe(true);
    expect(saved.definition.members).toHaveLength(1);
  } finally {
    await f.close();
  }
});
test("planning disabled does not request a plan; node limits reject oversized plans atomically", async () => {
  const f = await fixture();
  let plans = 0;
  const execute = f.runtime.execute.bind(f.runtime);
  f.runtime.execute = async (run, member, text, observe, options?: any) => {
    if (options?.outputSchema) {
      plans++;
      return {
        nodes: [
          { name: "A", responsibility: "A" },
          { name: "B", responsibility: "B" },
        ],
      };
    }
    return execute(run, member, text, observe);
  };
  try {
    const first = await f.service.create({
      ...f.input,
      orchestrator: { canCreateNodes: false, maxNodes: 2 },
    });
    const run = await f.service.start(first.id, crypto.randomUUID());
    await until(() => f.store.run(run.id).state === "awaiting_confirmation");
    expect(plans).toBe(0);
    const second = await f.service.create({
      ...f.input,
      commandId: crypto.randomUUID(),
      orchestrator: { canCreateNodes: true, maxNodes: 2 },
    });
    const overflow = await f.service.start(second.id, crypto.randomUUID());
    await until(() => f.store.run(overflow.id).state === "failed");
    expect(plans).toBe(1);
    expect(f.store.run(overflow.id).members).toHaveLength(1);
  } finally {
    await f.close();
  }
});
