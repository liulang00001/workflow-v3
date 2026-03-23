/**
 * 工作流 JSON 节点 Schema
 *
 * 核心理念：LLM 生成结构化的 JSON 工作流定义，每个节点对应一个预定义标准模块。
 * 节点之间可自由组合和嵌套，系统根据 JSON 自动生成流程图和可执行 TS 代码。
 */

/** 所有可用的标准模块名称 */
export type ModuleName =
  // 核心扫描
  | 'scanAll'
  | 'forEachEvent'
  | 'loopScan'
  // 条件判断
  | 'checkValue'
  | 'checkMultiValues'
  | 'checkTimeRange'
  // 跳变检测
  | 'detectTransition'
  | 'detectMultiTransition'
  | 'detectSequence'
  // 统计分析
  | 'aggregate'
  | 'detectDuration'
  | 'countOccurrences'
  | 'detectStable'
  | 'detectOscillation'
  | 'computeRate'
  // 搜索
  | 'findFirst'
  | 'findAll'
  | 'slidingWindow'
  // 分支
  | 'switchValue'
  // 信号比较
  | 'compareSignals'
  // 状态分组
  | 'groupByState'
  // 伪模块：控制流与输出
  | 'condition'
  | 'output';

/** 条件定义 */
export interface ConditionDef {
  signal: string;
  operator: '==' | '!=' | '>' | '>=' | '<' | '<=' | 'in' | 'not_in';
  value: any;
  transform?: 'abs';
}

/** 单个工作流节点 */
export interface WorkflowNode {
  /** 唯一标识 */
  id: string;
  /** 使用的标准模块 */
  module: ModuleName;
  /** 流程图中的显示标签 */
  label: string;
  /** 模块参数（不同模块的参数结构不同） */
  params: Record<string, any>;
  /** 容器节点的子步骤（scanAll, forEachEvent, loopScan 等） */
  children?: WorkflowNode[];
  /** 分支节点的分支（switchValue: case值→步骤; condition: true/false→步骤） */
  branches?: Record<string, WorkflowNode[]>;
  /** 条件表达式（用于 condition 伪模块） */
  condition?: ConditionDef;
  /** 描述说明 */
  description?: string;
}

/** 变量定义 */
export interface VariableDef {
  name: string;
  type: string;
  initial: any;
}

/** 完整的工作流定义 — LLM 输出的 JSON 结构 */
export interface WorkflowDefinition {
  /** 工作流名称 */
  name: string;
  /** 工作流描述 */
  description: string;
  /** 顶层步骤列表（有序执行） */
  steps: WorkflowNode[];
  /** 工作流使用的变量 */
  variables?: VariableDef[];
}
