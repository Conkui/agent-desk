export const labels: Record<string, string> = {
  dispatching: "正在派发",
  running: "工作中",
  waiting_approval: "等待审批",
  needs_reconcile: "需要核对",
  stopping: "正在停止",
  stopped: "已停止",
  failed: "执行失败",
  awaiting_confirmation: "结果待确认",
  completed: "已确认完成",
  queued: "等待分工",
  idle: "已返回结果",
};
export const cliNames: Record<string, string> = {
  opencode: "OpenCode",
  claude: "Claude Code",
  dsh: "DeepSeek Harness",
  codex: "Codex",
};
export function Brand() {
  return (
    <span className="brand">
      <img src="/icon.svg" alt="" width="30" height="30" />
      Agent Desk
    </span>
  );
}
export function Status({ state }: { state: string }) {
  return (
    <span className={`status state-${state}`}>
      <i />
      {labels[state] ?? state}
    </span>
  );
}
