import type { Run } from "@agent-desk/contracts";

// Older completed requests can update the view while newer ones are still in flight.
export function acceptRefresh(
  sequence: number,
  applied: number,
  selected: string | null,
  current: string | null,
) {
  return sequence > applied && selected === current;
}

export function newestRun(current: Run | null, incoming: Run | null) {
  return current &&
    incoming &&
    current.id === incoming.id &&
    current.version > incoming.version
    ? current
    : incoming;
}
