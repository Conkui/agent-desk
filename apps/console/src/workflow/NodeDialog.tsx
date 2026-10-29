import { useEffect, useState, useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Brain,
  MessagesSquare,
  X,
} from "lucide-react";
import type { Run, RunMember, Workflow } from "@agent-desk/contracts";
import { Status, cliNames } from "../components";
import { command } from "../api";
import { MessageBody } from "./MessageBody";
import { useMessageDraft } from "./use-message-draft";
import { ApprovalCard } from "./ApprovalCard";

type Member = Workflow["members"][number] | RunMember;
export function NodeDialog({
  member,
  run,
  open,
  onClose,
  action,
  busy,
  initialTab = "activity",
  onSelect,
  onConfigure,
  error,
}: {
  member?: Member;
  run: Run | null;
  open: boolean;
  onClose: () => void;
  action: (path: string, body?: unknown) => Promise<boolean>;
  busy: boolean;
  initialTab?: "activity" | "incoming" | "outgoing" | "reasoning";
  onSelect?: (id: string) => void;
  onConfigure?: () => void;
  error?: string;
}) {
  const [tab, setTab] = useState("activity");
  const [text, setText] = useMessageDraft(
    `${run?.id ?? "design"}:${member?.id ?? "none"}`,
  );
  useEffect(() => {
    followTail.current = true;
    setTab(initialTab);
  }, [member?.id, initialTab, open]);
  const log = useRef<HTMLDivElement>(null),
    followTail = useRef(true);
  const messages = member && "messages" in member ? member.messages : [];
  const handoffs = (run?.handoffs ?? []).filter((item) =>
    tab === "incoming" ? item.to === member?.id : item.from === member?.id,
  );
  const tail = messages.at(-1);
  useEffect(() => {
    if (followTail.current && log.current)
      log.current.scrollTop = log.current.scrollHeight;
  }, [tail?.id, tail?.text, tab, member?.id]);
  const name = (id: string) =>
    id === "user"
      ? "你"
      : (run?.members.find((member) => member.id === id)?.name ?? "节点");
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="node-overlay" />
        <Dialog.Content
          className="node-dialog"
          aria-describedby="node-description"
        >
          <div className="node-dialog-heading">
            <div>
              <span className="eyebrow">
                {member?.cli ? cliNames[member.cli] : ""} ·{" "}
                {member?.roles.includes("coordinator") ? "编排器" : "工作节点"}
              </span>
              <Dialog.Title>{member?.name}</Dialog.Title>
            </div>
            <div className="node-dialog-actions">
              {onConfigure && <button onClick={onConfigure}>节点设置</button>}
              <Dialog.Close className="icon-button" aria-label="关闭节点消息">
                <X size={20} />
              </Dialog.Close>
            </div>
          </div>
          <Dialog.Description id="node-description">
            {member?.responsibility}
          </Dialog.Description>
          <nav className="node-tabs" aria-label="节点消息分类">
            {[
              ["activity", "过程", MessagesSquare],
              ["incoming", "传入", ArrowDownLeft],
              ["outgoing", "传出", ArrowUpRight],
              ["reasoning", "思考", Brain],
            ].map(([value, label, Icon]) => {
              const I = Icon as typeof Brain;
              return (
                <button
                  key={String(value)}
                  aria-pressed={tab === value}
                  onClick={() => setTab(String(value))}
                >
                  <I size={15} />
                  {String(label)}
                  <small>
                    {value === "incoming"
                      ? (run?.handoffs ?? []).filter(
                          (item) => item.to === member?.id,
                        ).length
                      : value === "outgoing"
                        ? (run?.handoffs ?? []).filter(
                            (item) => item.from === member?.id,
                          ).length
                        : messages.filter((message) =>
                            value === "reasoning"
                              ? message.role === "reasoning"
                              : message.role !== "reasoning",
                          ).length}
                  </small>
                </button>
              );
            })}
          </nav>
          <div
            className="node-dialog-messages"
            role="log"
            aria-label="节点消息"
            ref={log}
            onScroll={() => {
              const el = log.current;
              if (el)
                followTail.current =
                  el.scrollHeight - el.scrollTop - el.clientHeight < 100;
            }}
          >
            {tab === "incoming" || tab === "outgoing" ? (
              <>
                {handoffs.map((item) => (
                  <article className="message handoff-message" key={item.id}>
                    <div className="message-meta">
                      <span>
                        <button
                          className="handoff-link"
                          disabled={item.from === "user"}
                          onClick={() => onSelect?.(item.from)}
                        >
                          {name(item.from)}
                        </button>{" "}
                        →{" "}
                        <button
                          className="handoff-link"
                          disabled={item.to === "user"}
                          onClick={() => onSelect?.(item.to)}
                        >
                          {name(item.to)}
                        </button>
                      </span>
                      <time>
                        {new Date(item.time).toLocaleTimeString("zh-CN", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                    </div>
                    <MessageBody text={item.text} />
                  </article>
                ))}
                {!handoffs.length && (
                  <p className="dialog-empty">
                    还没有{tab === "incoming" ? "传入" : "传出"}记录
                  </p>
                )}
              </>
            ) : (
              <>
                {messages
                  .filter((message) =>
                    tab === "reasoning"
                      ? message.role === "reasoning"
                      : message.role !== "reasoning",
                  )
                  .map((message) => (
                    <article
                      key={message.id}
                      className={`message message-${message.role}`}
                    >
                      <div className="message-meta">
                        <span>
                          {message.role === "tool"
                            ? "工具"
                            : message.role === "reasoning"
                              ? "思考"
                              : message.role === "user"
                                ? "你"
                                : member?.name}
                        </span>
                        <time>
                          {new Date(message.time).toLocaleTimeString("zh-CN", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </time>
                      </div>
                      {message.role === "tool" ? (
                        <details className="tool-output">
                          <summary>{message.text.split("\n")[0]}</summary>
                          <MessageBody
                            text={message.text.split("\n").slice(1).join("\n")}
                            plain
                          />
                        </details>
                      ) : (
                        <MessageBody
                          text={message.text}
                          plain={message.role === "user"}
                        />
                      )}
                    </article>
                  ))}
                {!messages.some((message) =>
                  tab === "reasoning"
                    ? message.role === "reasoning"
                    : message.role !== "reasoning",
                ) && (
                  <p className="dialog-empty">
                    {tab === "reasoning"
                      ? "此节点还没有返回思考内容"
                      : "节点开始后，消息会出现在这里"}
                  </p>
                )}
              </>
            )}
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="node-approvals">
            {run &&
              member &&
              run.approvals
                .filter(
                  (item) =>
                    item.memberId === member.id && item.state === "pending",
                )
                .map((approval) => (
                  <ApprovalCard
                    key={approval.id}
                    approval={approval}
                    active={["running", "waiting_approval"].includes(run.state)}
                    busy={busy}
                    onResolve={(decision) =>
                      void action(
                        `/runs/${run.id}/approvals/${approval.id}/resolve`,
                        {
                          ...command(),
                          expectedVersion: run.version,
                          decision,
                        },
                      )
                    }
                  />
                ))}
          </div>
          {run?.state === "awaiting_confirmation" && member ? (
            <form
              className="reply-form"
              onSubmit={(event) => {
                event.preventDefault();
                void action(`/runs/${run.id}/members/${member.id}/messages`, {
                  ...command(),
                  text,
                }).then((ok) => {
                  if (ok) setText("");
                });
              }}
            >
              <textarea
                aria-label="给节点发消息"
                rows={2}
                placeholder="给这个节点发消息…"
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
              <button className="primary" disabled={busy || !text.trim()}>
                发送
              </button>
            </form>
          ) : (
            <footer className="node-dialog-footer">
              {member && "state" in member ? (
                <Status state={member.state} />
              ) : (
                <span>未启动</span>
              )}
            </footer>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
