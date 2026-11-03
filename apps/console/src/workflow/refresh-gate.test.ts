import { expect, test } from "bun:test";
import type { Run } from "@agent-desk/contracts";
import { acceptRefresh, newestRun } from "./refresh-gate";

test("sustained updates can render completed requests while preventing stale run selections", () => {
  let applied = 0,
    current: string | null = "run-a";
  // New requests keep starting before the previous response arrives.
  for (const sequence of [1, 2, 3, 4]) {
    expect(acceptRefresh(sequence, applied, "run-a", current)).toBe(true);
    applied = sequence;
  }
  expect(acceptRefresh(3, applied, "run-a", current)).toBe(false);
  current = "run-b";
  expect(acceptRefresh(5, applied, "run-a", current)).toBe(false);
  expect(acceptRefresh(6, applied, "run-b", current)).toBe(true);
});

test("an older snapshot cannot overwrite a newer action for the same run", () => {
  const stopped = { id: "run-a", version: 8, state: "stopped" } as Run;
  const old = { id: "run-a", version: 7, state: "running" } as Run;
  const next = { id: "run-b", version: 1, state: "running" } as Run;
  expect(newestRun(stopped, old)).toBe(stopped);
  expect(newestRun(stopped, next)).toBe(next);
  expect(newestRun(null, old)).toBe(old);
});
