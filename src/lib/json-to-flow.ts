/**
 * JSON 工作流定义 → 流程图（FlowChart）
 *
 * 将 WorkflowDefinition 中的 steps 转换为 FlowNode/FlowEdge，
 * 用于 React Flow 可视化展示。
 */
import { FlowNode, FlowEdge, FlowChart } from './types';
import { WorkflowNode, WorkflowDefinition, ModuleName } from './workflow-schema';
import { dagreLayout } from './dagre-layout';

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

    const modulePrefix = getModulePrefix(step.module);
    const paramText   = summarizeParams(step);

    nodes.push({
      id: flowNodeId,
      type: nodeType,
      label: step.label || modulePrefix,
      description: step.description || paramText,
      conditionText,
      moduleType: modulePrefix,
      paramsSummary: buildParamsSummary(step),
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

      const hasTrueFalse = branchKeys.includes('true') || branchKeys.includes('是') || branchKeys.includes('false') || branchKeys.includes('否');
      if (hasTrueFalse) {
        // 条件分支：true/false
        const trueBranch = step.branches['true'] || step.branches['是'] || [];
        const falseBranch = step.branches['false'] || step.branches['否'] || [];

        if (trueBranch.length > 0) {
          const truePending: PendingEdge[] = [{ source: flowNodeId, label: 'true', type: 'true' }];
          processSteps(trueBranch, nodes, edges, truePending);
          pending.push(...truePending);
        } else {
          pending.push({ source: flowNodeId, label: 'true', type: 'true' });
        }

        if (falseBranch.length > 0) {
          const falsePending: PendingEdge[] = [{ source: flowNodeId, label: 'false', type: 'false' }];
          processSteps(falseBranch, nodes, edges, falsePending);
          pending.push(...falsePending);
        } else {
          pending.push({ source: flowNodeId, label: 'false', type: 'false' });
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

/** 按模块类型生成结构化参数摘要（显示在节点卡片上） */
function summarizeParams(node: WorkflowNode): string {
  const p = node.params || {};

  switch (node.module) {
    // ── 跳变检测 ──
    case 'detectTransition':
      if (p.signal !== undefined) {
        const from = p.from !== undefined ? p.from : '?';
        const to   = p.to   !== undefined ? p.to   : '?';
        return `${p.signal}: ${from} → ${to}`;
      }
      break;
    case 'detectMultiTransition':
      if (p.signals) {
        const count = Array.isArray(p.signals) ? p.signals.length : '?';
        return `${count}个信号跳变${p.logic ? `(${p.logic.toUpperCase()})` : ''}`;
      }
      break;
    case 'detectSequence':
      if (p.sequence) {
        const seq = Array.isArray(p.sequence)
          ? p.sequence.map((s: any) => `${s.signal}=${s.value}`).join(' → ')
          : String(p.sequence);
        return `序列: ${seq}`;
      }
      break;

    // ── 统计分析 ──
    case 'aggregate':
      if (p.signal) {
        return `${p.signal} → ${p.method || 'sum'}`;
      }
      break;
    case 'detectDuration':
      if (p.signal !== undefined) {
        const op  = p.operator || '>=';
        const dur = p.duration !== undefined ? `${p.duration}s` : '?';
        return `${p.signal} ${op} ${p.value ?? '?'}，持续 ${dur}`;
      }
      break;
    case 'countOccurrences':
      if (p.signal !== undefined) {
        const threshold = p.threshold !== undefined ? ` ≥ ${p.threshold}次` : '';
        return `${p.signal}${threshold}`;
      }
      break;
    case 'detectStable':
      if (p.signal !== undefined) {
        const dur = p.duration !== undefined ? `${p.duration}s` : '?';
        return `${p.signal} 稳定 ${dur}`;
      }
      break;
    case 'detectOscillation':
      if (p.signal !== undefined) {
        const times = p.times !== undefined ? ` ${p.times}次` : '';
        return `${p.signal} 抖动${times}`;
      }
      break;
    case 'computeRate':
      if (p.signal !== undefined) {
        return `Δ${p.signal}${p.window ? ` / ${p.window}s` : ''}`;
      }
      break;

    // ── 搜索 ──
    case 'findFirst':
    case 'findAll':
      if (p.signal !== undefined && p.operator !== undefined) {
        return `${p.signal} ${p.operator} ${p.value ?? '?'}`;
      }
      if (p.signal) return p.signal;
      break;

    // ── 比较 / 分组 ──
    case 'compareSignals':
      if (p.signalA && p.signalB) {
        return `${p.signalA} vs ${p.signalB}`;
      }
      break;
    case 'groupByState':
      if (p.signal) {
        return `按 ${p.signal} 分组`;
      }
      break;

    // ── 输出 ──
    case 'output':
      if (p.key) {
        return `结果键: ${p.key}`;
      }
      break;

    // ── 循环容器 ──
    case 'scanAll':
      return '遍历全部帧';
    case 'forEachEvent':
      return p.events ? `遍历: ${p.events}` : '遍历事件列表';
    case 'loopScan':
      return p.step ? `步长: ${p.step}帧` : '步进扫描';
    case 'slidingWindow':
      if (p.window || p.step) {
        return `窗口: ${p.window ?? '?'}, 步长: ${p.step ?? '?'}`;
      }
      break;

    // ── 条件 ──
    case 'checkValue':
    case 'condition':
      if (p.signal && p.operator !== undefined) {
        return `${p.signal} ${p.operator} ${p.value ?? '?'}`;
      }
      break;
    case 'checkMultiValues':
      if (p.conditions) {
        const logic = p.logic?.toUpperCase() || 'AND';
        return `${p.conditions.length}个条件 (${logic})`;
      }
      break;
    case 'checkTimeRange':
      if (p.start !== undefined || p.end !== undefined) {
        return `时间: ${p.start ?? '?'} ~ ${p.end ?? '?'}`;
      }
      break;
    case 'switchValue':
      if (p.signal) {
        return `分支信号: ${p.signal}`;
      }
      break;

    default:
      break;
  }

  // 通用兜底：最多展示 2 个关键字段
  if (p.signal) return p.signal;
  const entries = Object.entries(p).filter(([, v]) => v !== undefined && v !== null);
  return entries.slice(0, 2).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ');
}

/** 生成用于 Tooltip 的完整参数文本 */
function buildParamsSummary(node: WorkflowNode): string {
  const p = node.params;
  if (!p || Object.keys(p).length === 0) return '';
  return Object.entries(p)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join('\n');
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

  dagreLayout(nodes, edges);
  return { nodes, edges };
}
