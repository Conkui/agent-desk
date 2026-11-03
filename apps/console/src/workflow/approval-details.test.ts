import { expect, test } from "bun:test";
import {
  approvalDetails,
  approvalTitle,
  toolSummary,
} from "./approval-details";
test("read approvals show their actual targets and retain the original request", () => {
  const raw = JSON.stringify({
    patterns: ["E:/work/a.txt", "E:/work/b.txt"],
    metadata: { filePath: "E:/work/a.txt", other: "native" },
  });
  expect(approvalDetails("read", raw)).toEqual({
    title: "读取文件",
    items: ["E:/work/a.txt", "E:/work/b.txt"],
    raw,
    structured: true,
  });
});
test("command approvals show the complete native command without shell parsing", () => {
  const command = "Get-Content 'a b.txt'; Write-Output done";
  const raw = JSON.stringify({
    patterns: ["Get-Content *"],
    metadata: { command },
  });
  expect(approvalDetails("bash", raw).items).toEqual([command]);
  expect(approvalDetails("bash", raw).title).toBe("运行命令");
});
test("unknown and invalid details remain visible and do not invent targets", () => {
  expect(approvalDetails("custom-tool", "native text")).toMatchObject({
    title: "custom-tool",
    items: ["native text"],
    structured: false,
  });
  expect(approvalDetails("read", '{"patterns":true}').items).toEqual([
    '{"patterns":true}',
  ]);
  expect(approvalTitle("constructor")).toBe("constructor");
});

test("historical tool calls cannot appear running after the process is released", () => {
  const text = "read · running\nfile details";
  expect(toolSummary(text, { state: "failed", cleanupState: "released" })).toBe(
    "读取文件 · 未完成",
  );
  expect(toolSummary(text, { state: "running" })).toBe("读取文件 · 进行中");
  expect(toolSummary(text, { state: "failed", cleanupState: "unknown" })).toBe(
    "读取文件 · 状态待核对",
  );
  expect(toolSummary("read · completed", null)).toBe("读取文件 · 已完成");
});
