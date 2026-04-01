// ==================== 核心数据类型 ====================

import { WorkflowDefinition } from './workflow-schema';

/** 流程图节点 — 从 JSON 工作流定义生成 */
export interface FlowNode {
  id: string;
  type: 'start' | 'end' | 'condition' | 'action' | 'loop';
  label: string;
  /** 对应源码行号范围（从 JSON 生成时可选） */
  codeRange?: { startLine: number; endLine: number };
  /** 关联的 JSON 节点 ID */
  nodeRef?: string;
  /** 人类可读的逻辑描述 */
  description: string;
  /** 条件节点的条件表达式文本 */
  conditionText?: string;
  /** 模块类型名称（用于节点卡片的 badge 标签，如"跳变检测"） */
  moduleType?: string;
  /** 用于 Tooltip 展示的完整参数摘要文本 */
  paramsSummary?: string;
  position: { x: number; y: number };
}

/** 流程图边 */
export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  type?: 'true' | 'false' | 'next' | 'loop-back';
}

/** 从 JSON 工作流定义生成的流程图 */
export interface FlowChart {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/** 信号定义 */
export interface SignalDef {
  name: string;
  description: string;
  values?: Record<string, string>;
}

/** 项目状态 — 整个应用的状态 */
export interface ProjectState {
  /** 用户自然语言描述 */
  description: string;
  /** LLM 生成的工作流定义 */
  workflowDef: WorkflowDefinition | null;
  /** 从工作流定义生成的 TS 代码 */
  generatedCode: string;
  /** 从工作流定义生成的流程图 */
  flowChart: FlowChart | null;
  /** 信号定义列表 */
  signals: SignalDef[];
  /** 上传的数据 */
  data: DataTable | null;
  /** 执行结果 */
  result: ExecutionResult | null;
  /** 状态 */
  status: 'idle' | 'generating' | 'parsing' | 'executing' | 'done' | 'error';
  error?: string;
}

/** 上传的表格数据 */
export interface DataTable {
  headers: string[];
  rows: (string | number)[][];
  fileName: string;
}

/** 执行结果 */
export interface ExecutionResult {
  success: boolean;
  findings: Finding[];
  timeline: TimelineEntry[];
  summary: string;
  /** 执行耗时(ms) */
  duration: number;
  /** 分析报告（代码中 console.log 输出） */
  report: string[];
  /** 系统调试日志（TRACE/DEBUG/INFO） */
  logs: string[];
}

/** 分析发现 */
export interface Finding {
  time: string;
  type: 'success' | 'warning' | 'info' | 'error';
  message: string;
  details?: Record<string, any>;
}

/** 时间轴条目 */
export interface TimelineEntry {
  time: string;
  event: string;
  row?: number;
}
