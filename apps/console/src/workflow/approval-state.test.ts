import { expect, test } from "bun:test";
import type { Run } from "@agent-desk/contracts";
import { canResolveApprovals, pendingApprovals } from "./approval-state";

test("only active runs expose pending approvals as actionable", () => {
  const run = {
    state: "waiting_approval",
    approvals: [
      { id: "a", state: "pending" },
      { id: "b", state: "allowed" },
    ],
  } as Run;
  expect(pendingApprovals(run).map((a) => a.id)).toEqual(["a"]);
  expect(canResolveApprovals({ ...run, state: "running" })).toBe(true);
  for (const state of [
    "failed",
    "stopped",
    "completed",
    "needs_reconcile",
    "awaiting_confirmation",
  ] as const) {
    expect(canResolveApprovals({ ...run, state })).toBe(false);
    expect(pendingApprovals({ ...run, state })).toEqual([]);
  }
  expect(pendingApprovals(null)).toEqual([]);
});
