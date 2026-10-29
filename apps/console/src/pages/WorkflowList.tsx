import { useCallback, useEffect, useRef, useState } from "react";
import type { RunSummary, Workflow } from "@agent-desk/contracts";
import { runBlocksStart } from "@agent-desk/contracts";
import { MoreHorizontal, Copy, Archive, ArchiveRestore } from "lucide-react";
import { request } from "../api";
import { Status } from "../components";
export function WorkflowList({
  navigate,
}: {
  navigate: (path: string) => void;
}) {
  const [data, setData] = useState<{
      workflows: Workflow[];
      runs: RunSummary[];
    }>({
      workflows: [],
      runs: [],
    }),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [filter, setFilter] = useState("all"),
    [search, setSearch] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const pending = useRef<Record<string, string>>({});
  const refreshGeneration = useRef(0);
  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    try {
      const incoming = await request<{
        workflows: Workflow[];
        runs: RunSummary[];
      }>("/workflows");
      if (generation !== refreshGeneration.current) return;
      setData(incoming);
      setError("");
    } catch (error) {
      if (generation === refreshGeneration.current)
        setError((error as Error).message);
    } finally {
      if (generation === refreshGeneration.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 4000);
    return () => clearInterval(timer);
  }, [refresh]);
  const latest = (id: string) => data.runs.find((run) => run.workflowId === id);
  const match = (workflow: Workflow, filter: string) => {
    if (filter === "archived") return !!workflow.archivedAt;
    if (workflow.archivedAt) return false;
    const state = latest(workflow.id)?.state;
    return (
      filter === "all" ||
      (filter === "attention"
        ? [
            "waiting_approval",
            "failed",
            "needs_reconcile",
            "awaiting_confirmation",
          ].includes(state ?? "")
        : filter === "active"
          ? ["running", "dispatching", "stopping"].includes(state ?? "")
          : ["completed", "stopped"].includes(state ?? ""))
    );
  };
  async function manage(
    workflow: Workflow,
    operation: "duplicate" | "archive",
  ) {
    setBusy(workflow.id);
    setError("");
    const key = `${operation}:${workflow.id}:${workflow.version ?? 1}`;
    const commandId = (pending.current[key] ??= crypto.randomUUID());
    try {
      const result = await request<{ workflow: Workflow }>(
        `/workflows/${workflow.id}/${operation}`,
        {
          commandId,
          ...(operation === "archive"
            ? {
                expectedVersion: workflow.version ?? 1,
                archived: !workflow.archivedAt,
              }
            : {}),
        },
      );
      delete pending.current[key];
      if (operation === "duplicate")
        navigate(`/workflows/${result.workflow.id}`);
      else {
        setNotice(workflow.archivedAt ? "已还原" : "已归档");
        if (workflow.archivedAt) setFilter("all");
        await refresh();
      }
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy("");
    }
  }
  const shown = data.workflows.filter(
    (workflow) =>
      match(workflow, filter) &&
      `${workflow.name} ${workflow.task} ${workflow.directory}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <h1>工作流</h1>
        </div>
        <button className="primary" onClick={() => navigate("/workflows/new")}>
          ＋ 新建工作流
        </button>
      </div>
      <div className="list-tools">
        <div className="filters" aria-label="工作流状态">
          {[
            ["all", "全部"],
            ["active", "进行中"],
            ["attention", "待处理"],
            ["closed", "已结束"],
            ["archived", "已归档"],
          ].map(([value, label]) => (
            <button
              key={value}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {label}
              <span>
                {
                  data.workflows.filter((workflow) => match(workflow, value))
                    .length
                }
              </span>
            </button>
          ))}
        </div>
        <input
          aria-label="搜索工作流"
          placeholder="搜索名称或项目"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
          <button onClick={() => void refresh()}>重试</button>
        </p>
      )}
      {notice && (
        <p className="list-notice" role="status">
          {notice}
        </p>
      )}
      <div className="workflow-list">
        {shown.map((workflow) => {
          const run = latest(workflow.id);
          return (
            <div className="workflow-row" key={workflow.id}>
              <button
                className="workflow-open"
                onClick={() => navigate(`/workflows/${workflow.id}`)}
              >
                <span className="workflow-mark">↳</span>
                <span className="workflow-name">
                  <strong>{workflow.name}</strong>
                  <span>
                    {run?.memberCount ?? workflow.members.length} 个节点 ·{" "}
                    {workflow.directory.replace(/\\/g, "/").split("/").pop()}
                  </span>
                </span>
                <span className="row-state">
                  {run ? (
                    <Status state={run.state} />
                  ) : (
                    <span className="subtle">尚未启动</span>
                  )}
                  <small>
                    {new Date(
                      run?.updatedAt ?? workflow.createdAt,
                    ).toLocaleDateString("zh-CN")}
                  </small>
                </span>
                <span aria-hidden="true">›</span>
              </button>
              <details
                className="row-menu"
                onBlur={(event) => {
                  if (
                    !event.currentTarget.contains(
                      event.relatedTarget as Node | null,
                    )
                  )
                    event.currentTarget.open = false;
                }}
              >
                <summary aria-label={`${workflow.name}更多操作`}>
                  <MoreHorizontal size={18} />
                </summary>
                <div className="row-menu-content">
                  <button
                    aria-label={`复制${workflow.name}`}
                    disabled={!!busy}
                    onClick={() => void manage(workflow, "duplicate")}
                  >
                    <Copy size={14} />
                    复制工作流
                  </button>
                  <button
                    aria-label={`${workflow.archivedAt ? "还原" : "归档"}${workflow.name}`}
                    disabled={
                      !!busy ||
                      (!workflow.archivedAt &&
                        data.runs.some(
                          (run) =>
                            run.workflowId === workflow.id &&
                            runBlocksStart(run),
                        ))
                    }
                    onClick={() => void manage(workflow, "archive")}
                  >
                    {workflow.archivedAt ? (
                      <ArchiveRestore size={14} />
                    ) : (
                      <Archive size={14} />
                    )}
                    {workflow.archivedAt ? "还原" : "归档"}
                  </button>
                </div>
              </details>
            </div>
          );
        })}
      </div>
      {!shown.length && !error && (
        <div className="empty">
          <span className="empty-icon">↳</span>
          <h2>
            {loading
              ? "正在读取…"
              : data.workflows.length
                ? "没有找到工作流"
                : "从一项任务开始"}
          </h2>
          {!loading && !data.workflows.length && (
            <button onClick={() => navigate("/workflows/new")}>
              新建第一个工作流 →
            </button>
          )}
        </div>
      )}
    </main>
  );
}
