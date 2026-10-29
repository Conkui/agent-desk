import { useState } from "react";

/** Drafts are scoped to this browser tab and run; never mix messages from different nodes. */
export function useMessageDraft(key: string) {
  const storageKey = `agent-desk:message:${key}`;
  const read = () => {
    try {
      return sessionStorage.getItem(storageKey) ?? "";
    } catch {
      return "";
    }
  };
  const [draft, setDraft] = useState(() => ({ key, text: read() }));
  const text = draft.key === key ? draft.text : read();
  const update = (text: string) => {
    setDraft({ key, text });
    try {
      if (text) sessionStorage.setItem(storageKey, text);
      else sessionStorage.removeItem(storageKey);
    } catch {
      /* In-memory editing remains available. */
    }
  };
  return [text, update] as const;
}
