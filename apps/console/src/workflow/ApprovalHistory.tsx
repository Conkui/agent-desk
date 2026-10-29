import type { Run } from "@agent-desk/contracts";
import { approvalDetails } from "./approval-details";

export function ApprovalHistory({ run }: { run: Run }) {
  if (!run.approvals.length) return null;
  const active = ["running", "waiting_approval"].includes(run.state);
  return (
    <details className="run-approval-history">
      <summary>审批记录 · {run.approvals.length}</summary>
      <ol>
        {run.approvals.map((approval) => {
          const detail = approvalDetails(approval.tool, approval.detail);
          const status =
            approval.state === "allowed"
              ? "已允许"
              : approval.state === "denied"
                ? "已拒绝"
                : approval.state === "resolving"
                  ? "投递未确认"
                  : active
                    ? "待处理"
                    : "未处理";
          return (
            <li key={approval.id}>
              <div>
                <strong>{detail.title}</strong>
                <span>{status}</span>
              </div>
              <small>
                {
                  run.members.find((member) => member.id === approval.memberId)
                    ?.name
                }{" "}
                ·{" "}
                {new Date(approval.createdAt).toLocaleTimeString("zh-CN", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </small>
              <pre>{detail.items.join("\n")}</pre>
            </li>
          );
        })}
      </ol>
    </details>
  );
}
