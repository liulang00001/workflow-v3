/**
 * Dagre 自动布局
 *
 * 使用 Sugiyama 算法进行层级布局，自动最小化边交叉，
 * 替代原有简单 BFS 布局。供 json-to-flow 使用。
 */
import dagre from '@dagrejs/dagre';
import { FlowNode, FlowEdge } from './types';

/** 估算单行文本渲染宽度（px），基于字符类型粗略计算 */
function estimateTextWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const ch of text) {
    // 中文/全角字符约等于 fontSize，ASCII 约 0.55 * fontSize
    width += ch.charCodeAt(0) > 127 ? fontSize : fontSize * 0.55;
  }
  return width;
}

/** 根据节点实际文本内容动态估算渲染尺寸 */
function estimateNodeSize(node: FlowNode): { width: number; height: number } {
  const padX = 24;  // 左右 padding (px 10 * 2 + border/margin)
  const padY = 16;  // 上下 padding
  const lineHeight = 16;
  const minW = 140;
  const maxW = 220;

  if (node.type === 'start' || node.type === 'end') {
    return { width: 100, height: 36 };
  }

  // 计算各行文本宽度
  let contentWidth = 0;
  let lines = 0;

  // moduleType badge (9px)
  if (node.moduleType) {
    contentWidth = Math.max(contentWidth, estimateTextWidth(node.moduleType, 9));
    lines += 1;
  }

  // label (11px bold)
  contentWidth = Math.max(contentWidth, estimateTextWidth(node.label, 11));
  lines += 1;

  // description / conditionText (10px) — 可能换行
  const detailText = node.conditionText || node.description || '';
  if (detailText) {
    const detailW = estimateTextWidth(detailText, 10);
    // 文本会在 maxW 处自动换行，估算行数
    const effectiveMaxW = maxW - padX;
    const wrapLines = Math.ceil(detailW / effectiveMaxW);
    contentWidth = Math.max(contentWidth, Math.min(detailW, effectiveMaxW));
    lines += wrapLines;
  }

  const width = Math.max(minW, Math.min(maxW, contentWidth + padX));
  const height = Math.max(40, padY + lines * lineHeight);

  return { width, height };
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
