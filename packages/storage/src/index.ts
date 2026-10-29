import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import {
  AppError,
  type Run,
  type RunEvent,
  type Workflow,
} from "@agent-desk/contracts";

/** A state change and its event commit together. No vendor session objects are stored here. */
export class Store {
  readonly db: Database;
  constructor(path: string) {
    this.db = new Database(path, { create: true });
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
            CREATE TABLE IF NOT EXISTS workflows(id TEXT PRIMARY KEY, body TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, body TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS events(run_id TEXT NOT NULL, seq INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(run_id,seq));
            CREATE TABLE IF NOT EXISTS commands(id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS browser_sessions(hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);
            PRAGMA user_version=1;`);
  }
  listWorkflows(): Workflow[] {
    return this.db
      .query<{ body: string }, []>(
        "SELECT body FROM workflows ORDER BY rowid DESC",
      )
      .all()
      .map((row) => JSON.parse(row.body));
  }
  workflow(id: string): Workflow {
    const row = this.db
      .query<
        { body: string },
        [string]
      >("SELECT body FROM workflows WHERE id=?")
      .get(id);
    if (!row) throw new AppError("workflow_not_found", "找不到工作流。", 404);
    return JSON.parse(row.body);
  }
  listRuns(workflowId?: string): Run[] {
    const query = workflowId
      ? this.db
          .query<
            { body: string },
            [string]
          >("SELECT body FROM runs WHERE workflow_id=? ORDER BY rowid DESC")
          .all(workflowId)
      : this.db
          .query<
            { body: string },
            []
          >("SELECT body FROM runs ORDER BY rowid DESC")
          .all();
    return query.map((row) => JSON.parse(row.body));
  }
  run(id: string): Run {
    const row = this.db
      .query<{ body: string }, [string]>("SELECT body FROM runs WHERE id=?")
      .get(id);
    if (!row) throw new AppError("run_not_found", "找不到运行。", 404);
    return JSON.parse(row.body);
  }
  insertWorkflow(workflow: Workflow) {
    this.db
      .query("INSERT INTO workflows VALUES(?,?)")
      .run(workflow.id, JSON.stringify(workflow));
  }
  insertRun(run: Run) {
    this.db
      .query("INSERT INTO runs VALUES(?,?,?)")
      .run(run.id, run.workflowId, JSON.stringify(run));
  }
  updateWorkflow(workflow: Workflow) {
    this.db
      .query("UPDATE workflows SET body=? WHERE id=?")
      .run(JSON.stringify(workflow), workflow.id);
  }
  mutate(
    id: string,
    type: string,
    payload: Record<string, unknown>,
    change: (run: Run) => void,
  ): Run {
    return this.db.transaction(() => {
      const run = this.run(id);
      change(run);
      run.version++;
      run.lastSequence++;
      run.updatedAt = Date.now();
      const event: RunEvent = {
        schemaVersion: 1,
        eventId: crypto.randomUUID(),
        runId: id,
        sequence: run.lastSequence,
        time: run.updatedAt,
        type,
        payload,
      };
      this.db
        .query("UPDATE runs SET body=? WHERE id=?")
        .run(JSON.stringify(run), id);
      this.db
        .query("INSERT INTO events VALUES(?,?,?)")
        .run(id, event.sequence, JSON.stringify(event));
      return run;
    })();
  }
  events(id: string, after: number): RunEvent[] {
    return this.db
      .query<{ body: string }, [string, number]>(
        "SELECT body FROM events WHERE run_id=? AND seq>? ORDER BY seq LIMIT 200",
      )
      .all(id, after)
      .map((row) => JSON.parse(row.body));
  }
  command<T>(
    id: string,
    body: unknown,
    execute: () => T,
  ): { result: T; fresh: boolean } {
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(body))
      .digest("hex");
    return this.db.transaction(() => {
      const prior = this.db
        .query<
          { fingerprint: string; result: string },
          [string]
        >("SELECT fingerprint,result FROM commands WHERE id=?")
        .get(id);
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          throw new AppError(
            "command_conflict",
            "该请求编号已用于其他操作。",
            409,
          );
        return { result: JSON.parse(prior.result) as T, fresh: false };
      }
      const result = execute();
      this.db
        .query("INSERT INTO commands VALUES(?,?,?)")
        .run(id, fingerprint, JSON.stringify(result));
      return { result, fresh: true };
    })();
  }
  reconcile() {
    for (const run of this.listRuns())
      if (
        ["dispatching", "running", "waiting_approval", "stopping"].includes(
          run.state,
        )
      )
        this.mutate(run.id, "run.needs_reconcile", {}, (current) => {
          current.state = "needs_reconcile";
          current.error = "后台曾中断；未自动重放任务，请核对后新建一轮。";
        });
  }
  close() {
    this.db.close();
  }
}
