import type { Run } from "@agent-desk/contracts";

export function resultText(run: Run) {
  return (
    (run.handoffs ?? [])
      .filter((item) => item.to === "user" && item.kind === "result")
      .at(-1)?.text ?? ""
  );
}
export function runReport(run: Run) {
  return [
    `# ${run.definition.name}`,
    `运行时间：${new Date(run.createdAt).toLocaleString("zh-CN")}`,
    "## 任务",
    run.definition.task,
    "## 结果",
    resultText(run) || "尚无结果",
    ...(run.error ? ["## 错误", run.error] : []),
    "## 节点记录",
    ...run.members.flatMap((member) => [
      `### ${member.name}`,
      member.responsibility,
      ...member.messages
        .filter((message) => message.role === "assistant")
        .map((message) => message.text),
    ]),
  ].join("\n\n");
}
export function reportFilename(name: string) {
  return `${
    name
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .replace(/[. ]+$/g, "")
      .slice(0, 100) || "工作流"
  }-运行记录.md`;
}
