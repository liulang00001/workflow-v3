/**
 * JSON 工作流定义 → 流程图（FlowChart）
 *
 * 将 WorkflowDefinition 中的 steps 转换为 FlowNode/FlowEdge，
 * 用于 React Flow 可视化展示。
 */
import { FlowNode, FlowEdge, FlowChart } from './types';
import { WorkflowNode, WorkflowDefinition, ModuleName } from './workflow-schema';

let nodeCounter = 0;
let edgeCounter = 0;

function nextNodeId() { return `node_${++nodeCounter}`; }
function nextEdgeId() { return `edge_${++edgeCounter}`; }

/** 根据模块名确定流程图节点类型 */
function getNodeType(module: ModuleName): FlowNode['type'] {
  switch (module) {
    // 容器/循环类模块
    case 'scanAll':
    case 'forEachEvent':
    case 'loopScan':
    case 'slidingWindow':
      return 'loop';
    // 条件/判断类模块
    case 'condition':
    case 'checkValue':
    case 'checkMultiValues':
    case 'checkTimeRange':
      return 'condition';
    // 分支类（也视为条件）
    case 'switchValue':
      return 'condition';
    // 其他全部为 action
    default:
      return 'action';
  }
}

/** 获取模块的中文描述前缀 */
function getModulePrefix(module: ModuleName): string {
  const map: Partial<Record<ModuleName, string>> = {
    scanAll: '全量扫描',
    forEachEvent: '遍历事件',
    loopScan: '循环扫描',
    checkValue: '条件判断',
    checkMultiValues: '多条件判断',
    checkTimeRange: '时间窗口检查',
    detectTransition: '跳变检测',
    detectMultiTransition: '多信号跳变',
    detectSequence: '序列检测',
    switchValue: '多路分支',
    aggregate: '统计聚合',
    detectDuration: '持续检测',
    countOccurrences: '频率计数',
    findFirst: '查找首个',
    findAll: '查找全部',
    compareSignals: '信号比较',
    slidingWindow: '滑动窗口',
    detectStable: '稳态检测',
    detectOscillation: '抖动检测',
    computeRate: '变化率',
    groupByState: '状态分组',
    condition: '条件分支',
    output: '输出结果',
  };
  return map[module] || module;
}

/** 构建条件节点的条件文本 */
function buildConditionText(node: WorkflowNode): string {
  if (node.condition) {
    const { signal, operator, value, transform } = node.condition;
    const prefix = transform === 'abs' ? `|${signal}|` : signal;
    return `${prefix} ${operator} ${JSON.stringify(value)}`;
  }
  if (node.params?.signal && node.params?.operator) {
    const { signal, operator, value, transform } = node.params;
    const prefix = transform === 'abs' ? `|${signal}|` : signal;
    return `${prefix} ${operator} ${JSON.stringify(value)}`;
  }
  if (node.params?.conditions) {
    const logic = node.params.logic || 'and';
    return `${node.params.conditions.length}个条件(${logic.toUpperCase()})`;
  }
  return '';
}

interface PendingEdge {
  source: string;
  label?: string;
  type?: FlowEdge['type'];
}

function flushPending(pending: PendingEdge[], targetId: string, edges: FlowEdge[]) {
  for (const p of pending) {
    edges.push({
      id: nextEdgeId(),
      source: p.source,
      target: targetId,
      label: p.label,
      type: p.type || 'next',
    });
  }
  pending.length = 0;
}

/** 递归处理节点列表，生成流程图节点和边 */
function processSteps(
  steps: WorkflowNode[],
  nodes: FlowNode[],
  edges: FlowEdge[],
  pending: PendingEdge[],
): void {
  for (const step of steps) {
    const nodeType = getNodeType(step.module);
    const flowNodeId = nextNodeId();

    const conditionText = (nodeType === 'condition') ? buildConditionText(step) : undefined;

    nodes.push({
      id: flowNodeId,
      type: nodeType,
      label: step.label || getModulePrefix(step.module),
      description: step.description || `${getModulePrefix(step.module)}: ${summarizeParams(step)}`,
      conditionText,
      nodeRef: step.id,
      position: { x: 0, y: 0 },
    });

    flushPending(pending, flowNodeId, edges);

    // 处理嵌套子节点（容器模块）
    if (step.children && step.children.length > 0) {
      if (nodeType === 'loop') {
        // 循环类：子节点在循环体内，末尾连回循环节点
        const bodyPending: PendingEdge[] = [{ source: flowNodeId }];
        processSteps(step.children, nodes, edges, bodyPending);
        // 循环体出口连回循环节点
        for (const p of bodyPending) {
          edges.push({
            id: nextEdgeId(),
            source: p.source,
            target: flowNodeId,
            type: 'loop-back',
            label: '继续',
          });
        }
        // 循环节点本身是出口
        pending.push({ source: flowNodeId });
      } else {
        // 非循环容器：顺序连接子节点
        const childPending: PendingEdge[] = [{ source: flowNodeId }];
        processSteps(step.children, nodes, edges, childPending);
        pending.push(...childPending);
      }
    }
    // 处理分支节点
    else if (step.branches && Object.keys(step.branches).length > 0) {
      const branchKeys = Object.keys(step.branches);

      if (step.module === 'condition' || step.module === 'checkValue' || step.module === 'checkMultiValues' || step.module === 'checkTimeRange') {
        // 条件分支：true/false
        const trueBranch = step.branches['true'] || step.branches['是'] || [];
        const falseBranch = step.branches['false'] || step.branches['否'] || [];

        if (trueBranch.length > 0) {
          const truePending: PendingEdge[] = [{ source: flowNodeId, label: '是', type: 'true' }];
          processSteps(trueBranch, nodes, edges, truePending);
          pending.push(...truePending);
        } else {
          pending.push({ source: flowNodeId, label: '是', type: 'true' });
        }

        if (falseBranch.length > 0) {
          const falsePending: PendingEdge[] = [{ source: flowNodeId, label: '否', type: 'false' }];
          processSteps(falseBranch, nodes, edges, falsePending);
          pending.push(...falsePending);
        } else {
          pending.push({ source: flowNodeId, label: '否', type: 'false' });
        }
      } else {
        // switchValue 等多路分支
        for (const key of branchKeys) {
          const branchSteps = step.branches[key];
          if (branchSteps.length > 0) {
            const branchPending: PendingEdge[] = [{ source: flowNodeId, label: key, type: 'next' }];
            processSteps(branchSteps, nodes, edges, branchPending);
            pending.push(...branchPending);
          } else {
            pending.push({ source: flowNodeId, label: key, type: 'next' });
          }
        }
      }
    }
    // 普通节点：直接作为出口
    else {
      pending.push({ source: flowNodeId });
    }
  }
}

/** 参数摘要 */
function summarizeParams(node: WorkflowNode): string {
  const p = node.params;
  if (!p || Object.keys(p).length === 0) return '';

  if (p.signal) {
    if (p.from !== undefined && p.to !== undefined) {
      return `${p.signal}: ${p.from} → ${p.to}`;
    }
    if (p.operator && p.value !== undefined) {
      return `${p.signal} ${p.operator} ${p.value}`;
    }
    return p.signal;
  }
  if (p.conditions) {
    return `${p.conditions.length}个条件`;
  }
  return Object.entries(p).slice(0, 2).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ');
}

/** 自动布局（BFS 层级布局） */
function autoLayout(nodes: FlowNode[], edges: FlowEdge[]) {
  if (nodes.length === 0) return;

  const startNode = nodes.find(n => n.type === 'start') || nodes[0];
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.type === 'loop-back') continue;
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, []);
    adjacency.get(edge.source)!.push(edge.target);
  }

  const levels = new Map<string, number>();
  const queue = [startNode.id];
  levels.set(startNode.id, 0);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const level = levels.get(current) || 0;
    const children = adjacency.get(current) || [];

    for (const child of children) {
      if (!levels.has(child)) {
        levels.set(child, level + 1);
        queue.push(child);
      }
    }
  }

  const maxLevel = Math.max(...Array.from(levels.values()), 0);
  for (const node of nodes) {
    if (!levels.has(node.id)) levels.set(node.id, maxLevel + 1);
  }

  const levelCounts = new Map<number, number>();
  for (const node of nodes) {
    const level = levels.get(node.id) || 0;
    const col = levelCounts.get(level) || 0;
    levelCounts.set(level, col + 1);
    node.position = { x: 250 + col * 250, y: 60 + level * 120 };
  }
}

/** 将 WorkflowDefinition 转换为 FlowChart */
export function workflowToFlowChart(def: WorkflowDefinition): FlowChart {
  nodeCounter = 0;
  edgeCounter = 0;

  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];

  // 开始节点
  const startId = nextNodeId();
  nodes.push({
    id: startId,
    type: 'start',
    label: '开始分析',
    description: def.name || '分析入口',
    position: { x: 0, y: 0 },
  });

  const pending: PendingEdge[] = [{ source: startId }];

  // 处理所有步骤
  if (def.steps && def.steps.length > 0) {
    processSteps(def.steps, nodes, edges, pending);
  }

  // 结束节点
  const endId = nextNodeId();
  nodes.push({
    id: endId,
    type: 'end',
    label: '分析完成',
    description: '返回结果',
    position: { x: 0, y: 0 },
  });
  flushPending(pending, endId, edges);

  autoLayout(nodes, edges);
  return { nodes, edges };
}
