import type { Installation, Run, RunMember } from "@agent-desk/contracts";
export type RuntimeObservation =
  | {
      type: "output";
      id: string;
      text: string;
      role: "assistant" | "tool" | "reasoning";
    }
  | { type: "approval"; id: string; tool: string; detail: string };
export interface Runtime {
  scan(): Promise<Installation[]>;
  prepare(run: Run): Promise<void>;
  execute(
    run: Run,
    member: RunMember,
    text: string,
    observe: (event: RuntimeObservation) => void,
    options?: { outputSchema?: Record<string, unknown> },
  ): Promise<unknown>;
  approve(
    runId: string,
    nativeId: string,
    decision: "allow" | "deny",
  ): Promise<void>;
  stop(runId: string): Promise<void>;
  dispose(): Promise<void>;
}
