import { mkdir, rm } from "node:fs/promises";
import { resolve, join, relative } from "node:path";
import { Store } from "@agent-desk/storage";
import { Profiles } from "@agent-desk/provider-config";
import { Workflows } from "@agent-desk/workflow-service";
import type { Runtime, RuntimeObservation } from "@agent-desk/agent-runtime";
import type { Run, RunMember } from "@agent-desk/contracts";

export class FakeRuntime implements Runtime {
  starts: string[] = [];
  prompts: string[] = [];
  stopped: string[] = [];
  approvalMode = false;
  private waiting?: () => void;
  async scan() {
    return [
      {
        cli: "opencode" as const,
        name: "OpenCode (test runtime)",
        installed: true,
        supported: true,
      },
    ];
  }
  async prepare(_run: Run) {}
  async execute(
    _run: Run,
    member: RunMember,
    text: string,
    observe: (event: RuntimeObservation) => void,
    _options?: { outputSchema?: Record<string, unknown> },
  ): Promise<unknown> {
    this.starts.push(member.id);
    this.prompts.push(text);
    if (this.approvalMode) {
      observe({
        type: "approval",
        id: "native-approval",
        tool: "bash",
        detail: "echo test",
      });
      await new Promise<void>((resolve) => {
        this.waiting = resolve;
      });
    }
    observe({
      type: "output",
      id: crypto.randomUUID(),
      role: "assistant",
      text: `test result: ${member.name}`,
    });
    return undefined;
  }
  async approve() {
    this.waiting?.();
  }
  async stop(id: string) {
    this.stopped.push(id);
    this.waiting?.();
  }
  async dispose() {}
}
export async function fixture() {
  const parent = resolve(import.meta.dir, "../.local/tests"),
    home = join(parent, "independent-" + crypto.randomUUID());
  await mkdir(home, { recursive: true });
  const workspace = join(home, "workspace");
  await mkdir(workspace);
  const store = new Store(join(home, "state.sqlite")),
    runtime = new FakeRuntime(),
    profiles = new Profiles(home),
    service = new Workflows(store, runtime, workspace);
  const member = {
    id: crypto.randomUUID(),
    name: "Coordinator",
    cli: "opencode" as const,
    roles: ["coordinator", "worker"] as Array<"coordinator" | "worker">,
    responsibility: "Say OK",
  };
  const input = {
    commandId: crypto.randomUUID(),
    name: "Test workflow",
    task: "Reply OK without tools",
    directory: workspace,
    members: [member],
    permissionPolicy: "ask" as const,
  };
  return {
    home,
    workspace,
    store,
    runtime,
    profiles,
    service,
    input,
    async close() {
      store.close();
      if (relative(parent, home).startsWith(".."))
        throw new Error("Unsafe test cleanup");
      await rm(home, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 50,
      });
    },
  };
}
export async function until(check: () => boolean) {
  for (let index = 0; index < 100; index++) {
    if (check()) return;
    await Bun.sleep(5);
  }
  throw new Error("Test state did not settle");
}
