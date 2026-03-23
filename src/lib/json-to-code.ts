/**
 * JSON 工作流定义 → TypeScript 可执行代码
 *
 * 将 WorkflowDefinition 转换为可由 executor.ts 执行的 TypeScript analyze() 函数。
 * 生成的代码使用预注入的标准模块函数。
 */
import { WorkflowDefinition, WorkflowNode } from './workflow-schema';

/** 将工作流定义转换为 TypeScript 代码 */
export function workflowToCode(def: WorkflowDefinition): string {
  const lines: string[] = [];
  const indent = (level: number) => '  '.repeat(level);

  // 生成 analyze 函数
  lines.push(`function analyze(data: SignalRow[]): AnalysisResult {`);
  lines.push(`  const findings: Finding[] = [];`);
  // 提供默认 row 引用，防止行级模块在顶层调用时 row 未定义
  // 在 scanAll/forEachEvent 回调中会被局部 row 参数覆盖
  lines.push(`  let row: any = data[0];`);
  lines.push(`  let idx: number = 0;`);

  // 生成变量声明
  if (def.variables) {
    for (const v of def.variables) {
      if (v.name === 'findings' || v.name === 'row' || v.name === 'idx') continue;
      lines.push(`  let ${v.name}: ${v.type} = ${JSON.stringify(v.initial)};`);
    }
  }

  lines.push('');

  // 生成步骤代码
  for (const step of def.steps) {
    const stepLines = generateStepCode(step, 1);
    lines.push(...stepLines);
    lines.push('');
  }

  // 生成返回语句
  lines.push(`  const successCount = findings.filter(f => f.type === 'success').length;`);
  lines.push(`  const warningCount = findings.filter(f => f.type === 'warning').length;`);
  lines.push(`  const errorCount = findings.filter(f => f.type === 'error').length;`);
  lines.push(`  return {`);
  lines.push(`    findings,`);
  lines.push(`    summary: \`分析完成：\${findings.length}个发现（\${successCount}成功, \${warningCount}警告, \${errorCount}错误）\``);
  lines.push(`  };`);
  lines.push(`}`);

  return lines.join('\n');
}

/** 生成单个步骤的代码 */
function generateStepCode(step: WorkflowNode, level: number): string[] {
  const ind = '  '.repeat(level);
  const lines: string[] = [];
  const p = step.params || {};

  // 添加注释
  if (step.label) {
    lines.push(`${ind}// ${step.label}`);
  }

  switch (step.module) {
    case 'detectTransition':
      lines.push(...genDetectTransition(step, level));
      break;
    case 'detectMultiTransition':
      lines.push(...genDetectMultiTransition(step, level));
      break;
    case 'forEachEvent':
      lines.push(...genForEachEvent(step, level));
      break;
    case 'scanAll':
      lines.push(...genScanAll(step, level));
      break;
    case 'checkValue':
      lines.push(...genCheckValue(step, level));
      break;
    case 'checkMultiValues':
      lines.push(...genCheckMultiValues(step, level));
      break;
    case 'checkTimeRange':
      lines.push(...genCheckTimeRange(step, level));
      break;
    case 'loopScan':
      lines.push(...genLoopScan(step, level));
      break;
    case 'switchValue':
      lines.push(...genSwitchValue(step, level));
      break;
    case 'aggregate':
      lines.push(...genAggregate(step, level));
      break;
    case 'detectDuration':
      lines.push(...genDetectDuration(step, level));
      break;
    case 'countOccurrences':
      lines.push(...genCountOccurrences(step, level));
      break;
    case 'findFirst':
      lines.push(...genFindFirst(step, level));
      break;
    case 'findAll':
      lines.push(...genFindAll(step, level));
      break;
    case 'compareSignals':
      lines.push(...genCompareSignals(step, level));
      break;
    case 'detectSequence':
      lines.push(...genDetectSequence(step, level));
      break;
    case 'slidingWindow':
      lines.push(...genSlidingWindow(step, level));
      break;
    case 'detectStable':
      lines.push(...genDetectStable(step, level));
      break;
    case 'detectOscillation':
      lines.push(...genDetectOscillation(step, level));
      break;
    case 'computeRate':
      lines.push(...genComputeRate(step, level));
      break;
    case 'groupByState':
      lines.push(...genGroupByState(step, level));
      break;
    case 'condition':
      lines.push(...genCondition(step, level));
      break;
    case 'output':
      lines.push(...genOutput(step, level));
      break;
    default:
      lines.push(`${ind}// 未知模块: ${step.module}`);
  }

  return lines;
}

// ==================== 工具函数 ====================

function varName(stepId: string): string {
  return stepId.replace(/[^a-zA-Z0-9_]/g, '_');
}

/** 从 params 中的 condition/conditions 构建运行时条件代码字符串 */
function buildConditionCode(p: Record<string, any>): string {
  if (p.condition?.signal) {
    const transform = p.condition.transform ? `, ${JSON.stringify(p.condition.transform)}` : '';
    return `(row) => checkValue(row, ${JSON.stringify(p.condition.signal)}, ${JSON.stringify(p.condition.operator)}, ${JSON.stringify(p.condition.value)}${transform})`;
  }
  if (p.condition?.type === 'checkMultiValues') {
    return `(row) => checkMultiValues(row, ${JSON.stringify(p.condition.conditions)}, ${JSON.stringify(p.condition.logic || 'and')})`;
  }
  if (p.conditions) {
    return `(row) => checkMultiValues(row, ${JSON.stringify(p.conditions)}, ${JSON.stringify(p.logic || 'and')})`;
  }
  return `(row) => true`;
}

// ==================== 各模块代码生成器 ====================

function genDetectTransition(step: WorkflowNode, level: number): string[] {
  const ind = '  '.repeat(level);
  const p = step.params;
  const vn = varName(step.id);
  const lines: string[] = [];
  const multiple = p.multiple !== undefined ? p.multiple : true;

  // 支持可选的 startIndex/endIndex 范围参数
  const rangeArgs = [];
  if (p.startIndex !== undefined || p.endIndex !== undefined) {
    rangeArgs.push(p.startIndex !== undefined ? p.startIndex : '1');
    if (p.endIndex !== undefined) rangeArgs.push(p.endIndex);
  }
  const rangeStr = rangeArgs.length > 0 ? `, ${rangeArgs.join(', ')}` : '';

  lines.push(`${ind}const ${vn} = detectTransition(data, ${JSON.stringify(p.signal)}, ${JSON.stringify(p.from)}, ${JSON.stringify(p.to)}, ${multiple}${rangeStr});`);
  lines.push(`${ind}console.log(\`${step.label || '跳变检测'}: 检测到 \${${vn}.length} 个事件\`);`);

  // 如果有子节点，自动包裹 forEachEvent
  if (step.children && step.children.length > 0) {
    lines.push(`${ind}forEachEvent(data, ${vn}, (row, idx, eventNo) => {`);
    lines.push(`${ind}  console.log(\`[事件\${eventNo}] 时刻: \${row.time}\`);`);
    for (const child of step.children) {
      lines.push(...generateStepCode(child, level + 1));
    }
    lines.push(`${ind}});`);
  }

  // 如果有 branches（无 children），根据检测结果走 true/false 分支
  if (step.branches && (!step.children || step.children.length === 0)) {
    lines.push(`${ind}if (${vn}.length > 0) {`);
    lines.push(`${ind}  idx = ${vn}[0]; row = data[idx];`);
    const trueBranch = step.branches['true'] || step.branches['是'] || [];
    for (const child of trueBranch) {
      lines.push(...generateStepCode(child, level + 1));
    }
    const falseBranch = step.branches['false'] || step.branches['否'] || [];
    if (falseBranch.length > 0) {
      lines.push(`${ind}} else {`);
      for (const child of falseBranch) {
        lines.push(...generateStepCode(child, level + 1));
      }
    }
    lines.push(`${ind}}`);
  }

  return lines;
}

function genDetectMultiTransition(step: WorkflowNode, level: number): string[] {
  const ind = '  '.repeat(level);
  const p = step.params;
  const vn = varName(step.id);
  const lines: string[] = [];

  // 支持可选的 startIndex/endIndex 范围参数
  const multiRangeArgs = [];
  if (p.startIndex !== undefined || p.endIndex !== undefined) {
    multiRangeArgs.push(p.startIndex !== undefined ? p.startIndex : '1');
    if (p.endIndex !== undefined) multiRangeArgs.push(p.endIndex);
  }
  const multiRangeStr = multiRangeArgs.length > 0 ? `, ${multiRangeArgs.join(', ')}` : '';

  lines.push(`${ind}const ${vn} = detectMultiTransition(data, ${JSON.stringify(p.transitions)}, ${p.contextConditions ? JSON.stringify(p.contextConditions) : 'undefined'}, ${p.multiple !== false}${multiRangeStr});`);
  lines.push(`${ind}console.log(\`${step.label || '多信号跳变'}: 检测到 \${${vn}.length} 个事件\`);`);

  if (step.children && step.children.length > 0) {
    lines.push(`${ind}forEachEvent(data, ${vn}, (row, idx, eventNo) => {`);
    lines.push(`${ind}  console.log(\`[事件\${eventNo}] 时刻: \${row.time}\`);`);
    for (const child of step.children) {
      lines.push(...generateStepCode(child, level + 1));
    }
    lines.push(`${ind}});`);
  }

  // 如果有 branches（无 children），根据检测结果走 true/false 分支
  if (step.branches && (!step.children || step.children.length === 0)) {
    lines.push(`${ind}if (${vn}.length > 0) {`);
    lines.push(`${ind}  idx = ${vn}[0]; row = data[idx];`);
    const trueBranch = step.branches['true'] || step.branches['是'] || [];
    for (const child of trueBranch) {
      lines.push(...generateStepCode(child, level + 1));
    }
    const falseBranch = step.branches['false'] || step.branches['否'] || [];
    if (falseBranch.length > 0) {
      lines.push(`${ind}} else {`);
      for (const child of falseBranch) {
        lines.push(...generateStepCode(child, level + 1));
      }
    }
    lines.push(`${ind}}`);
  }

  return lines;
}

function genForEachEvent(step: WorkflowNode, level: number): string[] {
  const ind = '  '.repeat(level);
  const p = step.params;
  const lines: string[] = [];
  const eventsRef = p.eventsRef || p.events;

  if (typeof eventsRef === 'string') {
    // 引用之前步骤的结果变量
    lines.push(`${ind}forEachEvent(data, ${varName(eventsRef)}, (row, idx, eventNo) => {`);
  } else if (Array.isArray(eventsRef)) {
    lines.push(`${ind}forEachEvent(data, ${JSON.stringify(eventsRef)}, (row, idx, eventNo) => {`);
  } else {
    lines.push(`${ind}// forEachEvent: 需要事件索引数组`);
    return lines;
  }

  lines.push(`${ind}  console.log(\`[事件\${eventNo}] 时刻: \${row.time}\`);`);
  if (step.children) {
    for (const child of step.children) {
      lines.push(...generateStepCode(child, level + 1));
    }
  }
  lines.push(`${ind}});`);
  return lines;
}

function genScanAll(step: WorkflowNode, level: number): string[] {
  const ind = '  '.repeat(level);
  const lines: string[] = [];

  lines.push(`${ind}scanAll(data, (row, i, allData) => {`);
  if (step.children) {
    for (const child of step.children) {
      lines.push(...generateStepCode(child, level + 1));
    }
  }
  lines.push(`${ind}});`);
  return lines;
}

function genCheckValue(step: WorkflowNode, level: number): string[] {
  const ind = '  '.repeat(level);
  const p = step.params;
  const vn = varName(step.id);
  const lines: string[] = [];

  const transformArg = p.transform ? `, ${JSON.stringify(p.transform)}` : '';
  const rowRef = p.rowRef || 'row';

  if (step.branches) {
    lines.push(`${ind}if (checkValue(${rowRef}, ${JSON.stringify(p.signal)}, ${JSON.stringify(p.operator)}, ${JSON.stringify(p.value)}${transformArg})) {`);
    const trueBranch = step.branches['true'] || step.branches['是'] || [];
    for (const child of trueBranch) {
      lines.push(...generateStepCode(child, level + 1));
    }
    const falseBranch = step.branches['false'] || step.branches['否'] || [];
    if (falseBranch.length > 0) {
      lines.push(`${ind}} else {`);
      for (const child of falseBranch) {
        lines.push(...generateStepCode(child, level + 1));
      }
    }
    lines.push(`${ind}}`);
  } else {
    lines.push(`${ind}const ${vn} = checkValue(${rowRef}, ${JSON.stringify(p.signal)}, ${JSON.stringify(p.operator)}, ${JSON.stringify(p.value)}${transformArg});`);
  }

  return lines;
}

function genCheckMultiValues(step: WorkflowNode, level: number): string[] {
  const ind = '  '.repeat(level);
  const p = step.params;
  const vn = varName(step.id);
  const lines: string[] = [];
  const rowRef = p.rowRef || 'row';

  if (step.branches) {
    lines.push(`${ind}if (checkMultiValues(${rowRef}, ${JSON.stringify(p.conditions)}, ${JSON.stringify(p.logic || 'and')})) {`);
    const trueBranch = step.branches['true'] || step.branches['是'] || [];
    for (const child of trueBranch) {
      lines.push(...generateStepCode(child, level + 1));
    }
    const falseBranch = step.branches['false'] || step.branches['否'] || [];
    if (falseBranch.length > 0) {
      lines.push(`${ind}} else {`);
      for (const child of falseBranch) {
        lines.push(...generateStepCode(child, level + 1));
      }
    }
    lines.push(`${ind}}`);
  } else {
    lines.push(`${ind}const ${vn} = checkMultiValues(${rowRef}, ${JSON.stringify(p.conditions)}, ${JSON.stringify(p.logic || 'and')});`);
  }

  return lines;
}

function genCheckTimeRange(step: WorkflowNode, level: number): string[] {
  const ind = '  '.repeat(level);
  const p = step.params;
  const vn = varName(step.id);
  const lines: string[] = [];
  const refIndex = p.refIndex || 'idx';
  const mode = p.mode || 'always';

  // 构建内部条件
  let conditionCode: string;
  if (p.checkCondition) {
    const cc = p.checkCondition;
    if (cc.type === 'checkMultiValues') {
      conditionCode = `(r) => checkMultiValues(r, ${JSON.stringify(cc.conditions)}, ${JSON.stringify(cc.logic || 'and')})`;
    } else {
      const transform = cc.transform ? `, ${JSON.stringify(cc.transform)}` : '';
      conditionCode = `(r) => checkValue(r, ${JSON.stringify(cc.signal)}, ${JSON.stringify(cc.operator)}, ${JSON.stringify(cc.value)}${transform})`;
    }
  } else {
    conditionCode = `(r) => true`;
  }

  if (step.branches) {
    lines.push(`${ind}if (checkTimeRange(data, ${refIndex}, ${p.offsetBefore || 0}, ${p.offsetAfter || 0}, ${JSON.stringify(mode)}, ${conditionCode})) {`);
    const trueBranch = step.branches['true'] || step.branches['是'] || [];
    for (const child of trueBranch) {
      lines.push(...generateStepCode(child, level + 1));
    }
    const falseBranch = step.branches['false'] || step.branches['否'] || [];
    if (falseBranch.length > 0) {
      lines.push(`${ind}} else {`);
      for (const child of falseBranch) {
        lines.push(...generateStepCode(child, level + 1));
      }
    }
    lines.push(`${ind}}`);
  } else {
    lines.push(`${ind}const ${vn} = checkTimeRange(data, ${refIndex}, ${p.offsetBefore || 0}, ${p.offsetAfter || 0}, ${JSON.stringify(mode)}, ${conditionCode});`);
  }

  return lines;
}

function genLoopScan(step: WorkflowNode, level: number): string[] {
  const ind = '  '.repeat(level);
  const p = step.params;
  const vn = varName(step.id);
  const lines: string[] = [];
  const startIndex = p.startIndex || '0';
  const maxRows = p.maxRows || 600;

  // 构建 checks 数组
  if (p.checks && Array.isArray(p.checks)) {
    const checksCode = p.checks.map((check: any) => {
      let condCode: string;
      if (check.condition?.type === 'checkMultiValues') {
        condCode = `(row) => checkMultiValues(row, ${JSON.stringify(check.condition.conditions)}, ${JSON.stringify(check.condition.logic || 'and')})`;
      } else if (check.condition?.signal) {
        const transform = check.condition.transform ? `, ${JSON.stringify(check.condition.transform)}` : '';
        condCode = `(row) => checkValue(row, ${JSON.stringify(check.condition.signal)}, ${JSON.stringify(check.condition.operator)}, ${JSON.stringify(check.condition.value)}${transform})`;
      } else {
        condCode = `(row) => true`;
      }
      const exitOnPass = check.exitOnPass ? ', exitOnPass: true' : '';
      const exitOnFail = check.exitOnFail ? ', exitOnFail: true' : '';
      return `    { name: ${JSON.stringify(check.name)}, condition: ${condCode}${exitOnPass}${exitOnFail} }`;
    }).join(',\n');

    lines.push(`${ind}const ${vn} = loopScan(data, ${startIndex}, ${maxRows}, [`);
    lines.push(checksCode);
    lines.push(`${ind}]);`);
    lines.push(`${ind}console.log(\`循环扫描结果: \${${vn}.exitReason}, 检查项: \${${vn}.exitCheckName}, 行号: \${${vn}.exitIndex}\`);`);
  }

  // 处理结果的子节点
  if (step.children) {
    for (const child of step.children) {
      lines.push(...generateStepCode(child, level));
    }
  }

  return lines;
}

function genSwitchValue(step: WorkflowNode, level: number): string[] {
  const ind = '  '.repeat(level);
  const p = step.params;
  const lines: string[] = [];
  const rowRef = p.rowRef || 'row';

  if (step.branches) {
    const cases = Object.entries(step.branches).map(([key, branchSteps]) => {
      const values = key.split(',').map(v => {
        const n = Number(v.trim());
        return isNaN(n) ? JSON.stringify(v.trim()) : n;
      });
      const handlerLines: string[] = [];
      for (const child of branchSteps as WorkflowNode[]) {
        handlerLines.push(...generateStepCode(child, level + 2));
      }
      return `${ind}  { values: ${JSON.stringify(values)}, label: ${JSON.stringify(key)}, handler: () => {\n${handlerLines.join('\n')}\n${ind}  }}`;
    }).join(',\n');

    lines.push(`${ind}switchValue(${rowRef}, ${JSON.stringify(p.signal)}, [`);
    lines.push(cases);
    lines.push(`${ind}]);`);
  }

  return lines;
}

function genAggregate(step: WorkflowNode, level: number): string[] {
  const ind = '  '.repeat(level);
  const p = step.params;
  const vn = varName(step.id);
  const lines: string[] = [];

  lines.push(`${ind}const ${vn} = aggregate(data, ${JSON.stringify(p.signal)}, ${p.startIndex || 0}, ${p.endIndex || 'data.length - 1'});`);
  lines.push(`${ind}console.log(\`${step.label || '统计'}: min=\${${vn}.min}, max=\${${vn}.max}, avg=\${${vn}.avg.toFixed(2)}\`);`);

  if (step.children) {
    for (const child of step.children) {
      lines.push(...generateStepCode(child, level));
    }
  }

  return lines;
}

function genDetectDuration(step: WorkflowNode, level: number): string[] {
  const ind = '  '.repeat(level);
  const p = step.params;
  const vn = varName(step.id);
  const lines: string[] = [];
  const startIndex = p.startIndex || '0';
  const maxRows = p.maxRows || 3600;
  const condCode = buildConditionCode(p);

  lines.push(`${ind}const ${vn} = detectDuration(data, ${startIndex}, ${condCode}, ${maxRows});`);
  lines.push(`${ind}console.log(\`${step.label || '持续检测'}: 持续 \${${vn}.duration} 行\`);`);

  if (step.children) {
    for (const child of step.children) {
      lines.push(...generateStepCode(child, level));
    }
  }

  return lines;
}

function genCountOccurrences(step: WorkflowNode, level: number): string[] {
  const ind = '  '.repeat(level);
  const p = step.params;
  const vn = varName(step.id);
  const lines: string[] = [];
  const condCode = buildConditionCode(p);

  lines.push(`${ind}const ${vn} = countOccurrences(data, ${p.startIndex || 0}, ${p.endIndex || 'data.length - 1'}, ${condCode});`);
  lines.push(`${ind}console.log(\`${step.label || '计数'}: \${${vn}} 次\`);`);

  return lines;
}

function genFindFirst(step: WorkflowNode, level: number): string[] {
  const ind = '  '.repeat(level);
  const p = step.params;
  const vn = varName(step.id);
  const lines: string[] = [];
  const condCode = buildConditionCode(p);

  const startIdx = p.startIndex !== undefined ? `, ${p.startIndex}` : '';
  lines.push(`${ind}const ${vn} = findFirst(data, ${condCode}${startIdx});`);

  if (step.children && step.children.length > 0) {
    lines.push(`${ind}if (${vn} !== -1) {`);
    lines.push(`${ind}  row = data[${vn}]; idx = ${vn};`);
    lines.push(`${ind}  console.log(\`${step.label || '查找'}: 找到于行 \${${vn}}, 时刻 \${data[${vn}].time}\`);`);
    for (const child of step.children) {
      lines.push(...generateStepCode(child, level + 1));
    }
    lines.push(`${ind}} else {`);
    lines.push(`${ind}  console.log(\`${step.label || '查找'}: 未找到匹配\`);`);
    lines.push(`${ind}}`);
  } else {
    lines.push(`${ind}console.log(\`${step.label || '查找'}: \${${vn} !== -1 ? '找到于行 ' + ${vn} : '未找到'}\`);`);
  }

  return lines;
}

function genFindAll(step: WorkflowNode, level: number): string[] {
  const ind = '  '.repeat(level);
  const p = step.params;
  const vn = varName(step.id);
  const lines: string[] = [];
  const condCode = buildConditionCode(p);

  const startIdx = p.startIndex !== undefined ? `, ${p.startIndex}` : '';
  lines.push(`${ind}const ${vn} = findAll(data, ${condCode}${startIdx});`);
  lines.push(`${ind}console.log(\`${step.label || '查找全部'}: 找到 \${${vn}.length} 个匹配\`);`);

  if (step.children && step.children.length > 0) {
    lines.push(`${ind}forEachEvent(data, ${vn}, (row, idx, eventNo) => {`);
    for (const child of step.children) {
      lines.push(...generateStepCode(child, level + 1));
    }
    lines.push(`${ind}});`);
  }

  return lines;
}

function genCompareSignals(step: WorkflowNode, level: number): string[] {
  const ind = '  '.repeat(level);
  const p = step.params;
  const vn = varName(step.id);
  const rowRef = p.rowRef || 'row';
  const offsetArg = p.offsetB !== undefined ? `, ${p.offsetB}` : '';
  return [`${ind}const ${vn} = compareSignals(${rowRef}, ${JSON.stringify(p.signalA)}, ${JSON.stringify(p.operator)}, ${JSON.stringify(p.signalB)}${offsetArg});`];
}

function genDetectSequence(step: WorkflowNode, level: number): string[] {
  const ind = '  '.repeat(level);
  const p = step.params;
  const vn = varName(step.id);
  const lines: string[] = [];

  const stepsCode = (p.steps || []).map((s: any) => {
    let condCode: string;
    if (s.condition?.signal) {
      condCode = `(row) => checkValue(row, ${JSON.stringify(s.condition.signal)}, ${JSON.stringify(s.condition.operator)}, ${JSON.stringify(s.condition.value)})`;
    } else {
      condCode = `(row) => true`;
    }
    const maxGap = s.maxGap ? `, maxGap: ${s.maxGap}` : '';
    return `    { name: ${JSON.stringify(s.name)}, condition: ${condCode}${maxGap} }`;
  }).join(',\n');

  const startIdx = p.startIndex !== undefined ? `, ${p.startIndex}` : '';
  lines.push(`${ind}const ${vn} = detectSequence(data, [`);
  lines.push(stepsCode);
  lines.push(`${ind}]${startIdx});`);
  lines.push(`${ind}console.log(\`${step.label || '序列检测'}: \${${vn}.matched ? '匹配成功' : '匹配失败'}\`);`);

  if (step.children) {
    for (const child of step.children) {
      lines.push(...generateStepCode(child, level));
    }
  }

  return lines;
}

function genSlidingWindow(step: WorkflowNode, level: number): string[] {
  const ind = '  '.repeat(level);
  const p = step.params;
  const vn = varName(step.id);
  const lines: string[] = [];

  const calcCode = p.calculator || `(win) => {
    const sum = win.reduce((s, r) => s + Number(r[${JSON.stringify(p.signal || 'value')}] || 0), 0);
    return sum / win.length;
  }`;

  const startEnd = p.startIndex !== undefined ? `, ${p.startIndex}, ${p.endIndex || 'undefined'}` : '';
  lines.push(`${ind}const ${vn} = slidingWindow(data, ${p.windowSize || 10}, ${p.stepSize || 1}, ${calcCode}${startEnd});`);
  lines.push(`${ind}console.log(\`${step.label || '滑动窗口'}: 生成 \${${vn}.length} 个窗口结果\`);`);

  if (step.children) {
    for (const child of step.children) {
      lines.push(...generateStepCode(child, level));
    }
  }

  return lines;
}

function genDetectStable(step: WorkflowNode, level: number): string[] {
  const ind = '  '.repeat(level);
  const p = step.params;
  const vn = varName(step.id);
  const lines: string[] = [];

  const startIndex = p.startIndex || '0';
  const minDuration = p.minDuration !== undefined ? `, ${p.minDuration}` : '';
  const maxRows = p.maxRows !== undefined ? `, ${p.maxRows}` : '';

  lines.push(`${ind}const ${vn} = detectStable(data, ${JSON.stringify(p.signal)}, ${startIndex}, ${p.tolerance || 1}${minDuration}${maxRows});`);
  lines.push(`${ind}console.log(\`${step.label || '稳态检测'}: \${${vn}.isStable ? '稳定' : '不稳定'}, 持续 \${${vn}.stableDuration} 行\`);`);

  if (step.children) {
    for (const child of step.children) {
      lines.push(...generateStepCode(child, level));
    }
  }

  return lines;
}

function genDetectOscillation(step: WorkflowNode, level: number): string[] {
  const ind = '  '.repeat(level);
  const p = step.params;
  const vn = varName(step.id);
  const lines: string[] = [];

  const minChanges = p.minChanges !== undefined ? `, ${p.minChanges}` : '';
  lines.push(`${ind}const ${vn} = detectOscillation(data, ${JSON.stringify(p.signal)}, ${p.startIndex || 0}, ${p.windowSize || 30}${minChanges});`);
  lines.push(`${ind}console.log(\`${step.label || '抖动检测'}: \${${vn}.isOscillating ? '存在抖动' : '正常'}, 变化 \${${vn}.changeCount} 次\`);`);

  if (step.children) {
    for (const child of step.children) {
      lines.push(...generateStepCode(child, level));
    }
  }

  return lines;
}

function genComputeRate(step: WorkflowNode, level: number): string[] {
  const ind = '  '.repeat(level);
  const p = step.params;
  const vn = varName(step.id);
  const lines: string[] = [];

  const startEnd = p.startIndex !== undefined ? `, ${p.startIndex}, ${p.endIndex || 'data.length - 1'}` : '';
  lines.push(`${ind}const ${vn} = computeRate(data, ${JSON.stringify(p.signal)}${startEnd});`);
  lines.push(`${ind}console.log(\`${step.label || '变化率'}: 计算了 \${${vn}.length} 个变化率\`);`);

  if (step.children) {
    for (const child of step.children) {
      lines.push(...generateStepCode(child, level));
    }
  }

  return lines;
}

function genGroupByState(step: WorkflowNode, level: number): string[] {
  const ind = '  '.repeat(level);
  const p = step.params;
  const vn = varName(step.id);
  const lines: string[] = [];

  const startEnd = p.startIndex !== undefined ? `, ${p.startIndex}, ${p.endIndex || 'undefined'}` : '';
  lines.push(`${ind}const ${vn} = groupByState(data, ${JSON.stringify(p.signal)}${startEnd});`);
  lines.push(`${ind}console.log(\`${step.label || '状态分组'}: \${${vn}.length} 个状态段\`);`);

  if (step.children) {
    for (const child of step.children) {
      lines.push(...generateStepCode(child, level));
    }
  }

  return lines;
}

function genCondition(step: WorkflowNode, level: number): string[] {
  const ind = '  '.repeat(level);
  const lines: string[] = [];

  if (!step.condition && !step.params?.expression) {
    lines.push(`${ind}// condition: 缺少条件定义`);
    return lines;
  }

  let condExpr: string;
  if (step.params?.expression) {
    // 自定义表达式
    condExpr = step.params.expression;
  } else if (step.condition) {
    const c = step.condition;
    const transform = c.transform ? `, ${JSON.stringify(c.transform)}` : '';
    condExpr = `checkValue(row, ${JSON.stringify(c.signal)}, ${JSON.stringify(c.operator)}, ${JSON.stringify(c.value)}${transform})`;
  } else {
    condExpr = 'true';
  }

  if (step.branches) {
    lines.push(`${ind}if (${condExpr}) {`);
    const trueBranch = step.branches['true'] || step.branches['是'] || [];
    for (const child of trueBranch) {
      lines.push(...generateStepCode(child, level + 1));
    }
    const falseBranch = step.branches['false'] || step.branches['否'] || [];
    if (falseBranch.length > 0) {
      lines.push(`${ind}} else {`);
      for (const child of falseBranch) {
        lines.push(...generateStepCode(child, level + 1));
      }
    }
    lines.push(`${ind}}`);
  } else {
    lines.push(`${ind}const condResult = ${condExpr};`);
  }

  return lines;
}

function genOutput(step: WorkflowNode, level: number): string[] {
  const ind = '  '.repeat(level);
  const p = step.params;
  const lines: string[] = [];

  if (p.finding) {
    const f = p.finding;
    const time = f.time || '(typeof row !== "undefined" && row.time) || ""';
    const type = JSON.stringify(f.type || 'info');
    const message = f.message ? JSON.stringify(f.message) : '""';
    const details = f.details ? `, details: ${JSON.stringify(f.details)}` : '';
    lines.push(`${ind}findings.push({ time: ${time}, type: ${type}, message: ${message}${details} });`);
    lines.push(`${ind}console.log({ time: ${time}, type: ${type}, message: ${message}${details} });`);
  }
  if (p.log) {
    lines.push(`${ind}console.log(${JSON.stringify(p.log)});`);
  }
  if (p.template) {
    lines.push(`${ind}console.log(\`${p.template}\`);`);
  }

  return lines;
}
