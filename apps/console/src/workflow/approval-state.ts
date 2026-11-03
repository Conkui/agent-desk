import type { Run } from "@agent-desk/contracts";

export function canResolveApprovals(run: Run | null) {
  return !!run && (run.state === "running" || run.state === "waiting_approval");
}
export function pendingApprovals(run: Run | null) {
  return canResolveApprovals(run)
    ? run!.approvals.filter((item) => item.state === "pending")
    : [];
}
