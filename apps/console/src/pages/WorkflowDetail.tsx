import {
  useCallback,
  useEffect,
  useRef,
  useState,
  lazy,
  Suspense,
} from "react";
import type { Run, RunSummary, Workflow } from "@agent-desk/contracts";
import { runBlocksStart } from "@agent-desk/contracts";
import { command, request } from "../api";
import { Status, labels } from "../components";
import { WorkflowCanvas } from "../workflow/WorkflowCanvas";
const NodeDialog = lazy(() =>
  import("../workflow/NodeDialog").then((module) => ({
    default: module.NodeDialog,
  })),
);
const WorkflowEditor = lazy(() =>
  import("../workflow/WorkflowEditor").then((module) => ({
    default: module.WorkflowEditor,
  })),
);
const RunOverview = lazy(() =>
  import("../workflow/RunOverview").then((module) => ({
    default: module.RunOverview,
  })),
);
import type { Bootstrap } from "../types";
import * as Dialog from "@radix-ui/react-dialog";
import { Settings2, Plus, X } from "lucide-react";
export function WorkflowDetail({
  workflowId,
  navigate,
  bootstrap,
}: {
  workflowId: string;
  navigate: (path: string) => void;
  bootstrap: Bootstrap;
}) {
  const [workflow, setWorkflow] = useState<Workflow | null>(null),
    [runs, setRuns] = useState<RunSummary[]>([]),
    [run, setRun] = useState<Run | null>(null),
    [selected, setSelected] = useState(""),
    [error, setError] = useState(""),
    [loadError, setLoadError] = useState(""),
    [busy, setBusy] = useState(false),
    [mode, setMode] = useState<"design" | "run" | null>(null),
    [editing, setEditing] = useState<Workflow | null>(null),
    [focusMemberId, setFocusMemberId] = useState<string>(),
    [taskOpen, setTaskOpen] = useState(false),
    [overviewOpen, setOverviewOpen] = useState(false),
    [nodeTab, setNodeTab] = useState<
      "activity" | "incoming" | "outgoing" | "reasoning"
    >("activity");
  const currentRun = useRef<string | null>(null);
  const refreshGeneration = useRef(0);
  const pendingCommand = useRef<{ key: string; id: string } | null>(null);
  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    try {
      const data = await request<{ workflow: Workflow; runs: RunSummary[] }>(
        `/workflows/${workflowId}`,
      );
      const history = data.runs;
      const chosen =
        history.find((item) => item.id === currentRun.current) ?? history[0];
      // Pull only the selected run. Other workflows and historical message bodies stay out of this view.
      const snapshot = chosen
        ? (await request<{ run: Run }>(`/runs/${chosen.id}`)).run
        : null;
      if (generation !== refreshGeneration.current) return;
      setWorkflow(data.workflow);
      setRuns(history);
      setRun(snapshot);
      setLoadError("");
      if (chosen) currentRun.current = chosen.id;
    } catch (error) {
      if (generation === refreshGeneration.current)
        setLoadError((error as Error).message);
    }
  }, [workflowId]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    if (!run) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const source = new EventSource(
      `/api/v1/runs/${run.id}/events?after=${run.lastSequence}`,
    );
    source.onmessage = () => {
      if (!timer)
        timer = setTimeout(() => {
          timer = undefined;
          void refresh();
        }, 180);
    };
    return () => {
      source.close();
      if (timer) clearTimeout(timer);
    };
  }, [run?.id, refresh]);
  const viewMode = mode ?? (run ? "run" : "design");
  const displayRun = viewMode === "run" ? run : null;
  const displayWorkflow = displayRun?.definition ?? workflow;
  const member = (displayRun?.members ?? workflow?.members)?.find(
    (item) => item.id === selected,
  );
  const selectNode = useCallback(
    (
      id: string,
      tab: "activity" | "incoming" | "outgoing" | "reasoning" = "activity",
    ) => {
      if (id === "user") {
        setTaskOpen(true);
        return;
      }
      setSelected(id);
      setNodeTab(tab);
    },
    [],
  );
  const configure = useCallback(
    (id?: string) => {
      if (workflow) {
        setSelected("");
        setEditing(structuredClone(workflow));
        setFocusMemberId(id);
      }
    },
    [workflow],
  );
  async function action(path: string, body: unknown = command()) {
    setBusy(true);
    setError("");
    try {
      const { commandId: _discard, ...payload } = body as Record<
        string,
        unknown
      >;
      const key = JSON.stringify({ path, payload });
      if (pendingCommand.current?.key !== key)
        pendingCommand.current = { key, id: crypto.randomUUID() };
      const result = await request(path, {
        ...payload,
        commandId: pendingCommand.current.id,
      });
      pendingCommand.current = null;
      if (result.run) {
        currentRun.current = result.run.id;
        setRun(result.run);
        setMode("run");
      }
      await refresh();
      return true;
    } catch (error) {
      setError((error as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  if (!workflow)
    return (
      <main className="page">
        <button className="back-link" onClick={() => navigate("/workflows")}>
          ← 工作流
        </button>
        <p role="status">{loadError || error || "正在读取工作流…"}</p>
      </main>
    );
  const active = run && runBlocksStart(run);
  const hasOpenRun = runs.some(runBlocksStart);
  const phaseText =
    displayRun?.phase === "planning"
      ? "规划节点"
      : displayRun?.phase === "summarizing"
        ? "汇总结果"
        : displayRun?.phase === "working"
          ? displayRun.members.find(
              (member) => member.id === displayRun.activeMemberId,
            )?.name
          : "";
  return (
    <main className="canvas-page">
      <section className="canvas-toolbar">
        <div className="canvas-title">
          <button className="back-link" onClick={() => navigate("/workflows")}>
            ← 工作流
          </button>
          <h1>{displayWorkflow?.name}</h1>
          {displayRun ? (
            <Status state={displayRun.state} />
          ) : (
            <span className="eyebrow">编排</span>
          )}
        </div>
        <div className="canvas-actions">
          {displayRun && (
            <button onClick={() => setOverviewOpen(true)}>
              进度与结果
              {displayRun.approvals.some((item) => item.state === "pending")
                ? " · 待审批"
                : ""}
            </button>
          )}
          <button
            className="workflow-settings-button"
            onClick={() => configure()}
          >
            <Settings2 size={15} /> 工作流设置
          </button>
          {viewMode === "run" && runs.length > 0 && (
            <select
              aria-label="运行记录"
              value={run?.id}
              onChange={(event) => {
                currentRun.current = event.target.value;
                void refresh();
                setSelected("");
                setMode("run");
              }}
            >
              {runs.map((item) => (
                <option key={item.id} value={item.id}>
                  {new Date(item.createdAt).toLocaleString("zh-CN")} ·{" "}
                  {labels[item.state]}
                </option>
              ))}
            </select>
          )}
          {displayRun?.state === "awaiting_confirmation" && (
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void action("/runs/" + displayRun.id + "/confirm-result")
              }
            >
              确认完成
            </button>
          )}
          {displayRun && active && (
            <button
              disabled={busy}
              onClick={() => void action("/runs/" + run.id + "/stop")}
            >
              停止
            </button>
          )}
          {!hasOpenRun && !active && !workflow.archivedAt && (
            <button
              className="primary"
              disabled={busy}
              onClick={() => {
                currentRun.current = null;
                void action(
                  displayRun?.state === "failed"
                    ? `/runs/${displayRun.id}/retry`
                    : "/workflows/" + workflow.id + "/runs",
                );
              }}
            >
              {displayRun?.state === "failed"
                ? "重新执行"
                : run
                  ? "新一轮"
                  : "开始运行"}
            </button>
          )}
        </div>
      </section>
      <div className="canvas-subbar">
        <div className="canvas-mode" aria-label="画布模式">
          <button
            aria-pressed={viewMode === "design"}
            onClick={() => {
              setMode("design");
              setSelected("");
            }}
          >
            编排
          </button>
          <button
            disabled={!run}
            aria-pressed={viewMode === "run"}
            onClick={() => {
              setMode("run");
              setSelected("");
            }}
          >
            运行记录{runs.length > 0 && <small>{runs.length}</small>}
          </button>
        </div>
        <div className="canvas-summary">
          {viewMode === "run" ? (
            <span>
              {phaseText || ""}
              {displayRun?.cleanupState === "releasing"
                ? " · 正在结束进程"
                : displayRun?.cleanupState === "unknown"
                  ? " · 进程待核对"
                  : ""}
            </span>
          ) : (
            <>
              <span>{displayWorkflow?.members.length ?? 0} 个预设节点</span>
              <span>
                {displayWorkflow?.orchestrator?.canCreateNodes
                  ? `编排器可创建节点 · 上限 ${displayWorkflow.orchestrator.maxNodes}`
                  : "固定节点"}
              </span>
              <span>
                {displayWorkflow?.permissionPolicy === "read-only"
                  ? "只读"
                  : "操作前询问"}
              </span>
              {viewMode === "design" && (
                <button
                  disabled={workflow.members.length >= 12}
                  onClick={() => configure("new")}
                >
                  <Plus size={14} /> 添加节点
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {(error || loadError || displayRun?.error) && (
        <p className="error canvas-error" role="alert">
          {error || loadError || displayRun?.error}
        </p>
      )}
      <WorkflowCanvas
        key={displayRun?.id ?? workflow.id}
        workflow={displayWorkflow!}
        run={displayRun}
        onSelect={selectNode}
        onConfigure={viewMode === "design" ? configure : undefined}
      />
      <Suspense fallback={null}>
        {overviewOpen && displayRun && (
          <RunOverview
            key={displayRun.id}
            run={displayRun}
            onClose={() => setOverviewOpen(false)}
            onSelect={selectNode}
            action={action}
            busy={busy}
            error={error}
          />
        )}
        {!!selected && (
          <NodeDialog
            member={member}
            run={displayRun}
            open={!!selected}
            onClose={() => setSelected("")}
            action={action}
            busy={busy}
            initialTab={nodeTab}
            onSelect={(id) => selectNode(id)}
            onConfigure={
              viewMode === "design" ? () => configure(member?.id) : undefined
            }
            error={error}
          />
        )}
        {editing && (
          <WorkflowEditor
            workflow={editing}
            bootstrap={bootstrap}
            focusMemberId={focusMemberId}
            onClose={() => setEditing(null)}
            onSaved={(updated) => {
              setWorkflow(updated);
              setEditing(null);
              setMode("design");
              void refresh();
            }}
          />
        )}
      </Suspense>
      <Dialog.Root open={taskOpen} onOpenChange={setTaskOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="node-overlay" />
          <Dialog.Content
            className="task-dialog"
            aria-describedby="task-dialog-description"
          >
            <div className="section-heading">
              <Dialog.Title>{displayWorkflow?.name}</Dialog.Title>
              <Dialog.Close className="icon-button" aria-label="关闭任务">
                <X size={20} />
              </Dialog.Close>
            </div>
            <Dialog.Description id="task-dialog-description">
              {displayWorkflow?.directory}
            </Dialog.Description>
            <p>{displayWorkflow?.task}</p>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </main>
  );
}
