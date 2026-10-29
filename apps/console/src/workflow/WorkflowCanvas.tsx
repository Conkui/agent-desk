import { useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  useNodesState,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import {
  Bot,
  GitBranch,
  MessageSquare,
  Target,
  Settings2,
  Network,
} from "lucide-react";
import type { Run, Workflow } from "@agent-desk/contracts";
import { cliNames, labels } from "../components";
import "@xyflow/react/dist/style.css";
import {
  arrangeNodes,
  readPreferences,
  writePreferences,
} from "./canvas-layout";

type AgentNode = Node<
  {
    name: string;
    cli?: string;
    role: string;
    description: string;
    state?: string;
    count: number;
    pending: number;
    onOpen: () => void;
    onConfigure?: () => void;
  },
  "agent"
>;
function AgentCard({ data }: NodeProps<AgentNode>) {
  return (
    <div
      className={`agent-card ${data.role === "编排器" ? "orchestrator-card" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={`打开${data.name}消息`}
      onKeyDown={(event) => {
        if (
          event.target === event.currentTarget &&
          ["Enter", " "].includes(event.key)
        ) {
          event.preventDefault();
          data.onOpen();
        }
      }}
    >
      <Handle type="target" position={Position.Left} id="input" />
      <Handle type="source" position={Position.Right} id="output" />
      <Handle
        type="source"
        position={Position.Left}
        id="return"
        style={{ top: "75%" }}
      />
      <Handle
        type="target"
        position={Position.Right}
        id="report"
        style={{ top: "78%" }}
      />
      <div className="agent-card-top">
        <span className="agent-icon">
          {data.role === "编排器" ? (
            <GitBranch size={18} />
          ) : data.role === "任务" ? (
            <Target size={18} />
          ) : (
            <Bot size={18} />
          )}
        </span>
        <span className="node-role">{data.role}</span>
        {data.onConfigure && (
          <button
            className="node-configure nodrag"
            aria-label={`设置${data.name}`}
            onClick={(event) => {
              event.stopPropagation();
              data.onConfigure?.();
            }}
          >
            <Settings2 size={14} />
          </button>
        )}
        {data.state && <span className={`node-dot state-${data.state}`} />}
      </div>
      <strong>{data.name}</strong>
      <p>{data.description}</p>
      <div className="agent-card-footer">
        <span>{data.cli ? (cliNames[data.cli] ?? data.cli) : "任务输入"}</span>
        <span>
          {data.pending > 0
            ? `${data.pending} 项待审批`
            : data.state
              ? labels[data.state]
              : ""}
          {data.count > 0 && (
            <>
              {" "}
              · <MessageSquare size={11} /> {data.count}
            </>
          )}
        </span>
      </div>
    </div>
  );
}
const nodeTypes = { agent: AgentCard };
export function WorkflowCanvas({
  workflow,
  run,
  onSelect,
  onConfigure,
}: {
  workflow: Workflow;
  run: Run | null;
  onSelect: (
    id: string,
    tab?: "activity" | "incoming" | "outgoing" | "reasoning",
  ) => void;
  onConfigure?: (id?: string) => void;
}) {
  const preferenceKey = run?.id ?? workflow.id;
  const [preferences] = useState(() => readPreferences(preferenceKey));
  // A view saved on a wide screen can put every node outside a narrow screen.
  const restoreViewport =
    preferences.viewportSize &&
    Math.abs(preferences.viewportSize.width - window.innerWidth) < 100 &&
    Math.abs(preferences.viewportSize.height - window.innerHeight) < 100
      ? preferences.viewport
      : undefined;
  const flow = useRef<Pick<
    ReactFlowInstance<AgentNode>,
    "getNodes" | "getViewport" | "fitView"
  > | null>(null);
  const members = run?.members ?? workflow.members;
  const coordinator = members.find((member) =>
    member.roles.includes("coordinator"),
  )!;
  const workers = members.filter((member) => member.id !== coordinator.id);
  const graph = useMemo(() => {
    const nodes: AgentNode[] = [
      {
        id: "user",
        type: "agent",
        position: { x: 0, y: Math.max(0, (workers.length - 1) * 100) },
        data: {
          name: workflow.name,
          role: "任务",
          description: workflow.task,
          count: 0,
          pending: 0,
          onOpen: () => onSelect("user"),
          onConfigure: onConfigure ? () => onConfigure() : undefined,
        },
      },
      ...members.map((member) => ({
        id: member.id,
        type: "agent" as const,
        position:
          member.id === coordinator.id
            ? { x: 350, y: Math.max(0, (workers.length - 1) * 100) }
            : { x: 740, y: workers.findIndex((w) => w.id === member.id) * 210 },
        data: {
          name: member.name,
          cli: member.cli,
          role: member.roles.includes("coordinator") ? "编排器" : "工作节点",
          description: member.responsibility,
          state: "state" in member ? String(member.state) : "queued",
          count:
            "messages" in member && Array.isArray(member.messages)
              ? member.messages.length
              : 0,
          pending:
            run?.approvals.filter(
              (item) => item.memberId === member.id && item.state === "pending",
            ).length ?? 0,
          onOpen: () => onSelect(member.id),
          onConfigure: onConfigure ? () => onConfigure(member.id) : undefined,
        },
      })),
    ];
    const edge = (
      id: string,
      source: string,
      target: string,
      label: string,
      returned = false,
    ) => ({
      id,
      source,
      target,
      label,
      sourceHandle: returned ? "return" : "output",
      targetHandle: returned ? "report" : "input",
      type: "smoothstep",
      animated: run?.state === "running" && !returned,
      style: {
        stroke: returned ? "#a3aba9" : "#618678",
        strokeWidth: 1.5,
        strokeDasharray: returned ? "5 5" : undefined,
      },
      labelStyle: { fontSize: 11, fill: "#61726c" },
      labelBgStyle: { fill: "#f7faf8" },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: returned ? "#a3aba9" : "#618678",
      },
    });
    const positions = arrangeNodes(
      nodes.map((node) => node.id),
      [
        { source: "user", target: coordinator.id },
        ...workers.map((worker) => ({
          source: coordinator.id,
          target: worker.id,
        })),
      ],
    );
    return {
      nodes: nodes.map((node) => ({
        ...node,
        position: preferences.positions[node.id] ?? positions[node.id],
      })),
      edges: [
        edge("goal", "user", coordinator.id, "任务"),
        ...workers.flatMap((worker) => [
          edge(`task-${worker.id}`, coordinator.id, worker.id, "分派"),
          edge(`result-${worker.id}`, worker.id, coordinator.id, "返回", true),
        ]),
      ],
    };
  }, [
    workflow,
    members,
    run?.state,
    run?.approvals,
    onSelect,
    onConfigure,
    preferences,
  ]);
  const [nodes, setNodes, onNodesChange] = useNodesState<AgentNode>(
    graph.nodes,
  );
  function saveView() {
    if (flow.current)
      writePreferences(preferenceKey, {
        positions: Object.fromEntries(
          flow.current.getNodes().map((node) => [node.id, node.position]),
        ),
        viewport: flow.current.getViewport(),
        viewportSize: { width: window.innerWidth, height: window.innerHeight },
      });
  }
  function autoLayout() {
    const positions = arrangeNodes(
      nodes.map((node) => node.id),
      graph.edges.filter((edge) => !edge.id.startsWith("result-")),
    );
    setNodes((nodes) =>
      nodes.map((node) => ({ ...node, position: positions[node.id] })),
    );
    requestAnimationFrame(() => {
      void flow.current?.fitView({ padding: 0.25, maxZoom: 1 }).then(saveView);
    });
  }
  useEffect(() => {
    let width = window.innerWidth;
    let height = window.innerHeight;
    const resize = () => {
      if (
        Math.abs(width - window.innerWidth) < 100 &&
        Math.abs(height - window.innerHeight) < 100
      )
        return;
      width = window.innerWidth;
      height = window.innerHeight;
      void flow.current?.fitView({ padding: 0.15, maxZoom: 1 }).then(saveView);
    };
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [preferenceKey]);
  // Live messages update card data without resetting a node the user has moved.
  useEffect(
    () =>
      setNodes((previous) =>
        graph.nodes.map((node) => ({
          ...node,
          position:
            previous.find((item) => item.id === node.id)?.position ??
            node.position,
        })),
      ),
    [graph, setNodes],
  );
  return (
    <div className="workflow-canvas" aria-label="工作流画布">
      <ReactFlow
        nodes={nodes}
        edges={graph.edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onInit={(instance) => {
          flow.current = instance;
        }}
        onMoveEnd={saveView}
        onNodeDragStop={saveView}
        defaultViewport={restoreViewport}
        onNodeClick={(_, node) => {
          onSelect(node.id);
        }}
        onEdgeClick={(_, edge) =>
          onSelect(
            edge.source === "user" ? edge.target : edge.source,
            edge.source === "user" ? "incoming" : "outgoing",
          )
        }
        fitView={!restoreViewport}
        fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
        minZoom={0.25}
        maxZoom={1.6}
        nodesConnectable={false}
        deleteKeyCode={null}
        ariaLabelConfig={{
          "controls.zoomIn.ariaLabel": "放大",
          "controls.zoomOut.ariaLabel": "缩小",
          "controls.fitView.ariaLabel": "查看全图",
          "controls.interactive.ariaLabel": "切换拖动",
        }}
      >
        <Background color="#d6dfda" gap={22} size={1} />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(node) =>
            node.id === coordinator.id ? "#517366" : "#d0dcd6"
          }
        />
        <Panel position="top-left">
          <div className="canvas-label">
            <GitBranch size={15} /> 工作流 <span>{members.length} 个节点</span>
          </div>
        </Panel>
        <Panel position="top-right">
          <button className="canvas-layout-button" onClick={autoLayout}>
            <Network size={14} /> 自动布局
          </button>
        </Panel>
        <Panel position="bottom-center">
          <span className="canvas-guide">
            拖动画布 · 滚轮缩放 · 点击节点查看消息
          </span>
        </Panel>
      </ReactFlow>
    </div>
  );
}
