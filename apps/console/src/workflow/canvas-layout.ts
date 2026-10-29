import { graphlib, layout } from "@dagrejs/dagre";
import type { XYPosition, Viewport } from "@xyflow/react";

type Preferences = {
  positions: Record<string, XYPosition>;
  viewport?: Viewport;
  viewportSize?: { width: number; height: number };
};
/** View preferences are local UI state; they never alter execution dependencies. */
export function readPreferences(key: string): Preferences {
  try {
    const data = JSON.parse(
      localStorage.getItem("agent-desk:canvas:" + key) ?? "null",
    );
    const positions: Preferences["positions"] = {};
    for (const [id, value] of Object.entries(data?.positions ?? {}) as [
      string,
      XYPosition,
    ][])
      if (
        Number.isFinite(value?.x) &&
        Number.isFinite(value?.y) &&
        Math.abs(value.x) < 50000 &&
        Math.abs(value.y) < 50000
      )
        positions[id] = value;
    const view = data?.viewport;
    return {
      positions,
      viewportSize:
        Number.isFinite(data?.viewportSize?.width) &&
        Number.isFinite(data?.viewportSize?.height)
          ? data.viewportSize
          : undefined,
      viewport:
        view &&
        Number.isFinite(view.x) &&
        Number.isFinite(view.y) &&
        view.zoom >= 0.25 &&
        view.zoom <= 1.6
          ? view
          : undefined,
    };
  } catch {
    return { positions: {} };
  }
}
export function writePreferences(key: string, preferences: Preferences) {
  try {
    localStorage.setItem(
      "agent-desk:canvas:" + key,
      JSON.stringify(preferences),
    );
  } catch {
    /* Browsing remains usable when storage is full or disabled. */
  }
}
export function arrangeNodes(
  ids: string[],
  edges: Array<{ source: string; target: string }>,
) {
  const graph = new graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: "LR",
    ranksep: 125,
    nodesep: 52,
    marginx: 50,
    marginy: 50,
  });
  for (const id of ids) graph.setNode(id, { width: 254, height: 180 });
  for (const edge of edges) graph.setEdge(edge.source, edge.target);
  layout(graph);
  return Object.fromEntries(
    ids.map((id) => {
      const position = graph.node(id);
      return [id, { x: position.x - 127, y: position.y - 90 }];
    }),
  );
}
