import type { Bootstrap } from "../types";
import { WorkflowForm } from "../workflow/WorkflowForm";
import { workflowDrafts } from "../workflow/workflow-draft";
import { useEffect, useState } from "react";
export function CreateWorkflow({
  bootstrap,
  navigate,
}: {
  bootstrap: Bootstrap;
  navigate: (path: string) => void;
}) {
  const [revision, setRevision] = useState(0),
    [undo, setUndo] = useState(false);
  useEffect(() => setUndo(false), [bootstrap.workspace]);
  return (
    <main>
      <WorkflowForm
        key={`${bootstrap.workspace}:${revision}`}
        bootstrap={bootstrap}
        navigate={navigate}
        headerActions={(busy) => (
          <div className="form-draft-actions">
            {undo && (
              <button
                disabled={busy}
                onClick={() => {
                  if (workflowDrafts.restore(bootstrap.workspace)) {
                    setRevision((value) => value + 1);
                    setUndo(false);
                  }
                }}
              >
                撤销清空
              </button>
            )}
            <button
              disabled={busy}
              onClick={() => {
                setUndo(workflowDrafts.discard(bootstrap.workspace));
                setRevision((value) => value + 1);
              }}
            >
              清空
            </button>
          </div>
        )}
      />
    </main>
  );
}
