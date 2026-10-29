import type { Approval } from "@agent-desk/contracts";
import { approvalDetails } from "./approval-details";

export function ApprovalCard({
  approval,
  active,
  busy,
  onResolve,
}: {
  approval: Approval;
  active: boolean;
  busy: boolean;
  onResolve: (decision: "allow" | "deny") => void;
}) {
  const detail = approvalDetails(approval.tool, approval.detail);
  return (
    <section className="approval" aria-label={detail.title}>
      <h3>{detail.title}</h3>
      <ul className="approval-targets">
        {detail.items.map((item, index) => (
          <li key={index}>
            <code>{item}</code>
          </li>
        ))}
      </ul>
      {detail.structured && (
        <details className="approval-details">
          <summary>请求详情</summary>
          <pre>{detail.raw}</pre>
        </details>
      )}
      {active ? (
        <div className="approval-actions">
          <button disabled={busy} onClick={() => onResolve("deny")}>
            拒绝
          </button>
          <button
            className="primary"
            disabled={busy}
            onClick={() => onResolve("allow")}
          >
            允许一次
          </button>
        </div>
      ) : (
        <p className="approval-closed">本轮已结束</p>
      )}
    </section>
  );
}
