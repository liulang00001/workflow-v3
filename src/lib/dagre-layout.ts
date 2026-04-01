/**
 * Dagre 自动布局
 *
 * 使用 Sugiyama 算法进行层级布局，自动最小化边交叉，
 * 替代原有简单 BFS 布局。供 json-to-flow 和 ast-parser 共用。
 */
import dagre from '@dagrejs/dagre';
import { FlowNode, FlowEdge } from './types';

/** 节点尺寸估算 */
function estimateNodeSize(node: FlowNode): { width: number; height: number } {
  switch (node.type) {
    case 'start':
    case 'end':
      return { width: 100, height: 36 };
    case 'condition':
      return { width: 160, height: 52 };
    case 'loop':
      return { width: 150, height: 44 };
    case 'action':
    default:
      return { width: 150, height: 48 };
  }
}

/**
 * 使用 dagre 对节点进行层级布局。
 * 直接修改 nodes 数组中每个节点的 position。
 */
export function dagreLayout(nodes: FlowNode[], edges: FlowEdge[]) {
  if (nodes.length === 0) return;

  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: 'TB',
    ranksep: 80,
    nodesep: 50,
    edgesep: 20,
    marginx: 40,
    marginy: 40,
  });
  g.setDefaultEdgeLabel(() => ({}));

  // 添加节点
  for (const node of nodes) {
    const size = estimateNodeSize(node);
    g.setNode(node.id, { width: size.width, height: size.height });
  }

  // 添加边（loop-back 权重为 0 避免影响层级分配）
  for (const edge of edges) {
    const weight = edge.type === 'loop-back' ? 0 : 1;
    g.setEdge(edge.source, edge.target, { weight, minlen: 1 });
  }

  dagre.layout(g);

  // 回写坐标（dagre 返回中心点坐标，reactflow 使用左上角）
  for (const node of nodes) {
    const pos = g.node(node.id);
    if (pos) {
      const size = estimateNodeSize(node);
      node.position = {
        x: pos.x - size.width / 2,
        y: pos.y - size.height / 2,
      };
    }
  }
}
