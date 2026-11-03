import { z } from "zod";
import type { Run } from "@agent-desk/contracts";

const DetailSchema = z.object({
  patterns: z.array(z.string()).optional(),
  metadata: z
    .object({
      command: z.string().optional(),
      filePath: z.string().optional(),
      filepath: z.string().optional(),
    })
    .passthrough()
    .optional(),
});
const titles: Record<string, string> = {
  read: "读取文件",
  bash: "运行命令",
  edit: "修改文件",
  write: "写入文件",
  glob: "查找文件",
  grep: "搜索内容",
  webfetch: "访问网页",
  websearch: "搜索网页",
  external_directory: "访问其他目录",
  task: "启动子任务",
};
export function approvalTitle(tool: string) {
  return Object.hasOwn(titles, tool) ? titles[tool] : tool;
}

export function toolSummary(
  text: string,
  run: Pick<Run, "state" | "cleanupState"> | null,
) {
  const first = text.split("\n", 1)[0],
    parts = first.split(" · ");
  if (parts.length !== 2) return first;
  const [tool, status] = parts;
  const finished =
    run?.cleanupState === "released" &&
    ["failed", "stopped", "completed"].includes(run.state);
  const uncertain =
    run?.state === "needs_reconcile" ||
    (!!run &&
      ["failed", "stopped", "completed"].includes(run.state) &&
      run.cleanupState !== "released");
  const labels: Record<string, string> = {
    pending: "等待执行",
    running: finished ? "未完成" : uncertain ? "状态待核对" : "进行中",
    completed: "已完成",
    error: "执行失败",
  };
  return `${approvalTitle(tool)} · ${Object.hasOwn(labels, status) ? labels[status] : status}`;
}

/** Show the actual paths/command without interpreting shell syntax or changing
 * the request being approved. Unknown native details remain available verbatim. */
export function approvalDetails(tool: string, detail: string) {
  let parsed: z.infer<typeof DetailSchema> | undefined;
  try {
    const value = DetailSchema.safeParse(JSON.parse(detail));
    if (value.success) parsed = value.data;
  } catch {
    /* Historical/native text may not be JSON. */
  }
  const command = tool === "bash" ? parsed?.metadata?.command : undefined;
  const paths = parsed?.patterns?.filter(Boolean) ?? [];
  const file = parsed?.metadata?.filePath ?? parsed?.metadata?.filepath;
  const items = command
    ? [command]
    : paths.length
      ? paths
      : file
        ? [file]
        : [detail];
  return {
    title: approvalTitle(tool),
    items,
    raw: detail,
    structured: !!parsed,
  };
}
