import type { Run, Workflow } from "@agent-desk/contracts";

/** No database or process library crosses into the application service. */
export interface RunRepository {
  workflow(id: string): Workflow;
  run(id: string): Run;
  listRuns(workflowId?: string): Run[];
  insertWorkflow(workflow: Workflow): void;
  updateWorkflow(workflow: Workflow): void;
  insertRun(run: Run): void;
  mutate(
    id: string,
    type: string,
    payload: Record<string, unknown>,
    change: (run: Run) => void,
  ): Run;
  command<T>(
    id: string,
    body: unknown,
    execute: () => T,
  ): { result: T; fresh: boolean };
}
