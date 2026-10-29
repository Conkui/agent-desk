import { expect, test } from "bun:test";
import type { Run } from "@agent-desk/contracts";
import { resultText, reportFilename, runReport } from "./run-report";
test("reports include actual results and node output, omit raw tool and reasoning content", () => {
  const run = {
    createdAt: 1,
    definition: { name: "Example", task: "Task" },
    members: [
      {
        name: "Node",
        responsibility: "Review",
        messages: [
          { role: "assistant", text: "Actual output" },
          { role: "tool", text: "raw-tool-private" },
          { role: "reasoning", text: "raw-reasoning-private" },
        ],
      },
    ],
    handoffs: [
      { to: "user", kind: "result", text: "Earlier" },
      { to: "user", kind: "result", text: "Final result" },
    ],
  } as Run;
  expect(resultText(run)).toBe("Final result");
  const report = runReport(run);
  expect(report).toContain("Actual output");
  expect(report).toContain("Final result");
  expect(report).not.toContain("raw-tool-private");
  expect(report).not.toContain("raw-reasoning-private");
  expect(reportFilename("bad:name/<>?")).toBe("bad_name____-运行记录.md");
});
