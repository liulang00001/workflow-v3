'use client';

import { useCallback, useMemo } from 'react';
import {
  ReactFlow,
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  useNodesState,
  useEdgesState,
  NodeProps,
  Handle,
  Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { FlowChart as FlowChartData } from '@/lib/types';

// ==================== 自定义节点 ====================

function StartNode({ data }: NodeProps) {
  return (
    <div className="px-4 py-2 rounded-full border-2 border-green-500 bg-green-50 text-green-800 text-xs font-bold text-center">
      {data.label as string}
      <Handle type="source" position={Position.Bottom} className="!bg-green-500" />
    </div>
  );
}

function EndNode({ data }: NodeProps) {
  return (
    <div className="px-4 py-2 rounded-full border-2 border-red-400 bg-red-50 text-red-800 text-xs font-bold text-center">
      <Handle type="target" position={Position.Top} className="!bg-red-400" />
      {data.label as string}
    </div>
  );
}

function ConditionNode({ data }: NodeProps) {
  const tooltip = [data.moduleType, data.paramsSummary].filter(Boolean).join('\n');
  return (
    <div
      title={tooltip as string}
      className="border-2 border-amber-500 bg-amber-50 text-amber-900 text-xs text-center"
      style={{ borderRadius: '4px', minWidth: 140, maxWidth: 220, padding: '6px 10px' }}
    >
      <Handle type="target" position={Position.Top} className="!bg-amber-500" />
      {/* 模块类型 badge */}
      {typeof data.moduleType === 'string' && data.moduleType && (
        <div className="text-[9px] font-semibold text-amber-500 uppercase tracking-wide mb-0.5">
          {data.moduleType as string}
        </div>
      )}
      {/* 节点标签 */}
      <div className="font-bold text-[11px] leading-tight">{data.label as string}</div>
      {/* 条件表达式 */}
      {typeof data.conditionText === 'string' && data.conditionText && (
        <div className="text-[10px] mt-1 text-amber-700 font-mono leading-snug whitespace-pre-wrap break-all">
          {data.conditionText as string}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} id="true"  className="!bg-green-500 !left-[30%]" />
      <Handle type="source" position={Position.Bottom} id="false" className="!bg-red-500  !left-[70%]" />
    </div>
  );
}

function ActionNode({ data }: NodeProps) {
  const tooltip = [data.moduleType, data.paramsSummary].filter(Boolean).join('\n');
  return (
    <div
      title={tooltip as string}
      className="rounded border-2 border-blue-400 bg-blue-50 text-blue-900 text-xs text-center"
      style={{ minWidth: 140, maxWidth: 220, padding: '6px 10px' }}
    >
      <Handle type="target" position={Position.Top} className="!bg-blue-400" />
      {/* 模块类型 badge */}
      {typeof data.moduleType === 'string' && data.moduleType && (
        <div className="text-[9px] font-semibold text-blue-400 uppercase tracking-wide mb-0.5">
          {data.moduleType as string}
        </div>
      )}
      {/* 节点标签 */}
      <div className="font-bold text-[11px] leading-tight">{data.label as string}</div>
      {/* 处理逻辑摘要 */}
      {typeof data.description === 'string' && data.description && (
        <div className="text-[10px] mt-1 text-blue-600 leading-snug whitespace-pre-wrap break-all">
          {data.description as string}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-blue-400" />
    </div>
  );
}

function LoopNode({ data }: NodeProps) {
  const tooltip = [data.moduleType, data.paramsSummary].filter(Boolean).join('\n');
  return (
    <div
      title={tooltip as string}
      className="rounded border-2 border-purple-500 bg-purple-50 text-purple-900 text-xs text-center"
      style={{ minWidth: 140, maxWidth: 220, padding: '6px 10px' }}
    >
      <Handle type="target" position={Position.Top} className="!bg-purple-500" />
      {/* 模块类型 badge */}
      {typeof data.moduleType === 'string' && data.moduleType && (
        <div className="text-[9px] font-semibold text-purple-400 uppercase tracking-wide mb-0.5">
          {data.moduleType as string}
        </div>
      )}
      {/* 节点标签 */}
      <div className="font-bold text-[11px] leading-tight flex items-center justify-center gap-1">
        <span>🔄</span>{data.label as string}
      </div>
      {/* 遍历目标摘要 */}
      {typeof data.description === 'string' && data.description && (
        <div className="text-[10px] mt-1 text-purple-600 leading-snug whitespace-pre-wrap break-all">
          {data.description as string}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-purple-500" />
    </div>
  );
}

// 节点类型映射（在组件外定义避免重复创建）
const nodeTypes = {
  start: StartNode,
  end: EndNode,
  condition: ConditionNode,
  action: ActionNode,
  loop: LoopNode,
};

// ==================== 主组件 ====================

interface FlowChartProps {
  flowChart: FlowChartData;
  onNodeClick?: (nodeId: string, codeRange?: { startLine: number; endLine: number }) => void;
}

export default function FlowChartView({ flowChart, onNodeClick }: FlowChartProps) {
  const initialNodes: Node[] = useMemo(() =>
    flowChart.nodes.map(n => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: { label: n.label, description: n.description, conditionText: n.conditionText, codeRange: n.codeRange, moduleType: n.moduleType, paramsSummary: n.paramsSummary },
    }))
  , [flowChart.nodes]);

  const initialEdges: Edge[] = useMemo(() =>
    flowChart.edges.map(e => {
      const color = e.type === 'true' ? '#16a34a' : e.type === 'false' ? '#dc2626' : '#60a5fa';
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
        animated: e.type === 'loop-back',
        style: { stroke: color, strokeWidth: 2 },
        labelStyle: { fontSize: 10 },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
      };
    })
  , [flowChart.edges]);

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  const handleNodeClick = useCallback((_: any, node: Node) => {
    if (onNodeClick) {
      const codeRange = node.data?.codeRange as { startLine: number; endLine: number } | undefined;
      onNodeClick(node.id, codeRange);
    }
  }, [onNodeClick]);

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        nodeTypes={nodeTypes}
        fitView
        attributionPosition="bottom-left"
      >
        <Background gap={16} size={1} />
        <Controls />
        <MiniMap nodeStrokeWidth={3} />
      </ReactFlow>
    </div>
  );
}
