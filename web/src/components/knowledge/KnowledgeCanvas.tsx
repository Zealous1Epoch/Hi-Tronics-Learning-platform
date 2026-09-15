import { useMemo, useCallback, useEffect, useRef } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import KnowledgeNodeCard, { type KnowledgeNodeData } from "./KnowledgeNodeCard";

// ── 树形数据 ──

export interface TreeNode {
  id: string;
  title: string;
  description: string | null;
  content: string | null;
  parent_id: string | null;
  position_x: number | null;
  position_y: number | null;
  sort_order: number;
  status: string;
  children: TreeNode[];
  files: { id: string; original_name: string; file_size: number | null; file_type: string }[];
}

// ── 树形 → React Flow 扁平化 ──

function flattenTree(
  tree: TreeNode[],
  depth: number = 0
): { nodes: Node<KnowledgeNodeData>[]; edges: Edge[] } {
  const rfNodes: Node<KnowledgeNodeData>[] = [];
  const rfEdges: Edge[] = [];

  for (const node of tree) {
    const fileCount = node.files?.length || 0;
    const childCount = node.children?.length || 0;

    rfNodes.push({
      id: node.id,
      type: "knowledgeNode",
      position: {
        x: node.position_x ?? Math.random() * 100,  // dagre 会覆盖
        y: node.position_y ?? Math.random() * 100,
      },
      data: {
        id: node.id,
        title: node.title,
        description: node.description,
        content: node.content,
        fileCount,
        childCount,
        depth,
        status: node.status,
      },
    });

    const childResult = flattenTree(node.children, depth + 1);
    rfNodes.push(...childResult.nodes);
    rfEdges.push(...childResult.edges);

    for (const child of node.children) {
      rfEdges.push({
        id: `${node.id}->${child.id}`,
        source: node.id,
        target: child.id,
        type: "smoothstep",
        animated: false,
        style: { stroke: "#1B365D", strokeWidth: 1.5, opacity: 0.4 },
      });
    }
  }

  return { nodes: rfNodes, edges: rfEdges };
}

// ── dagre 布局 ──

function applyDagreLayout(nodes: Node<KnowledgeNodeData>[], edges: Edge[]) {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 60, ranksep: 100, edgesep: 40 });

  for (const node of nodes) {
    const depth = Math.min(node.data.depth, 2);
    const w = depth === 0 ? 200 : depth === 1 ? 170 : 150;
    const h = depth === 0 ? 110 : depth === 1 ? 95 : 80;
    g.setNode(node.id, { width: w, height: h });
  }

  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return nodes.map((n) => {
    const pos = g.node(n.id);
    if (pos) {
      return {
        ...n,
        position: { x: pos.x - pos.width / 2, y: pos.y },
      };
    }
    return n;
  });
}

// ── 配置 ──

const nodeTypes: NodeTypes = {
  knowledgeNode: KnowledgeNodeCard,
};

const minimapStyle = {
  height: 120,
  backgroundColor: "#faf9f5",
  border: "1px solid #e8e6dc",
};

// ── Props ──

interface KnowledgeCanvasProps {
  tree: TreeNode[];
  /** 是否可拖拽编辑 */
  editable: boolean;
  /** 节点被点击 */
  onNodeClick?: (node: TreeNode) => void;
  /** 节点拖拽结束 */
  onNodeDragStop?: (nodeId: string, x: number, y: number) => void;
  /** 右键菜单 */
  onNodeContextMenu?: (node: TreeNode, event: React.MouseEvent) => void;
  /** 搜索高亮节点 ID */
  highlightId?: string | null;
  /** Prezi 聚焦节点 ID */
  focusNodeId?: string | null;
}

// ── 内部组件（需要 ReactFlowProvider context） ──

function InnerCanvas({
  tree,
  editable,
  onNodeClick,
  onNodeDragStop,
  onNodeContextMenu,
  highlightId,
  focusNodeId,
}: KnowledgeCanvasProps) {
  const { initialNodes, initialEdges } = useMemo(() => {
    const { nodes, edges } = flattenTree(tree);
    const laidOut = applyDagreLayout(nodes, edges);
    return { initialNodes: laidOut, initialEdges: edges };
  }, [tree]);

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, _setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const { fitView } = useReactFlow();
  const prevFocusRef = useRef<string | null | undefined>(null);

  // Prezi 聚焦动画
  useEffect(() => {
    if (focusNodeId && focusNodeId !== prevFocusRef.current) {
      // 小幅延迟确保节点已渲染
      const timer = setTimeout(() => {
        fitView({ nodes: [{ id: focusNodeId }], duration: 800, padding: 0.6 });
      }, 100);
      prevFocusRef.current = focusNodeId;
      return () => clearTimeout(timer);
    }
  }, [focusNodeId, fitView]);

  // 搜索高亮
  const nodesWithHighlight = useMemo(() => {
    if (!highlightId) return nodes;
    return nodes.map((n) => ({
      ...n,
      selected: n.id === highlightId,
    }));
  }, [nodes, highlightId]);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      const data = node.data as KnowledgeNodeData;
      onNodeClick?.({
        id: node.id,
        title: data.title,
        description: data.description,
        content: data.content,
        parent_id: null,
        position_x: node.position.x,
        position_y: node.position.y,
        sort_order: 0,
        status: data.status,
        children: [],
        files: [],
      });
    },
    [onNodeClick]
  );

  const handleNodeDragStop = useCallback(
    (_event: unknown, node: Node) => {
      onNodeDragStop?.(node.id, node.position.x, node.position.y);
    },
    [onNodeDragStop]
  );

  const handleNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault();
      const data = node.data as KnowledgeNodeData;
      onNodeContextMenu?.(
        {
          id: node.id,
          title: data.title,
          description: data.description,
          content: data.content,
          parent_id: null,
          position_x: node.position.x,
          position_y: node.position.y,
          sort_order: 0,
          status: data.status,
          children: [],
          files: [],
        },
        event
      );
    },
    [onNodeContextMenu]
  );

  return (
    <ReactFlow
      nodes={nodesWithHighlight}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      onNodeClick={handleNodeClick}
      onNodeDragStop={handleNodeDragStop}
      onNodeContextMenu={handleNodeContextMenu}
      nodesDraggable={editable}
      nodesConnectable={false}
      elementsSelectable={editable}
      fitView
      fitViewOptions={{ padding: 0.3, duration: 300 }}
      minZoom={0.1}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
      style={{ background: "#f5f4ed" }}
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={20}
        size={1}
        color="#d4d0c4"
      />
      <MiniMap style={minimapStyle} pannable zoomable nodeColor="#1B365D" />
    </ReactFlow>
  );
}

// ── 外层组件（ReactFlowProvider） ──

export default function KnowledgeCanvas(props: KnowledgeCanvasProps) {
  return (
    <ReactFlowProvider>
      <InnerCanvas {...props} />
    </ReactFlowProvider>
  );
}