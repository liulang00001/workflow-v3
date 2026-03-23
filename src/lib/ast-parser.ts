/**
 * AST 解析器：TypeScript 代码 → 流程图
 *
 * 抽象策略（高可读性优先）：
 *   - 只为 控制流（if/for）和 辅助函数调用 生成节点
 *   - 跳过 console.log、简单赋值、变量声明等噪音语句
 *   - 无汇合节点、无"继续"占位节点 — 边直接连接到后续真实节点
 *   - 辅助函数折叠为单个 action 节点，点击可跳转源码
 */
import { Project, SyntaxKind, Node, FunctionDeclaration, IfStatement, ForStatement, Block } from 'ts-morph';
import { FlowNode, FlowEdge, FlowChart } from './types';

let nodeCounter = 0;
let edgeCounter = 0;

function nextNodeId() { return `node_${++nodeCounter}`; }
function nextEdgeId() { return `edge_${++edgeCounter}`; }

/**
 * "待连接"列表：记录需要连接到下一个真实节点的出口。
 * 每个条目 = { source, label?, type? }
 * 当 parseBlock 遇到下一个真实节点时，把所有 pending 都连上去。
 */
interface PendingEdge {
  source: string;
  label?: string;
  type?: 'true' | 'false' | 'next' | 'loop-back';
}

/** 从 TypeScript 代码解析出流程图 */
export function parseCodeToFlowChart(code: string): FlowChart {
  nodeCounter = 0;
  edgeCounter = 0;

  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile('analysis.ts', code);

  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];

  const functions = sourceFile.getFunctions();
  const analyzeFunc = functions.find(f => f.getName() === 'analyze');
  const helperFuncs = functions.filter(f => f.getName() !== 'analyze');

  const helperNames = new Set(helperFuncs.map(f => f.getName() || ''));

  if (analyzeFunc) {
    const startId = nextNodeId();
    nodes.push({
      id: startId,
      type: 'start',
      label: '开始分析',
      description: 'analyze() 入口',
      codeRange: { startLine: analyzeFunc.getStartLineNumber(), endLine: analyzeFunc.getStartLineNumber() },
      position: { x: 0, y: 0 },
    });

    const body = analyzeFunc.getBody();
    if (body && Node.isBlock(body)) {
      const pending: PendingEdge[] = [{ source: startId }];
      parseBlock(body, nodes, edges, helperNames, pending);

      const endId = nextNodeId();
      nodes.push({
        id: endId,
        type: 'end',
        label: '分析完成',
        description: '返回结果',
        codeRange: { startLine: analyzeFunc.getEndLineNumber(), endLine: analyzeFunc.getEndLineNumber() },
        position: { x: 0, y: 0 },
      });
      flushPending(pending, endId, edges);
    }
  }

  autoLayout(nodes, edges);
  return { nodes, edges };
}

/** 把所有待连接的边都连到 targetId */
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

// ==================== 判断语句是否"重要" ====================

function isSignificantStatement(text: string, helperNames: Set<string>): boolean {
  if (/^\s*console\.\w+\(/.test(text)) return false;
  if (/^(const|let|var)\s+\w+\s*=\s*\d/.test(text)) return false;
  if (/^(const|let|var)\s+\w+\s*=\s*(true|false|'|"|`)/.test(text)) return false;
  if (/^(const|let|var)\s+\w+\s*=\s*\[\]/.test(text)) return false;
  if (/^\w+\s*=\s*(true|false|\d+);?$/.test(text.trim())) return false;
  for (const name of helperNames) {
    if (text.includes(`${name}(`)) return true;
  }
  if (text.includes('findings.push')) return true;
  return false;
}

function findCalledHelper(text: string, helperNames: Set<string>): string | null {
  for (const name of helperNames) {
    if (text.includes(`${name}(`)) return name;
  }
  return null;
}

// ==================== 块解析（核心） ====================

/**
 * 解析代码块。
 * @param pending - 入参：需要连接到本块第一个节点的待连接边；出参：本块所有出口的待连接边
 */
function parseBlock(
  block: Block,
  nodes: FlowNode[],
  edges: FlowEdge[],
  helperNames: Set<string>,
  pending: PendingEdge[],
): void {
  for (const stmt of block.getStatements()) {
    const kind = stmt.getKind();

    if (kind === SyntaxKind.IfStatement) {
      parseIfStatement(stmt as IfStatement, nodes, edges, helperNames, pending);
    }
    else if (kind === SyntaxKind.ForStatement) {
      parseForStatement(stmt as ForStatement, nodes, edges, helperNames, pending);
    }
    else if (kind === SyntaxKind.ContinueStatement || kind === SyntaxKind.BreakStatement) {
      // 跳转语句：清空 pending，本分支到此为止（不连后续）
      pending.length = 0;
    }
    else if (kind === SyntaxKind.ReturnStatement) {
      const text = stmt.getText();
      if (text.includes('findings') || text.includes('summary')) {
        const retId = nextNodeId();
        nodes.push({
          id: retId,
          type: 'action',
          label: '汇总结果',
          description: '返回 findings 和 summary',
          codeRange: { startLine: stmt.getStartLineNumber(), endLine: stmt.getEndLineNumber() },
          position: { x: 0, y: 0 },
        });
        flushPending(pending, retId, edges);
        pending.push({ source: retId });
      }
      // return 之后的语句不会执行，但这里不清空 pending 因为要连到 end 节点
    }
    else {
      const text = stmt.getText();
      if (!isSignificantStatement(text, helperNames)) continue;

      const helper = findCalledHelper(text, helperNames);
      const label = helper
        ? `调用 ${helper}()`
        : text.includes('findings.push') ? '记录发现' : text.substring(0, 30);

      const actionId = nextNodeId();
      nodes.push({
        id: actionId,
        type: 'action',
        label,
        description: text.substring(0, 120),
        codeRange: { startLine: stmt.getStartLineNumber(), endLine: stmt.getEndLineNumber() },
        position: { x: 0, y: 0 },
      });
      flushPending(pending, actionId, edges);
      pending.push({ source: actionId });
    }
  }
}

// ==================== if 语句解析 ====================

function parseIfStatement(
  ifStmt: IfStatement,
  nodes: FlowNode[],
  edges: FlowEdge[],
  helperNames: Set<string>,
  pending: PendingEdge[],
): void {
  const condText = ifStmt.getExpression().getText();
  const condId = nextNodeId();

  nodes.push({
    id: condId,
    type: 'condition',
    label: summarizeCondition(condText, helperNames),
    description: condText,
    conditionText: condText.length > 60 ? condText.substring(0, 58) + '..' : condText,
    codeRange: { startLine: ifStmt.getStartLineNumber(), endLine: ifStmt.getEndLineNumber() },
    position: { x: 0, y: 0 },
  });
  flushPending(pending, condId, edges);

  const thenBlock = ifStmt.getThenStatement();
  const elseStmt = ifStmt.getElseStatement();

  // true 分支
  const truePending: PendingEdge[] = [{ source: condId, label: '是', type: 'true' }];
  if (Node.isBlock(thenBlock)) {
    parseBlock(thenBlock, nodes, edges, helperNames, truePending);
  }

  // false 分支
  const falsePending: PendingEdge[] = [{ source: condId, label: '否', type: 'false' }];
  if (elseStmt) {
    if (Node.isBlock(elseStmt)) {
      parseBlock(elseStmt, nodes, edges, helperNames, falsePending);
    } else if (Node.isIfStatement(elseStmt)) {
      parseIfStatement(elseStmt, nodes, edges, helperNames, falsePending);
    }
  }

  // 合并两个分支的出口到 pending，让后续节点自然连接
  pending.push(...truePending, ...falsePending);
}

// ==================== for 语句解析 ====================

function parseForStatement(
  forStmt: ForStatement,
  nodes: FlowNode[],
  edges: FlowEdge[],
  helperNames: Set<string>,
  pending: PendingEdge[],
): void {
  const initText = forStmt.getInitializer()?.getText() || '';
  const condText = forStmt.getCondition()?.getText() || '';

  const loopId = nextNodeId();
  nodes.push({
    id: loopId,
    type: 'loop',
    label: summarizeLoop(initText, condText),
    description: `for (${initText}; ${condText}; ...)`,
    conditionText: condText,
    codeRange: { startLine: forStmt.getStartLineNumber(), endLine: forStmt.getEndLineNumber() },
    position: { x: 0, y: 0 },
  });
  flushPending(pending, loopId, edges);

  // 循环体
  const body = forStmt.getStatement();
  if (Node.isBlock(body)) {
    const bodyPending: PendingEdge[] = [{ source: loopId }];
    parseBlock(body, nodes, edges, helperNames, bodyPending);
    // 循环体出口连回循环节点
    for (const p of bodyPending) {
      edges.push({
        id: nextEdgeId(),
        source: p.source,
        target: loopId,
        type: 'loop-back',
        label: '继续循环',
      });
    }
  }

  // 循环节点本身是出口
  pending.push({ source: loopId });
}

// ==================== 工具函数 ====================

function blockEndsWithJump(block: Block): boolean {
  const last = block.getStatements().at(-1);
  if (!last) return false;
  const kind = last.getKind();
  if (kind === SyntaxKind.ContinueStatement || kind === SyntaxKind.ReturnStatement || kind === SyntaxKind.BreakStatement) {
    return true;
  }
  if (kind === SyntaxKind.IfStatement) {
    const then = (last as IfStatement).getThenStatement();
    if (Node.isBlock(then)) return blockEndsWithJump(then);
  }
  return false;
}

/** 通用条件摘要 */
function summarizeCondition(condText: string, helperNames: Set<string>): string {
  for (const name of helperNames) {
    if (condText.includes(name)) {
      const negated = condText.includes(`!${name}`);
      const readable = camelToReadable(name);
      return negated ? `${readable}?（否）` : `${readable}?`;
    }
  }
  if (condText.includes('.passed')) return '条件是否通过?';
  if (condText.includes('===') || condText.includes('!==')) {
    const match = condText.match(/(\w+)\s*[!=]==?\s*(.+)/);
    if (match) return `${match[1]} == ${match[2].substring(0, 15)}?`;
  }
  if (condText.length > 35) return condText.substring(0, 33) + '..';
  return condText + '?';
}

/** 通用循环摘要 */
function summarizeLoop(initText: string, condText: string): string {
  if (condText.includes('data.length') || condText.includes('.length')) return '遍历数据行';
  const rangeMatch = condText.match(/<=?\s*(\d+)/);
  if (rangeMatch) return `循环 ${rangeMatch[1]} 次检查`;
  return `循环`;
}

/** 驼峰命名 → 可读中文标签 */
function camelToReadable(name: string): string {
  const stripped = name
    .replace(/^(check|is|has|can|should|get|find|scan|compute|calc)/, '')
    .replace(/([A-Z])/g, ' $1')
    .trim();
  if (!stripped) return name;
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

function extractFunctionSummary(fn: FunctionDeclaration): string {
  const jsDocs = fn.getJsDocs();
  if (jsDocs.length > 0) return jsDocs[0].getComment()?.toString() || fn.getName() || '';
  const body = fn.getBody();
  if (body && Node.isBlock(body)) {
    const first = body.getStatements()[0];
    if (first) return first.getText().substring(0, 60);
  }
  return fn.getName() || 'function';
}

// ==================== 自动布局 ====================

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
    node.position = { x: 250 + col * 220, y: 60 + level * 100 };
  }
}
