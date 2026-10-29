import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Cli, Workflow, CreateWorkflow } from "@agent-desk/contracts";
import { capabilityFor } from "@agent-desk/contracts";
import type { Bootstrap } from "../types";
import { request, RequestError } from "../api";
import {
  workflowDrafts,
  submitWorkflow,
  type DraftFields,
  type PendingSubmission,
} from "./workflow-draft";
import { agentAvailability, agentInventory } from "../agents";
export type WorkflowDraft = Omit<CreateWorkflow, "commandId">;
export function WorkflowForm({
  bootstrap,
  navigate,
  initial,
  onSave,
  onCancel,
  embedded = false,
  focusMemberId,
  headerActions,
}: {
  bootstrap: Bootstrap;
  navigate: (path: string) => void;
  initial?: Workflow;
  onSave?: (draft: WorkflowDraft) => Promise<void>;
  onCancel?: () => void;
  embedded?: boolean;
  focusMemberId?: string;
  headerActions?: (busy: boolean) => ReactNode;
}) {
  const cached = useRef(
    initial ? undefined : workflowDrafts.load(bootstrap.workspace),
  ).current;
  const definition = initial ?? cached?.submission?.request ?? cached?.fields;
  const coordinator = definition?.members.find((member) =>
    member.roles.includes("coordinator"),
  );
  const extraId = useRef(crypto.randomUUID());
  const formRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const id = focusMemberId === "new" ? extraId.current : focusMemberId;
    if (id)
      formRef.current
        ?.querySelector<HTMLInputElement>(`[data-member-id="${id}"] input`)
        ?.focus();
  }, [focusMemberId]);
  const [name, setName] = useState(definition?.name ?? ""),
    [task, setTask] = useState(definition?.task ?? ""),
    [directory, setDirectory] = useState(
      definition?.directory ?? bootstrap.workspace,
    ),
    [cli, setCli] = useState<Cli>(coordinator?.cli ?? "opencode"),
    [coordinatorName, setCoordinatorName] = useState(
      coordinator?.name ?? "编排器",
    ),
    [coordinatorTask, setCoordinatorTask] = useState(
      coordinator?.responsibility ?? "安排任务、执行与汇总结果",
    ),
    [canCreate, setCanCreate] = useState(
      definition?.orchestrator?.canCreateNodes ?? true,
    ),
    [maxNodes, setMaxNodes] = useState(
      Math.max(
        definition?.orchestrator?.maxNodes ?? 5,
        (definition?.members.length ?? 0) + (focusMemberId === "new" ? 1 : 0),
      ),
    ),
    [policy, setPolicy] = useState(definition?.permissionPolicy ?? "ask"),
    [workers, setWorkers] = useState<
      Array<{ id: string; name: string; responsibility: string; cli: Cli }>
    >(() => [
      ...(definition?.members
        .filter((member) => member.id !== coordinator?.id)
        .map((member) => ({
          id: member.id,
          name: member.name,
          responsibility: member.responsibility,
          cli: member.cli,
        })) ?? []),
      ...(focusMemberId === "new"
        ? [
            {
              id: extraId.current,
              name: "新节点",
              responsibility: "",
              cli: coordinator?.cli ?? ("opencode" as Cli),
            },
          ]
        : []),
    ]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const coordinatorId = useRef(coordinator?.id ?? crypto.randomUUID());
  const pending = useRef<PendingSubmission | undefined>(cached?.submission);
  const submitted = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const fields: DraftFields = {
    name,
    task,
    directory,
    permissionPolicy: policy,
    orchestrator: { canCreateNodes: canCreate, maxNodes },
    members: [
      {
        id: coordinatorId.current,
        name: coordinatorName,
        cli,
        roles: ["coordinator", "worker"],
        responsibility: coordinatorTask,
      },
      ...workers.map((worker) => ({
        ...worker,
        roles: ["worker"] as ["worker"],
      })),
    ],
  };
  const persist = () => {
    if (initial || submitted.current) return;
    if (
      !mounted.current &&
      workflowDrafts.load(bootstrap.workspace)?.submission?.request
        .commandId !== pending.current?.request.commandId
    )
      return;
    workflowDrafts.save(bootstrap.workspace, fields, pending.current);
  };
  useEffect(persist, [
    name,
    task,
    directory,
    policy,
    canCreate,
    maxNodes,
    cli,
    coordinatorName,
    coordinatorTask,
    workers,
    busy,
  ]);
  const finish = (id: string) => {
    if (!mounted.current) {
      persist();
      return;
    }
    submitted.current = true;
    workflowDrafts.clear(bootstrap.workspace);
    navigate(`/workflows/${id}`);
  };
  async function submit(launch: boolean) {
    if (busy) return;
    if (
      !pending.current &&
      !formRef.current?.querySelector("form")?.reportValidity()
    )
      return;
    setBusy(true);
    setError("");
    try {
      const body = fields;
      if (onSave) {
        await onSave(body as WorkflowDraft);
        return;
      }
      pending.current ??= {
        request: { ...body, commandId: crypto.randomUUID() },
        launchId: crypto.randomUUID(),
      };
      persist();
      const id = await submitWorkflow(
        pending.current,
        {
          create: async (input) =>
            (await request<{ workflow: Workflow }>("/workflows", input))
              .workflow,
          launch: async (id, commandId) => {
            await request(`/workflows/${id}/runs`, { commandId });
          },
        },
        persist,
        launch,
      );
      finish(id);
    } catch (error) {
      // A rejected create is editable; an unknown outcome retains its exact request identity for retry.
      if (
        !pending.current?.workflowId &&
        error instanceof RequestError &&
        error.status < 500
      )
        pending.current = undefined;
      persist();
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const inventory = agentInventory(bootstrap.installations).filter(
    (item) => item.installed || capabilityFor(item.cli),
  );
  const ready = [cli, ...workers.map((worker) => worker.cli)].every((value) => {
    const agent = inventory.find((item) => item.cli === value);
    return agent && agentAvailability(agent, bootstrap.profiles).ready;
  });
  return (
    <div
      ref={formRef}
      className={embedded ? "workflow-form embedded-form" : "page form-page"}
    >
      {!embedded && (
        <>
          <button className="back-link" onClick={() => navigate("/workflows")}>
            ← 工作流
          </button>
          <div className="page-heading">
            <div>
              <h1>新建工作流</h1>
            </div>
            {headerActions?.(busy)}
          </div>
        </>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit(true);
        }}
      >
        <fieldset disabled={busy || !!pending.current}>
          <div className="form-grid">
            <label>
              工作流名称
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={100}
                placeholder="例如：检查登录流程"
                required
              />
            </label>
          </div>
          <label>
            项目目录
            <input
              value={directory}
              onChange={(event) => setDirectory(event.target.value)}
              required
            />
          </label>
          <label>
            任务内容
            <textarea
              value={task}
              onChange={(event) => setTask(event.target.value)}
              placeholder="任务要求…"
              rows={4}
              maxLength={16000}
              required
            />
          </label>
          <div className="form-section">
            <h2>编排与节点</h2>
            <label data-member-id={coordinatorId.current}>
              编排器名称
              <input
                value={coordinatorName}
                onChange={(event) => setCoordinatorName(event.target.value)}
                maxLength={80}
                required
              />
            </label>
            <div className="form-grid">
              <label>
                编排器
                <select
                  value={cli}
                  onChange={(event) => setCli(event.target.value as Cli)}
                >
                  {inventory.map((item) => (
                    <option
                      value={item.cli}
                      key={item.cli}
                      disabled={
                        !agentAvailability(item, bootstrap.profiles).ready
                      }
                    >
                      {item.name}
                      {!agentAvailability(item, bootstrap.profiles).ready
                        ? ` · ${agentAvailability(item, bootstrap.profiles).label}`
                        : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                节点总数上限
                <input
                  type="number"
                  min={workers.length + 1}
                  max={12}
                  value={maxNodes}
                  onChange={(event) => setMaxNodes(Number(event.target.value))}
                />
              </label>
            </div>
            <label>
              编排器职责
              <textarea
                rows={2}
                value={coordinatorTask}
                maxLength={1000}
                onChange={(event) => setCoordinatorTask(event.target.value)}
              />
            </label>
            <label className="check permission-switch">
              <input
                type="checkbox"
                checked={canCreate}
                onChange={(event) => setCanCreate(event.target.checked)}
              />
              <span>
                <strong>允许编排器创建节点</strong>
              </span>
            </label>
            <div className="section-heading">
              <span>预设节点</span>
              <button
                type="button"
                disabled={workers.length >= 11}
                onClick={() => (
                  setMaxNodes(Math.max(maxNodes, workers.length + 2)),
                  setWorkers([
                    ...workers,
                    {
                      id: crypto.randomUUID(),
                      name: `工作节点 ${workers.length + 1}`,
                      cli,
                      responsibility: "",
                    },
                  ])
                )}
              >
                ＋ 添加节点
              </button>
            </div>
            {workers.map((worker, index) => (
              <div
                className="worker-input"
                data-member-id={worker.id}
                key={worker.id}
              >
                <input
                  aria-label={`成员名称 ${index + 1}`}
                  maxLength={80}
                  value={worker.name}
                  onChange={(event) =>
                    setWorkers(
                      workers.map((item) =>
                        item.id === worker.id
                          ? { ...item, name: event.target.value }
                          : item,
                      ),
                    )
                  }
                  required
                />
                <input
                  aria-label={`成员职责 ${index + 1}`}
                  maxLength={1000}
                  placeholder="具体职责，例如：补充测试"
                  value={worker.responsibility}
                  onChange={(event) =>
                    setWorkers(
                      workers.map((item) =>
                        item.id === worker.id
                          ? {
                              ...item,
                              responsibility: event.target.value,
                            }
                          : item,
                      ),
                    )
                  }
                  required
                />
                <select
                  aria-label={`节点工具 ${index + 1}`}
                  value={worker.cli}
                  onChange={(event) =>
                    setWorkers(
                      workers.map((item) =>
                        item.id === worker.id
                          ? { ...item, cli: event.target.value as Cli }
                          : item,
                      ),
                    )
                  }
                >
                  {inventory.map((item) => (
                    <option
                      key={item.cli}
                      value={item.cli}
                      disabled={
                        !agentAvailability(item, bootstrap.profiles).ready
                      }
                    >
                      {item.name}
                      {!agentAvailability(item, bootstrap.profiles).ready
                        ? ` · ${agentAvailability(item, bootstrap.profiles).label}`
                        : ""}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  aria-label={`移除成员 ${index + 1}`}
                  onClick={() =>
                    setWorkers(workers.filter((item) => item.id !== worker.id))
                  }
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <label>
            工具权限
            <select
              value={policy}
              onChange={(event) =>
                setPolicy(event.target.value as "ask" | "read-only")
              }
            >
              <option value="ask">操作前询问</option>
              <option value="read-only">只读</option>
            </select>
          </label>
          {!ready && !onSave && (
            <p className="notice">
              节点未就绪。
              <button
                type="button"
                className="text-action"
                onClick={() => navigate("/settings")}
              >
                配置 Agent →
              </button>
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </fieldset>
        {pending.current && (
          <p className="hint" role="status">
            {pending.current.workflowId ? "工作流已保存" : "提交待确认"}
            {pending.current.workflowId && (
              <button
                type="button"
                className="text-action"
                onClick={() => finish(pending.current!.workflowId!)}
              >
                打开工作流 →
              </button>
            )}
          </p>
        )}
        <div className="form-actions">
          {onCancel && (
            <button type="button" disabled={busy} onClick={onCancel}>
              取消
            </button>
          )}
          {!onSave && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void submit(false)}
            >
              {pending.current?.workflowId ? "打开工作流" : "仅保存"}
            </button>
          )}
          <button
            className="primary"
            disabled={
              busy || (!onSave && !ready) || maxNodes < workers.length + 1
            }
          >
            {busy
              ? "正在提交…"
              : onSave
                ? "保存更改"
                : pending.current
                  ? "重试提交"
                  : "保存并启动"}
          </button>
        </div>
      </form>
    </div>
  );
}
