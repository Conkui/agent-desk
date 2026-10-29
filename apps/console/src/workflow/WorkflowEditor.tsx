import { useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { Workflow } from "@agent-desk/contracts";
import type { Bootstrap } from "../types";
import { request } from "../api";
import { WorkflowForm, type WorkflowDraft } from "./WorkflowForm";

export function WorkflowEditor({
  workflow,
  bootstrap,
  focusMemberId,
  onClose,
  onSaved,
}: {
  workflow: Workflow;
  bootstrap: Bootstrap;
  focusMemberId?: string;
  onClose: () => void;
  onSaved: (workflow: Workflow) => void;
}) {
  const pending = useRef<{ body: string; id: string } | null>(null);
  async function save(draft: WorkflowDraft) {
    const body = JSON.stringify(draft);
    if (pending.current?.body !== body)
      pending.current = { body, id: crypto.randomUUID() };
    const result = await request<{ workflow: Workflow }>(
      `/workflows/${workflow.id}`,
      {
        ...draft,
        expectedVersion: workflow.version ?? 1,
        commandId: pending.current.id,
      },
      "PATCH",
    );
    onSaved(result.workflow);
  }
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
          className="workflow-editor"
          aria-describedby="workflow-editor-description"
        >
          <header>
            <div>
              <Dialog.Title>工作流设置</Dialog.Title>
              <Dialog.Description id="workflow-editor-description">
                任务、节点和编排权限
              </Dialog.Description>
            </div>
            <Dialog.Close className="icon-button" aria-label="关闭工作流设置">
              <X size={20} />
            </Dialog.Close>
          </header>
          <div className="workflow-editor-body">
            <WorkflowForm
              initial={workflow}
              bootstrap={bootstrap}
              navigate={() => {}}
              embedded
              onSave={save}
              onCancel={onClose}
              focusMemberId={focusMemberId}
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
