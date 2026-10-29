import { realpath, stat } from "node:fs/promises";
import { relative, isAbsolute } from "node:path";
import {
  AppError,
  PlanSchema,
  PlanJsonSchema,
  runBlocksStart,
  type CreateWorkflow,
  type UpdateWorkflow,
  type Run,
  type RunMember,
  type Workflow,
} from "@agent-desk/contracts";
import {
  createRun,
  editable,
  getMember,
  memberPrompt,
} from "@agent-desk/workflow-core";
import type { Runtime, RuntimeObservation } from "@agent-desk/agent-runtime";
import type { RunRepository } from "./ports";

export class Workflows {
  private releases = new Map<string, Promise<boolean>>();
  constructor(
    readonly store: RunRepository,
    private runtime: Runtime,
    readonly root: string,
  ) {}
  private async authorizedDirectory(value: string) {
    const directory = await realpath(value).catch(() => {
      throw new AppError("directory_missing", "项目目录不存在。");
    });
    const allowed = await realpath(this.root),
      path = relative(allowed, directory);
    if (
      path === ".." ||
      path.startsWith(".." + (process.platform === "win32" ? "\\" : "/")) ||
      isAbsolute(path)
    )
      throw new AppError(
        "directory_forbidden",
        "请选择已授权工作目录内的项目。",
        403,
      );
    if (!(await stat(directory)).isDirectory())
      throw new AppError("directory_missing", "请选择目录。");
    return directory;
  }
  async create(input: CreateWorkflow): Promise<Workflow> {
    const directory = await this.authorizedDirectory(input.directory);
    const { commandId, ...definition } = input;
    const workflow: Workflow = {
      ...definition,
      directory,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      version: 1,
    };
    return this.store.command(
      commandId,
      { operation: "create", ...definition, directory },
      () => {
        this.store.insertWorkflow(workflow);
        return workflow;
      },
    ).result;
  }
  async update(id: string, input: UpdateWorkflow): Promise<Workflow> {
    const directory = await this.authorizedDirectory(input.directory);
    const { commandId, expectedVersion, ...definition } = input;
    // Updating a definition never mutates the snapshot of an existing run.
    return this.store.command(
      commandId,
      { operation: "update", id, expectedVersion, ...definition, directory },
      () => {
        const current = this.store.workflow(id);
        if ((current.version ?? 1) !== expectedVersion)
          throw new AppError(
            "workflow_stale",
            "工作流已在别处更新，请重新打开后保存。",
            409,
          );
        const updated = {
          ...definition,
          directory,
          id,
          createdAt: current.createdAt,
          archivedAt: current.archivedAt,
          updatedAt: Date.now(),
          version: expectedVersion + 1,
        };
        this.store.updateWorkflow(updated);
        return updated;
      },
    ).result;
  }
  async archive(
    id: string,
    expectedVersion: number,
    archived: boolean,
    commandId: string,
  ) {
    return this.store.command(
      commandId,
      { operation: "archive", id, expectedVersion, archived },
      () => {
        const current = this.store.workflow(id);
        if ((current.version ?? 1) !== expectedVersion)
          throw new AppError(
            "workflow_stale",
            "工作流已更新，请刷新后重试。",
            409,
          );
        if (archived && this.store.listRuns(id).some(runBlocksStart))
          throw new AppError("workflow_busy", "请先结束正在运行的任务。", 409);
        const updated = {
          ...current,
          archivedAt: archived ? Date.now() : undefined,
          updatedAt: Date.now(),
          version: expectedVersion + 1,
        };
        this.store.updateWorkflow(updated);
        return updated;
      },
    ).result;
  }
  async duplicate(id: string, commandId: string, name?: string) {
    const current = this.store.workflow(id);
    await this.authorizedDirectory(current.directory);
    return this.store.command(
      commandId,
      { operation: "duplicate", id, name },
      () => {
        const copy: Workflow = {
          ...current,
          id: crypto.randomUUID(),
          name: name ?? `${current.name.slice(0, 97)} 副本`,
          members: current.members.map((member) => ({
            ...member,
            id: crypto.randomUUID(),
          })),
          createdAt: Date.now(),
          updatedAt: undefined,
          archivedAt: undefined,
          version: 1,
        };
        this.store.insertWorkflow(copy);
        return copy;
      },
    ).result;
  }
  async retry(runId: string, commandId: string) {
    const previous = this.store.run(runId);
    if (runBlocksStart(previous))
      throw new AppError(
        "run_not_closed",
        "请先结束本轮进程，再重新执行。",
        409,
      );
    return this.start(previous.workflowId, commandId, runId);
  }
  async start(workflowId: string, commandId: string, retryOf?: string) {
    const current = this.store.workflow(workflowId);
    if (current.archivedAt)
      throw new AppError("workflow_archived", "请先还原工作流。", 409);
    const source = retryOf ? this.store.run(retryOf) : undefined;
    if (source && source.workflowId !== workflowId)
      throw new AppError("run_not_found", "运行记录不属于该工作流。", 404);
    const definition = source?.definition ?? current,
      run = createRun(definition);
    await this.authorizedDirectory(definition.directory);
    if (retryOf) run.retryOf = retryOf;
    await this.runtime.prepare(run);
    const command = this.store.command(
      commandId,
      { operation: "start", workflowId, retryOf },
      () => {
        if (this.store.workflow(workflowId).archivedAt)
          throw new AppError("workflow_archived", "请先还原工作流。", 409);
        if (this.store.listRuns(workflowId).some(runBlocksStart))
          throw new AppError(
            "workflow_busy",
            "该工作流仍在运行或需要核对旧进程，请先结束当前运行。",
            409,
          );
        this.store.insertRun(run);
        this.store.mutate(run.id, "run.created", {}, () => {});
        return { runId: run.id };
      },
    );
    if (command.fresh) void this.dispatch(command.result.runId);
    return this.store.run(command.result.runId);
  }
  private observe(runId: string, memberId: string, event: RuntimeObservation) {
    const current = this.store.run(runId);
    if (
      [
        "stopped",
        "stopping",
        "completed",
        "needs_reconcile",
        "failed",
      ].includes(current.state)
    )
      return;
    this.store.mutate(
      runId,
      event.type === "approval" ? "approval.requested" : "member.output",
      { memberId },
      (run) => {
        const member = getMember(run, memberId);
        if (event.type === "approval") {
          if (!run.approvals.some((item) => item.nativeId === event.id))
            run.approvals.push({
              id: crypto.randomUUID(),
              nativeId: event.id,
              memberId,
              tool: event.tool,
              detail: event.detail.slice(0, 16000),
              state: "pending",
              createdAt: Date.now(),
            });
          member.state = "waiting_approval";
          run.state = "waiting_approval";
        } else {
          const text = event.text.slice(0, 100000);
          const existing = member.messages.find((item) => item.id === event.id);
          if (existing) existing.text = text;
          else if (member.messages.length < 500)
            member.messages.push({
              id: event.id,
              role: event.role,
              text,
              time: Date.now(),
            });
        }
      },
    );
  }
  private handoff(
    runId: string,
    from: string,
    to: string,
    text: string,
    kind: "task" | "result" | "message",
  ) {
    this.store.mutate(runId, "handoff.created", { from, to }, (run) => {
      editable(run);
      (run.handoffs ??= []).push({
        id: crypto.randomUUID(),
        from,
        to,
        text,
        time: Date.now(),
        kind,
      });
    });
  }
  private async execute(
    runId: string,
    memberId: string,
    prompt: string,
    options?: { outputSchema?: Record<string, unknown> },
  ) {
    const run = this.store.mutate(
      runId,
      "member.started",
      { memberId },
      (run) => {
        editable(run);
        getMember(run, memberId).state = "running";
        run.state = "running";
        run.activeMemberId = memberId;
        run.phase = options?.outputSchema
          ? "planning"
          : getMember(run, memberId).roles.includes("coordinator") &&
              run.members.length > 1
            ? "summarizing"
            : "working";
      },
    );
    const result = await this.runtime.execute(
      run,
      getMember(run, memberId),
      prompt,
      (event) => this.observe(runId, memberId, event),
      options,
    );
    const current = this.store.run(runId);
    if (["stopped", "stopping", "needs_reconcile"].includes(current.state))
      return;
    this.store.mutate(runId, "member.idle", { memberId }, (run) => {
      getMember(run, memberId).state = "idle";
      run.activeMemberId = undefined;
      // The native turn can finish while its last approval reply is still
      // being acknowledged. Do not strand its result in waiting_approval.
      if (
        run.state === "waiting_approval" &&
        !run.approvals.some((item) => item.state === "pending")
      )
        run.state = "running";
    });
    return result;
  }
  /** Only the orchestrator's planning response can add nodes. Worker output is data,
   * and never becomes an instruction to grow or change the graph. */
  private async dispatch(runId: string) {
    try {
      let run = this.store.run(runId);
      const coordinator = run.members.find((member) =>
        member.roles.includes("coordinator"),
      )!;
      this.handoff(runId, "user", coordinator.id, run.definition.task, "task");
      if (run.definition.orchestrator?.canCreateNodes) {
        const remaining =
          run.definition.orchestrator.maxNodes - run.members.length;
        if (remaining > 0) {
          const proposed = await this.execute(
            runId,
            coordinator.id,
            [
              memberPrompt(run, coordinator),
              `先安排工作节点。现有节点：${run.members.map((m) => `${m.name}：${m.responsibility}`).join("；")}。`,
              `你可以新增至多 ${remaining} 个节点；已有分工足够或任务很小时返回空 nodes。只输出符合 JSON Schema 的计划，不执行工具或实际工作。`,
            ].join("\n\n"),
            { outputSchema: PlanJsonSchema },
          );
          const plan = PlanSchema.safeParse(proposed);
          if (!plan.success)
            throw new AppError(
              "invalid_plan",
              "编排计划未生成成功，请重新运行。",
              502,
            );
          this.store.mutate(
            runId,
            "graph.expanded",
            { createdBy: coordinator.id },
            (current) => {
              editable(current);
              getMember(current, coordinator.id).state = "queued";
              if (plan.data.nodes.length > remaining)
                throw new AppError(
                  "node_limit",
                  "创建的节点超过本轮数量设置。",
                );
              for (const node of plan.data.nodes)
                current.members.push({
                  ...node,
                  id: crypto.randomUUID(),
                  cli: coordinator.cli,
                  roles: ["worker"],
                  state: "queued",
                  messages: [],
                });
            },
          );
        }
      }
      run = this.store.run(runId);
      const workers = run.members.filter(
        (member) => member.id !== coordinator.id,
      );
      for (const worker of workers) {
        if (
          ["stopping", "stopped", "needs_reconcile"].includes(
            this.store.run(runId).state,
          )
        )
          return;
        const prompt = memberPrompt(run, worker);
        this.handoff(runId, coordinator.id, worker.id, prompt, "task");
        await this.execute(runId, worker.id, prompt);
        const output = getMember(this.store.run(runId), worker.id)
          .messages.filter((message) => message.role === "assistant")
          .map((message) => message.text)
          .join("\n")
          .slice(-12000);
        if (
          !["stopping", "stopped", "needs_reconcile"].includes(
            this.store.run(runId).state,
          )
        )
          this.handoff(runId, worker.id, coordinator.id, output, "result");
      }
      run = this.store.run(runId);
      if (["stopping", "stopped", "needs_reconcile"].includes(run.state))
        return;
      const reports = workers.map(
        (worker) =>
          `${worker.name}：\n${getMember(run, worker.id)
            .messages.filter((message) => message.role === "assistant")
            .map((message) => message.text)
            .join("\n")
            .slice(-12000)}`,
      );
      const priorOutputs = new Set(
        getMember(run, coordinator.id).messages.map((message) => message.id),
      );
      await this.execute(
        runId,
        coordinator.id,
        memberPrompt(run, coordinator, reports),
      );
      if (this.store.run(runId).state === "running")
        this.store.mutate(runId, "run.result_proposed", {}, (run) => {
          run.state = "awaiting_confirmation";
          run.phase = "finished";
          const result = getMember(run, coordinator.id)
            .messages.filter(
              (message) =>
                message.role === "assistant" && !priorOutputs.has(message.id),
            )
            .map((message) => message.text)
            .join("\n");
          (run.handoffs ??= []).push({
            id: crypto.randomUUID(),
            from: coordinator.id,
            to: "user",
            text: result,
            time: Date.now(),
            kind: "result",
          });
        });
    } catch (error) {
      this.failure(runId, error);
    }
  }
  private failure(runId: string, error: unknown) {
    const current = this.store.run(runId);
    if (
      [
        "stopping",
        "stopped",
        "needs_reconcile",
        "completed",
        "failed",
      ].includes(current.state)
    )
      return;
    const message =
      error instanceof AppError
        ? error.message
        : "执行连接中断或 CLI 返回异常，未自动重试。";
    const denied =
      error instanceof AppError && error.code === "runtime_permission_denied";
    this.store.mutate(
      runId,
      denied ? "run.permission_denied" : "run.failed",
      { code: error instanceof AppError ? error.code : "runtime_unknown" },
      (run) => {
        run.state = denied ? "stopped" : "failed";
        run.error = message;
        if (denied) run.phase = "finished";
        run.activeMemberId = undefined;
        for (const member of run.members)
          if (
            [
              "running",
              "waiting_approval",
              ...(denied ? ["queued"] : []),
            ].includes(member.state)
          ) {
            member.state = denied ? "stopped" : "failed";
            member.error = message;
          }
      },
    );
    void this.release(runId);
  }
  private release(runId: string): Promise<boolean> {
    const pending = this.releases.get(runId);
    if (pending) return pending;
    const work = (async () => {
      this.store.mutate(runId, "run.releasing", {}, (run) => {
        run.cleanupState = "releasing";
      });
      try {
        await this.runtime.stop(runId);
        this.store.mutate(runId, "run.released", {}, (run) => {
          run.cleanupState = "released";
        });
        return true;
      } catch {
        this.store.mutate(runId, "run.cleanup_pending", {}, (run) => {
          run.cleanupState = "unknown";
        });
        return false;
      }
    })();
    this.releases.set(runId, work);
    void work.finally(() => this.releases.delete(runId));
    return work;
  }
  async waitForCleanup() {
    await Promise.allSettled([...this.releases.values()]);
  }
  async send(runId: string, memberId: string, text: string, commandId: string) {
    const command = this.store.command(
      commandId,
      { operation: "send", runId, memberId, text },
      () => {
        this.store.mutate(
          runId,
          "member.message_queued",
          { memberId },
          (run) => {
            editable(run);
            const member = getMember(run, memberId);
            if (
              member.state !== "idle" ||
              run.state !== "awaiting_confirmation"
            )
              throw new AppError(
                "member_busy",
                "请等待本轮分工完成，或先处理审批。",
                409,
              );
            member.messages.push({
              id: commandId,
              role: "user",
              text,
              time: Date.now(),
            });
            (run.handoffs ??= []).push({
              id: crypto.randomUUID(),
              from: "user",
              to: memberId,
              text,
              time: Date.now(),
              kind: "message",
            });
            member.state = "running";
            run.state = "running";
          },
        );
        return { accepted: true };
      },
    );
    if (command.fresh)
      void this.execute(runId, memberId, text)
        .then(() => {
          if (this.store.run(runId).state === "running")
            this.store.mutate(runId, "run.result_proposed", {}, (run) => {
              run.state = "awaiting_confirmation";
              run.phase = "finished";
              const member = getMember(run, memberId);
              const text =
                member.messages
                  .filter((message) => message.role === "assistant")
                  .at(-1)?.text ?? "";
              (run.handoffs ??= []).push({
                id: crypto.randomUUID(),
                from: memberId,
                to: "user",
                text,
                time: Date.now(),
                kind: "result",
              });
            });
        })
        .catch((error) => this.failure(runId, error));
    return this.store.run(runId);
  }
  async approval(
    runId: string,
    id: string,
    decision: "allow" | "deny",
    expectedVersion: number,
    commandId: string,
  ) {
    const before = this.store.run(runId);
    const approval = before.approvals.find((item) => item.id === id);
    if (!approval)
      throw new AppError("approval_not_found", "找不到该审批。", 404);
    const command = this.store.command(
      commandId,
      { operation: "approval", runId, id, decision, expectedVersion },
      () => {
        this.store.mutate(runId, "approval.resolving", { id }, (run) => {
          editable(run);
          const current = run.approvals.find((item) => item.id === id)!;
          if (run.version !== expectedVersion || current.state !== "pending")
            throw new AppError(
              "approval_stale",
              "审批状态已变化，请刷新后处理。",
              409,
            );
          current.state = "resolving";
        });
        return { accepted: true };
      },
    );
    if (command.fresh) {
      try {
        await this.runtime.approve(runId, approval.nativeId, decision);
        this.store.mutate(runId, "approval.resolved", { id }, (run) => {
          run.approvals.find((item) => item.id === id)!.state =
            decision === "allow" ? "allowed" : "denied";
          const member = getMember(run, approval.memberId);
          // Approval delivery can race the native turn's result or stop. A late
          // acknowledgement may resolve the card, but cannot revive that turn.
          if (["running", "waiting_approval"].includes(run.state)) {
            if (
              member.state === "waiting_approval" &&
              !run.approvals.some(
                (item) =>
                  item.memberId === member.id && item.state === "pending",
              )
            )
              member.state = "running";
            run.state = run.approvals.some((item) => item.state === "pending")
              ? "waiting_approval"
              : "running";
          }
        });
      } catch {
        this.store.mutate(runId, "run.needs_reconcile", {}, (run) => {
          run.state = "needs_reconcile";
          run.error = "审批投递结果未知，未重复执行，请核对进程。";
        });
      }
    }
    return this.store.run(runId);
  }
  async stop(runId: string, commandId: string) {
    const command = this.store.command(
      commandId,
      { operation: "stop", runId },
      () => {
        this.store.mutate(runId, "run.stopping", {}, (run) => {
          if (!["completed", "failed"].includes(run.state))
            run.state = "stopping";
        });
        return { accepted: true };
      },
    );
    if (command.fresh) {
      if (await this.release(runId)) {
        this.store.mutate(runId, "run.stopped", {}, (run) => {
          if (!["completed", "failed"].includes(run.state))
            run.state = "stopped";
          run.activeMemberId = undefined;
          for (const member of run.members)
            if (!["idle", "failed"].includes(member.state))
              member.state = "stopped";
        });
      } else {
        this.store.mutate(runId, "run.needs_reconcile", {}, (run) => {
          run.state = "needs_reconcile";
          run.error = "停止尚未确认，请核对进程。";
        });
      }
    }
    return this.store.run(runId);
  }
  async confirm(runId: string, commandId: string) {
    const command = this.store.command(
      commandId,
      { operation: "confirm", runId },
      () => {
        this.store.mutate(runId, "run.completed", {}, (run) => {
          if (run.state !== "awaiting_confirmation")
            throw new AppError(
              "run_not_ready",
              "请先等待结果，再确认完成。",
              409,
            );
          run.state = "completed";
        });
        return { accepted: true };
      },
    );
    if (command.fresh) await this.release(runId);
    return this.store.run(runId);
  }
}
