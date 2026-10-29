import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Copy, Download, ArrowRight } from "lucide-react";
import type { Run } from "@agent-desk/contracts";
import { Status } from "../components";
import { command } from "../api";
import { MessageBody } from "./MessageBody";
import { resultText, reportFilename, runReport } from "./run-report";
import { useMessageDraft } from "./use-message-draft";
import { approvalTitle } from "./approval-details";
import { ApprovalHistory } from "./ApprovalHistory";

export function RunOverview({
  run,
  onClose,
  onSelect,
  action,
  busy,
  error,
}: {
  run: Run;
  onClose: () => void;
  onSelect: (id: string) => void;
  action: (path: string, body?: unknown) => Promise<boolean>;
  busy: boolean;
  error?: string;
}) {
  const [text, setText] = useMessageDraft(`${run.id}:task`);
  const [copyStatus, setCopyStatus] = useState("");
  const result = resultText(run);
  const coordinator = run.members.find((member) =>
    member.roles.includes("coordinator"),
  )!;
  const name = (id: string) =>
    id === "user"
      ? "你"
      : (run.members.find((member) => member.id === id)?.name ?? "节点");
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="node-overlay" />
        <Dialog.Content
          className="workflow-editor run-overview"
          aria-describedby="run-overview-description"
        >
          <header>
            <div>
              <Dialog.Title>进度与结果</Dialog.Title>
              <Dialog.Description id="run-overview-description">
                {new Date(run.createdAt).toLocaleString("zh-CN")} ·{" "}
                {run.definition.name}
              </Dialog.Description>
            </div>
            <Dialog.Close className="icon-button" aria-label="关闭运行记录">
              <X size={20} />
            </Dialog.Close>
          </header>
          <div className="workflow-editor-body">
            <div className="run-overview-status">
              <Status state={run.state} />
              {run.cleanupState === "releasing" && <span>正在结束进程…</span>}
              {run.cleanupState === "unknown" && <span>进程待核对</span>}
            </div>
            <details className="run-task">
              <summary>任务</summary>
              <p>{run.definition.task}</p>
              <small>{run.definition.directory}</small>
            </details>
            <section className="run-node-list" aria-label="节点进度">
              {run.members.map((member, index) => (
                <button
                  key={member.id}
                  onClick={() => {
                    onClose();
                    onSelect(member.id);
                  }}
                >
                  <span className="run-node-order">{index + 1}</span>
                  <span>
                    <strong>{member.name}</strong>
                    <small>{member.responsibility}</small>
                  </span>
                  <Status state={member.state} />
                  <ArrowRight size={14} />
                </button>
              ))}
            </section>
            {run.approvals
              .filter(
                (item) =>
                  item.state === "pending" &&
                  ["running", "waiting_approval"].includes(run.state),
              )
              .map((approval) => (
                <button
                  className="pending-approval"
                  key={approval.id}
                  onClick={() => {
                    onClose();
                    onSelect(approval.memberId);
                  }}
                >
                  待审批 · {name(approval.memberId)} ·{" "}
                  {approvalTitle(approval.tool)}
                  <ArrowRight size={14} />
                </button>
              ))}
            {run.error && (
              <p role="alert" className="error">
                {run.error}
              </p>
            )}
            <ApprovalHistory run={run} />
            <section className="run-report">
              <div className="section-heading">
                <h3>结果</h3>
                <div className="report-actions">
                  <button
                    disabled={!result}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(result);
                        setCopyStatus("已复制");
                      } catch {
                        setCopyStatus("复制失败");
                      }
                    }}
                  >
                    <Copy size={14} />
                    {copyStatus || "复制"}
                  </button>
                  <button
                    onClick={() => {
                      const url = URL.createObjectURL(
                        new Blob([runReport(run)], {
                          type: "text/markdown;charset=utf-8",
                        }),
                      );
                      const link = document.createElement("a");
                      link.href = url;
                      link.download = reportFilename(run.definition.name);
                      link.click();
                      setTimeout(() => URL.revokeObjectURL(url), 1000);
                    }}
                  >
                    <Download size={14} />
                    导出
                  </button>
                </div>
              </div>
              {result ? (
                <MessageBody text={result} />
              ) : (
                <p className="hint">
                  {run.state === "failed" ? "本轮未生成结果" : "尚无结果"}
                </p>
              )}
            </section>
            {!!run.handoffs?.length && (
              <details className="run-handoffs">
                <summary>交接记录 · {run.handoffs.length}</summary>
                {run.handoffs.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      onClose();
                      onSelect(item.from === "user" ? item.to : item.from);
                    }}
                  >
                    <time>
                      {new Date(item.time).toLocaleTimeString("zh-CN", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                    <span>
                      {name(item.from)} → {name(item.to)}
                    </span>
                    <small>
                      {item.kind === "task"
                        ? "分工"
                        : item.kind === "result"
                          ? "结果"
                          : "消息"}
                    </small>
                  </button>
                ))}
              </details>
            )}
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {run.state === "awaiting_confirmation" && (
            <form
              className="run-followup"
              onSubmit={(event) => {
                event.preventDefault();
                void action(
                  `/runs/${run.id}/members/${coordinator.id}/messages`,
                  { ...command(), text: text.trim() },
                ).then((ok) => {
                  if (ok) setText("");
                });
              }}
            >
              <textarea
                aria-label="补充任务要求"
                placeholder="补充要求…"
                value={text}
                rows={2}
                maxLength={16000}
                onChange={(event) => setText(event.target.value)}
              />
              <div>
                <button disabled={busy || !text.trim()}>发送</button>
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() => void action(`/runs/${run.id}/confirm-result`)}
                >
                  确认完成
                </button>
              </div>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
