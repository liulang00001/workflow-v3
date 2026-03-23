/**
 * 标准模块库 — 预定义的可组合分析构建块
 *
 * 这些模块是 LLM 生成代码时必须遵循的标准模式。
 * 每个模块对应一种常见的信号分析操作，模块之间可自由组合、嵌套。
 *
 * 模块来源：基于 V1 的 8 种节点类型（find_event, check_signal, check_multi_signal,
 * scan_range, loop_scan, switch_branch, foreach, output）提炼为 TypeScript 函数模式。
 */

// ============================================================
// 类型定义
// ============================================================

export interface SignalRow {
  time: string;
  [signalName: string]: any;
}

export interface Finding {
  time: string;
  type: 'success' | 'warning' | 'info' | 'error';
  message: string;
  details?: Record<string, any>;
}

export interface AnalysisResult {
  findings: Finding[];
  summary: string;
}

/** 比较运算符 */
export type Operator = '==' | '!=' | '>' | '>=' | '<' | '<=' | 'in' | 'not_in';

/** 单条件定义 */
export interface Condition {
  signal: string;
  operator: Operator;
  value: any;
  transform?: 'abs';
}

// ============================================================
// 模块 1: 全数据扫描模块 (scanAll)
// 对应 V1 节点: find_event (threshold 模式)
// 用途: 逐行遍历全部数据，对每一行执行判断回调
// ============================================================

/**
 * 全数据扫描 — 逐行迭代，对每行执行回调判断
 * @param data 全部数据行
 * @param callback 每行回调，参数为 (当前行, 索引, 全部数据)
 *
 * 示例:
 *   scanAll(data, (row, i, allData) => {
 *     if (checkValue(row, 'BrkPdlDvrAppdPrs', '>=', 2500)) {
 *       findings.push({ time: row.time, type: 'info', message: '制动压力达标' });
 *     }
 *   });
 */
export function scanAll(
  data: SignalRow[],
  callback: (row: SignalRow, index: number, allData: SignalRow[]) => void
): void {
  for (let i = 0; i < data.length; i++) {
    callback(data[i], i, data);
  }
}

// ============================================================
// 模块 2: 单值判断模块 (checkValue)
// 对应 V1 节点: check_signal
// 用途: 判断单个信号在某一时刻是否满足条件
// ============================================================

/**
 * 单值判断 — 检查一个信号值是否满足条件
 * @param row 数据行
 * @param signal 信号名
 * @param operator 比较运算符
 * @param value 期望值（in/not_in 时为数组）
 * @param transform 值变换（如 'abs' 取绝对值）
 *
 * 支持的运算符: ==, !=, >, >=, <, <=, in, not_in
 * 支持的数据类型: number, string, boolean, null/undefined
 *
 * 示例:
 *   checkValue(row, 'TrShftLvrPos', 'in', [3, 4])
 *   checkValue(row, 'StrgWhlAng', '>', 90, 'abs')
 */
export function checkValue(
  row: SignalRow,
  signal: string,
  operator: Operator,
  value: any,
  transform?: 'abs'
): boolean {
  let actual = row[signal];
  if (actual === undefined || actual === null) return false;

  // 值变换
  if (transform === 'abs') actual = Math.abs(Number(actual));

  switch (operator) {
    case '==':  return actual == value;
    case '!=':  return actual != value;
    case '>':   return Number(actual) > Number(value);
    case '>=':  return Number(actual) >= Number(value);
    case '<':   return Number(actual) < Number(value);
    case '<=':  return Number(actual) <= Number(value);
    case 'in':  return Array.isArray(value) && value.includes(actual);
    case 'not_in': return Array.isArray(value) && !value.includes(actual);
    default:    return false;
  }
}

// ============================================================
// 模块 3: 多值判断模块 (checkMultiValues)
// 对应 V1 节点: check_multi_signal
// 用途: 在某一时刻同时检查多个信号，支持 AND/OR 逻辑
// ============================================================

/**
 * 多值判断 — 同时检查多个信号条件
 * @param row 数据行
 * @param conditions 条件数组
 * @param logic 逻辑组合方式 'and' | 'or'
 *
 * 示例:
 *   checkMultiValues(row, [
 *     { signal: 'BCMDrvrDetSts', operator: '==', value: 0 },
 *     { signal: 'EPTRdy', operator: '==', value: 0 }
 *   ], 'and')
 */
export function checkMultiValues(
  row: SignalRow,
  conditions: Condition[],
  logic: 'and' | 'or' = 'and'
): boolean {
  if (logic === 'and') {
    return conditions.every(c => checkValue(row, c.signal, c.operator, c.value, c.transform));
  } else {
    return conditions.some(c => checkValue(row, c.signal, c.operator, c.value, c.transform));
  }
}

// ============================================================
// 模块 4: 数据跳变模块 (detectTransition)
// 对应 V1 节点: find_event (transition 模式)
// 用途: 检测信号值从一个状态跳变到另一个状态
// ============================================================

/**
 * 数据跳变检测 — 识别信号值从 from 变为 to 的时刻
 * @param data 全部数据行
 * @param signal 信号名
 * @param from 跳变前的值，'*' 匹配任意值，'!0' 匹配非0值
 * @param to 跳变后的值
 * @param multiple 是否返回所有匹配（false 只返回第一个）
 * @param startIndex 扫描起始索引（默认 1），可限定时间窗口
 * @param endIndex 扫描结束索引（默认到末尾），可限定时间窗口
 * @returns 匹配行的索引数组
 *
 * from 支持:
 *   - 具体值 (0, 1, 2...): 精确匹配
 *   - '*': 匹配任意值（包括相同值，慎用）
 *   - '!0': 匹配非零值（推荐用于检测 非X→X 的跳变）
 *
 * 示例:
 *   // 检测门从开到关（非0→0）
 *   detectTransition(data, 'DrvrDoorOpenSts', '!0', 0)
 *
 *   // 检测具体跳变（1→0）
 *   detectTransition(data, 'EngRunSts', 1, 0)
 *
 *   // 找所有跳变事件
 *   detectTransition(data, 'GearPos', '*', 3, true)
 *
 *   // 在 8 秒时间窗口内检测跳变（从 eventIdx 到 eventIdx+8）
 *   detectTransition(data, 'Signal', 0, 1, false, eventIdx, eventIdx + 8)
 */
export function detectTransition(
  data: SignalRow[],
  signal: string,
  from: any,
  to: any,
  multiple: boolean = false,
  startIndex: number = 1,
  endIndex?: number
): number[] {
  const results: number[] = [];
  const start = Math.max(1, startIndex);
  const end = endIndex !== undefined ? Math.min(endIndex, data.length - 1) : data.length - 1;

  for (let i = start; i <= end; i++) {
    const prev = data[i - 1][signal];
    const curr = data[i][signal];

    // 检查 to 是否匹配
    if (curr != to) continue;

    // 检查 from 是否匹配
    let fromMatch = false;
    if (from === '*') {
      fromMatch = true;
    } else if (from === '!0') {
      fromMatch = prev != 0;
    } else {
      fromMatch = prev == from;
    }

    if (fromMatch) {
      results.push(i);
      if (!multiple) break;
    }
  }

  return results;
}

/**
 * 多信号跳变检测（OR 逻辑）— 任意一个信号发生跳变即匹配
 * @param data 全部数据行
 * @param transitions 跳变条件数组
 * @param contextConditions 上下文条件（跳变发生时其他信号需满足的条件）
 * @param multiple 是否返回所有匹配
 *
 * 示例:
 *   // 任意一扇门关闭，且此时所有门都已关闭
 *   detectMultiTransition(data,
 *     [
 *       { signal: 'DrvrDoorOpenSts', from: '!0', to: 0 },
 *       { signal: 'RLDoorOpenSts', from: '!0', to: 0 },
 *     ],
 *     [
 *       { signal: 'DrvrDoorOpenSts', operator: '==', value: 0 },
 *       { signal: 'RLDoorOpenSts', operator: '==', value: 0 },
 *     ]
 *   )
 */
export function detectMultiTransition(
  data: SignalRow[],
  transitions: { signal: string; from: any; to: any }[],
  contextConditions?: Condition[],
  multiple: boolean = false,
  startIndex: number = 1,
  endIndex?: number
): number[] {
  const results: number[] = [];
  const start = Math.max(1, startIndex);
  const end = endIndex !== undefined ? Math.min(endIndex, data.length - 1) : data.length - 1;

  for (let i = start; i <= end; i++) {
    // 任意一个信号发生跳变
    let anyTransition = false;
    for (const t of transitions) {
      const prev = data[i - 1][t.signal];
      const curr = data[i][t.signal];

      if (curr != t.to) continue;

      let fromMatch = false;
      if (t.from === '*') fromMatch = true;
      else if (t.from === '!0') fromMatch = prev != 0;
      else fromMatch = prev == t.from;

      if (fromMatch) { anyTransition = true; break; }
    }

    if (!anyTransition) continue;

    // 检查上下文条件
    if (contextConditions && contextConditions.length > 0) {
      if (!checkMultiValues(data[i], contextConditions, 'and')) continue;
    }

    results.push(i);
    if (!multiple) break;
  }

  return results;
}

// ============================================================
// 模块 5: 时间范围判断模块 (checkTimeRange)
// 对应 V1 节点: scan_range
// 用途: 在指定时间窗口内检查条件是否 always/ever/never 成立
// ============================================================

/**
 * 时间范围判断 — 在时间窗口内检查条件状态
 * @param data 全部数据行
 * @param refIndex 参考时刻（行索引）
 * @param offsetBefore 向前偏移行数（正数）
 * @param offsetAfter 向后偏移行数（正数）
 * @param mode 扫描模式: 'always'(始终成立), 'ever'(曾经成立), 'never'(从未成立)
 * @param condition 判断函数，对每行返回 true/false
 *
 * 示例:
 *   // 检查关门后 10 秒内是否始终保持门锁=1
 *   checkTimeRange(data, doorCloseIdx, 0, 10, 'always',
 *     (row) => checkValue(row, 'VehLckngSta', '==', 1)
 *   )
 *
 *   // 检查前 5 秒内是否曾经出现过异常
 *   checkTimeRange(data, eventIdx, 5, 0, 'ever',
 *     (row) => checkValue(row, 'ErrorFlag', '!=', 0)
 *   )
 */
export function checkTimeRange(
  data: SignalRow[],
  refIndex: number,
  offsetBefore: number,
  offsetAfter: number,
  mode: 'always' | 'ever' | 'never',
  condition: (row: SignalRow, index: number) => boolean
): boolean {
  const start = Math.max(0, refIndex - offsetBefore);
  const end = Math.min(data.length - 1, refIndex + offsetAfter);

  switch (mode) {
    case 'always':
      for (let i = start; i <= end; i++) {
        if (!condition(data[i], i)) return false;
      }
      return true;

    case 'ever':
      for (let i = start; i <= end; i++) {
        if (condition(data[i], i)) return true;
      }
      return false;

    case 'never':
      for (let i = start; i <= end; i++) {
        if (condition(data[i], i)) return false;
      }
      return true;
  }
}

// ============================================================
// 模块 6: 循环扫描模块 (loopScan)
// 对应 V1 节点: loop_scan
// 用途: 从某时刻起逐行推进，多个检查项可分别触发不同结果
// ============================================================

export interface LoopCheck {
  name: string;
  condition: (row: SignalRow, index: number) => boolean;
  /** true 表示条件满足时退出循环 */
  exitOnPass?: boolean;
  /** true 表示条件不满足时退出循环 */
  exitOnFail?: boolean;
}

export interface LoopScanResult {
  exitReason: 'pass' | 'fail' | 'timeout';
  exitCheckName: string;
  exitIndex: number;
}

/**
 * 循环扫描 — 从起点逐行推进，根据多个检查项决定退出
 * @param data 全部数据行
 * @param startIndex 起始行索引
 * @param maxRows 最大扫描行数（超时限制）
 * @param checks 检查项数组
 *
 * 示例:
 *   // 等待蓝牙定位，同时监控基础条件
 *   loopScan(data, eventIdx + 9, 600, [
 *     {
 *       name: '基础条件',
 *       condition: (row) => checkMultiValues(row, [
 *         { signal: 'DrvrDoorOpenSts', operator: '==', value: 0 },
 *         { signal: 'BCMDrvrDetSts', operator: '==', value: 0 }
 *       ], 'and'),
 *       exitOnFail: true   // 基础条件不满足时退出
 *     },
 *     {
 *       name: '蓝牙定位',
 *       condition: (row) => checkValue(row, 'DigKey1Loctn', 'in', [0,1,2]),
 *       exitOnPass: true   // 蓝牙定位成功时退出
 *     }
 *   ])
 */
export function loopScan(
  data: SignalRow[],
  startIndex: number,
  maxRows: number,
  checks: LoopCheck[]
): LoopScanResult {
  const endIndex = Math.min(data.length, startIndex + maxRows);

  for (let i = startIndex; i < endIndex; i++) {
    for (const check of checks) {
      const passed = check.condition(data[i], i);

      if (passed && check.exitOnPass) {
        return { exitReason: 'pass', exitCheckName: check.name, exitIndex: i };
      }
      if (!passed && check.exitOnFail) {
        return { exitReason: 'fail', exitCheckName: check.name, exitIndex: i };
      }
    }
  }

  return { exitReason: 'timeout', exitCheckName: 'timeout', exitIndex: endIndex - 1 };
}

// ============================================================
// 模块 7: 多路分支模块 (switchValue)
// 对应 V1 节点: switch_branch
// 用途: 根据信号值走不同的处理路径
// ============================================================

export interface SwitchCase<T> {
  values: any[];
  label?: string;
  handler: () => T;
}

/**
 * 多路分支 — 根据信号值选择不同处理逻辑
 * @param row 数据行
 * @param signal 信号名
 * @param cases 分支定义
 * @param defaultHandler 默认处理（无匹配时）
 *
 * 示例:
 *   switchValue(row, 'AutoHoldSysSts', [
 *     { values: [0], label: '未开启', handler: () => handleOff() },
 *     { values: [1], label: '正常',   handler: () => handleNormal() },
 *     { values: [2, 3], label: '异常', handler: () => handleError() }
 *   ], () => handleUnknown())
 */
export function switchValue<T>(
  row: SignalRow,
  signal: string,
  cases: SwitchCase<T>[],
  defaultHandler?: () => T
): T | undefined {
  const actual = row[signal];

  for (const c of cases) {
    if (c.values.includes(actual)) {
      return c.handler();
    }
  }

  return defaultHandler ? defaultHandler() : undefined;
}

// ============================================================
// 模块 8: 事件遍历模块 (forEachEvent)
// 对应 V1 节点: foreach
// 用途: 对收集到的事件索引数组逐个执行分析子流程
// ============================================================

/**
 * 事件遍历 — 对事件列表中的每个事件执行子流程
 * @param data 全部数据行
 * @param eventIndices 事件行索引数组（由 detectTransition 等模块产出）
 * @param callback 每个事件的处理回调
 *
 * 示例:
 *   const doorCloseEvents = detectTransition(data, 'DrvrDoorOpenSts', '!0', 0, true);
 *   forEachEvent(data, doorCloseEvents, (row, idx, eventNo) => {
 *     console.log(`[事件${eventNo}] 门关闭: ${row.time}`);
 *     // 嵌套其他模块进行分析...
 *   });
 */
export function forEachEvent(
  data: SignalRow[],
  eventIndices: number[],
  callback: (row: SignalRow, index: number, eventNumber: number) => void
): void {
  for (let e = 0; e < eventIndices.length; e++) {
    const idx = eventIndices[e];
    if (idx >= 0 && idx < data.length) {
      callback(data[idx], idx, e + 1);
    }
  }
}

// ============================================================
// 模块 9: 统计聚合模块 (aggregate)
// 扩展模块：计算时间窗口内的统计值
// ============================================================

export interface AggregateResult {
  min: number;
  max: number;
  avg: number;
  count: number;
  first: number;
  last: number;
}

/**
 * 统计聚合 — 计算时间窗口内某信号的统计值
 * @param data 全部数据行
 * @param signal 信号名
 * @param startIndex 起始行
 * @param endIndex 结束行
 *
 * 示例:
 *   // 计算事件前后 10 行的温度统计
 *   const stats = aggregate(data, 'CoolantTemp', eventIdx - 10, eventIdx + 10);
 *   if (stats.max > 100) { ... }
 */
export function aggregate(
  data: SignalRow[],
  signal: string,
  startIndex: number,
  endIndex: number
): AggregateResult {
  const start = Math.max(0, startIndex);
  const end = Math.min(data.length - 1, endIndex);

  let min = Infinity, max = -Infinity, sum = 0, count = 0;
  let first = NaN, last = NaN;

  for (let i = start; i <= end; i++) {
    const val = Number(data[i][signal]);
    if (isNaN(val)) continue;

    if (count === 0) first = val;
    last = val;
    min = Math.min(min, val);
    max = Math.max(max, val);
    sum += val;
    count++;
  }

  return {
    min: count > 0 ? min : 0,
    max: count > 0 ? max : 0,
    avg: count > 0 ? sum / count : 0,
    count,
    first,
    last,
  };
}

// ============================================================
// 模块 10: 持续状态检测模块 (detectDuration)
// 扩展模块：检测某条件持续满足了多少行（约等于秒数）
// ============================================================

export interface DurationResult {
  startIndex: number;
  endIndex: number;
  duration: number;  // 持续行数
}

/**
 * 持续状态检测 — 从某时刻开始，检测条件持续满足的时长
 * @param data 全部数据行
 * @param startIndex 起始行
 * @param condition 持续判断条件
 * @param maxRows 最大检测行数
 *
 * 示例:
 *   // 检测发动机运行持续了多久
 *   const dur = detectDuration(data, startIdx,
 *     (row) => checkValue(row, 'EngRunSts', '==', 1),
 *     3600
 *   );
 *   console.log(`发动机持续运行 ${dur.duration} 秒`);
 */
export function detectDuration(
  data: SignalRow[],
  startIndex: number,
  condition: (row: SignalRow, index: number) => boolean,
  maxRows: number = 1000
): DurationResult {
  const start = Math.max(0, startIndex);
  const end = Math.min(data.length, start + maxRows);

  for (let i = start; i < end; i++) {
    if (!condition(data[i], i)) {
      return { startIndex: start, endIndex: i - 1, duration: i - start };
    }
  }

  return { startIndex: start, endIndex: end - 1, duration: end - start };
}

// ============================================================
// 模块 11: 频率/计数检测模块 (countOccurrences)
// 扩展模块：统计某条件在窗口内触发的次数
// ============================================================

/**
 * 频率/计数检测 — 统计时间窗口内条件满足的次数
 * @param data 全部数据行
 * @param startIndex 起始行
 * @param endIndex 结束行
 * @param condition 判断条件
 *
 * 示例:
 *   // 统计 10 秒内刹车触发的次数
 *   const count = countOccurrences(data, idx, idx + 10,
 *     (row) => checkValue(row, 'BrkPdlDvrAppdPrs', '>=', 2500)
 *   );
 *   if (count >= 3) { findings.push({ ... message: '频繁刹车' }); }
 */
export function countOccurrences(
  data: SignalRow[],
  startIndex: number,
  endIndex: number,
  condition: (row: SignalRow, index: number) => boolean
): number {
  const start = Math.max(0, startIndex);
  const end = Math.min(data.length - 1, endIndex);
  let count = 0;

  for (let i = start; i <= end; i++) {
    if (condition(data[i], i)) count++;
  }

  return count;
}

// ============================================================
// 模块 12: 查找首个匹配模块 (findFirst)
// 便捷模块：在全数据中找到第一个满足条件的行
// ============================================================

/**
 * 查找首个匹配 — 找到第一个满足条件的行索引
 * @param data 全部数据行
 * @param condition 判断条件
 * @param startIndex 起始行（默认 0）
 * @returns 匹配行的索引，未找到返回 -1
 *
 * 示例:
 *   const idx = findFirst(data, (row) => checkValue(row, 'BrkPdlDvrAppdPrs', '>=', 2500));
 *   if (idx === -1) { console.log('未找到制动事件'); return; }
 */
export function findFirst(
  data: SignalRow[],
  condition: (row: SignalRow, index: number) => boolean,
  startIndex: number = 0
): number {
  for (let i = Math.max(0, startIndex); i < data.length; i++) {
    if (condition(data[i], i)) return i;
  }
  return -1;
}

/**
 * 查找所有匹配 — 找到所有满足条件的行索引
 * @param data 全部数据行
 * @param condition 判断条件
 * @param startIndex 起始行（默认 0）
 * @returns 所有匹配行的索引数组
 */
export function findAll(
  data: SignalRow[],
  condition: (row: SignalRow, index: number) => boolean,
  startIndex: number = 0
): number[] {
  const results: number[] = [];
  for (let i = Math.max(0, startIndex); i < data.length; i++) {
    if (condition(data[i], i)) results.push(i);
  }
  return results;
}

// ============================================================
// 模块 13: 信号间比较模块 (compareSignals)
// 用途: 比较同一行中两个信号的值关系
// ============================================================

/**
 * 信号间比较 — 比较同一行中两个信号的值
 * @param row 数据行
 * @param signalA 信号A名称
 * @param operator 比较运算符
 * @param signalB 信号B名称
 * @param offsetB 对信号B的值做偏移（如 offsetB=10 则比较 A op (B+10)）
 *
 * 示例:
 *   // 实际温度是否超过目标温度
 *   compareSignals(row, 'ActualTemp', '>', 'TargetTemp')
 *
 *   // 传感器A是否比传感器B大10以上
 *   compareSignals(row, 'SensorA', '>', 'SensorB', 10)
 */
export function compareSignals(
  row: SignalRow,
  signalA: string,
  operator: Operator,
  signalB: string,
  offsetB: number = 0
): boolean {
  const valA = row[signalA];
  const valB = row[signalB];
  if (valA === undefined || valA === null || valB === undefined || valB === null) return false;

  const numA = Number(valA);
  const numB = Number(valB) + offsetB;

  switch (operator) {
    case '==':  return numA == numB;
    case '!=':  return numA != numB;
    case '>':   return numA > numB;
    case '>=':  return numA >= numB;
    case '<':   return numA < numB;
    case '<=':  return numA <= numB;
    default:    return false;
  }
}

// ============================================================
// 模块 14: 序列事件检测模块 (detectSequence)
// 用途: 检测多个事件是否按特定顺序发生
// ============================================================

export interface SequenceStep {
  name: string;
  condition: (row: SignalRow, index: number) => boolean;
  /** 距上一步的最大行数间隔，超过则序列失败 */
  maxGap?: number;
}

export interface SequenceResult {
  matched: boolean;
  /** 每步匹配的行索引 */
  matchedIndices: number[];
  /** 哪一步失败了（0-based） */
  failedAtStep?: number;
}

/**
 * 序列事件检测 — 检测多个事件是否按特定顺序发生
 * @param data 全部数据行
 * @param steps 序列步骤定义
 * @param startIndex 起始搜索行（默认 0）
 *
 * 示例:
 *   // 检测"启动 → 预热完成 → 进入运行"的操作序列
 *   detectSequence(data, [
 *     { name: '启动', condition: (row) => checkValue(row, 'StartCmd', '==', 1) },
 *     { name: '预热完成', condition: (row) => checkValue(row, 'WarmUpDone', '==', 1), maxGap: 60 },
 *     { name: '运行', condition: (row) => checkValue(row, 'RunMode', '==', 1), maxGap: 10 }
 *   ])
 */
export function detectSequence(
  data: SignalRow[],
  steps: SequenceStep[],
  startIndex: number = 0
): SequenceResult {
  const matchedIndices: number[] = [];
  let searchFrom = Math.max(0, startIndex);

  for (let stepIdx = 0; stepIdx < steps.length; stepIdx++) {
    const step = steps[stepIdx];
    const maxSearchEnd = step.maxGap !== undefined && stepIdx > 0
      ? Math.min(data.length, searchFrom + step.maxGap)
      : data.length;

    let found = false;
    for (let i = searchFrom; i < maxSearchEnd; i++) {
      if (step.condition(data[i], i)) {
        matchedIndices.push(i);
        searchFrom = i + 1;
        found = true;
        break;
      }
    }

    if (!found) {
      return { matched: false, matchedIndices, failedAtStep: stepIdx };
    }
  }

  return { matched: true, matchedIndices };
}

// ============================================================
// 模块 15: 滑动窗口计算模块 (slidingWindow)
// 用途: 对数据进行滑动窗口遍历，在每个窗口内执行自定义计算
// ============================================================

export interface WindowResult {
  centerIndex: number;
  value: number;
}

/**
 * 滑动窗口计算 — 对数据进行滑动窗口遍历
 * @param data 全部数据行
 * @param windowSize 窗口大小（行数）
 * @param stepSize 步进大小（行数）
 * @param calculator 窗口计算函数，输入窗口内的数据行，返回计算值
 * @param startIndex 起始行（默认 0）
 * @param endIndex 结束行（默认 data.length - 1）
 *
 * 示例:
 *   // 10 行滑动平均
 *   slidingWindow(data, 10, 1, (win) => {
 *     const sum = win.reduce((s, r) => s + Number(r['Temperature'] || 0), 0);
 *     return sum / win.length;
 *   });
 */
export function slidingWindow(
  data: SignalRow[],
  windowSize: number,
  stepSize: number,
  calculator: (windowData: SignalRow[], startIndex: number) => number,
  startIndex: number = 0,
  endIndex?: number
): WindowResult[] {
  const results: WindowResult[] = [];
  const end = endIndex !== undefined ? Math.min(endIndex, data.length - 1) : data.length - 1;
  const start = Math.max(0, startIndex);

  for (let i = start; i + windowSize - 1 <= end; i += stepSize) {
    const windowData = data.slice(i, i + windowSize);
    const centerIdx = i + Math.floor(windowSize / 2);
    const value = calculator(windowData, i);
    results.push({ centerIndex: centerIdx, value });
  }

  return results;
}

// ============================================================
// 模块 16: 稳态检测模块 (detectStable)
// 用途: 检测信号是否在指定容差范围内保持稳定
// ============================================================

export interface StableResult {
  isStable: boolean;
  /** 稳定持续行数 */
  stableDuration: number;
  stableStartIndex: number;
  stableEndIndex: number;
  /** 稳态期间的平均值 */
  avgValue: number;
  /** 最大偏差 */
  maxDeviation: number;
}

/**
 * 稳态检测 — 检测信号是否在容差范围内保持稳定
 * @param data 全部数据行
 * @param signal 信号名
 * @param startIndex 起始行
 * @param tolerance 容差值（±tolerance 范围内视为稳定）
 * @param minDuration 最小稳定持续行数（达到才算稳定，默认 1）
 * @param maxRows 最大检测行数（默认 1000）
 *
 * 算法：以第一个有效值为基准，后续值在 ±tolerance 内即为稳定，
 * 一旦超出则重新选取基准。返回最长的稳定区间。
 *
 * 示例:
 *   // 检测温度是否在 ±2°C 范围内稳定至少 30 秒
 *   detectStable(data, 'Temperature', eventIdx, 2, 30, 300)
 */
export function detectStable(
  data: SignalRow[],
  signal: string,
  startIndex: number,
  tolerance: number,
  minDuration: number = 1,
  maxRows: number = 1000
): StableResult {
  const start = Math.max(0, startIndex);
  const end = Math.min(data.length, start + maxRows);

  let bestStart = start, bestEnd = start, bestDuration = 0;
  let curStart = start;
  let baseValue = NaN;
  let sum = 0, count = 0, maxDev = 0;
  let bestSum = 0, bestCount = 0, bestMaxDev = 0;

  for (let i = start; i < end; i++) {
    const val = Number(data[i][signal]);
    if (isNaN(val)) continue;

    if (isNaN(baseValue)) {
      baseValue = val;
      curStart = i;
      sum = val;
      count = 1;
      maxDev = 0;
      continue;
    }

    const deviation = Math.abs(val - baseValue);
    if (deviation <= tolerance) {
      sum += val;
      count++;
      maxDev = Math.max(maxDev, deviation);

      const duration = i - curStart + 1;
      if (duration > bestDuration) {
        bestDuration = duration;
        bestStart = curStart;
        bestEnd = i;
        bestSum = sum;
        bestCount = count;
        bestMaxDev = maxDev;
      }
    } else {
      // 重置基准
      baseValue = val;
      curStart = i;
      sum = val;
      count = 1;
      maxDev = 0;
    }
  }

  return {
    isStable: bestDuration >= minDuration,
    stableDuration: bestDuration,
    stableStartIndex: bestStart,
    stableEndIndex: bestEnd,
    avgValue: bestCount > 0 ? bestSum / bestCount : 0,
    maxDeviation: bestMaxDev,
  };
}

// ============================================================
// 模块 17: 信号抖动/震荡检测模块 (detectOscillation)
// 用途: 检测信号在时间窗口内是否出现频繁的来回跳变
// ============================================================

export interface OscillationResult {
  isOscillating: boolean;
  /** 值变化次数 */
  changeCount: number;
  /** 变化频率（次/行） */
  frequency: number;
  startIndex: number;
  endIndex: number;
}

/**
 * 信号抖动/震荡检测 — 检测信号是否频繁跳变
 * @param data 全部数据行
 * @param signal 信号名
 * @param startIndex 起始行
 * @param windowSize 检测窗口大小（行数）
 * @param minChanges 最少变化次数，超过则判定为抖动（默认 6）
 *
 * 示例:
 *   // 检测 30 秒窗口内继电器信号是否频繁跳变
 *   detectOscillation(data, 'RelayStatus', eventIdx, 30, 6)
 */
export function detectOscillation(
  data: SignalRow[],
  signal: string,
  startIndex: number,
  windowSize: number,
  minChanges: number = 6
): OscillationResult {
  const start = Math.max(0, startIndex);
  const end = Math.min(data.length - 1, start + windowSize - 1);
  let changeCount = 0;

  for (let i = start + 1; i <= end; i++) {
    const prev = data[i - 1][signal];
    const curr = data[i][signal];
    if (prev != curr) changeCount++;
  }

  const span = end - start;
  const frequency = span > 0 ? changeCount / span : 0;

  return {
    isOscillating: changeCount >= minChanges,
    changeCount,
    frequency,
    startIndex: start,
    endIndex: end,
  };
}

// ============================================================
// 模块 18: 变化率计算模块 (computeRate)
// 用途: 计算信号在相邻行之间的变化率（一阶差分）
// ============================================================

export interface RateResult {
  index: number;
  /** 变化率 = 当前值 - 上一行值 */
  rate: number;
}

/**
 * 变化率计算 — 计算信号的逐行变化率
 * @param data 全部数据行
 * @param signal 信号名
 * @param startIndex 起始行（默认 0）
 * @param endIndex 结束行（默认 data.length - 1）
 *
 * 返回从 startIndex+1 开始的每行变化率。
 *
 * 示例:
 *   // 找出温度急变的时刻（变化率绝对值 > 5）
 *   const rates = computeRate(data, 'Temperature');
 *   rates.filter(r => Math.abs(r.rate) > 5).forEach(r => { ... });
 */
export function computeRate(
  data: SignalRow[],
  signal: string,
  startIndex: number = 0,
  endIndex?: number
): RateResult[] {
  const results: RateResult[] = [];
  const start = Math.max(1, startIndex);  // 至少从第 1 行开始才能计算差分
  const end = endIndex !== undefined ? Math.min(endIndex, data.length - 1) : data.length - 1;

  for (let i = start; i <= end; i++) {
    const curr = Number(data[i][signal]);
    const prev = Number(data[i - 1][signal]);
    if (!isNaN(curr) && !isNaN(prev)) {
      results.push({ index: i, rate: curr - prev });
    }
  }

  return results;
}

// ============================================================
// 模块 19: 状态分组模块 (groupByState)
// 用途: 将连续相同状态值的行聚合为状态段
// ============================================================

export interface StateSegment {
  /** 状态值 */
  value: any;
  startIndex: number;
  endIndex: number;
  /** 持续行数 */
  duration: number;
}

/**
 * 状态分组 — 将连续相同状态的行聚合为段
 * @param data 全部数据行
 * @param signal 信号名
 * @param startIndex 起始行（默认 0）
 * @param endIndex 结束行（默认 data.length - 1）
 *
 * 示例:
 *   // 分析系统运行模式的切换历史
 *   const segments = groupByState(data, 'OperatingMode');
 *   segments.forEach(seg => {
 *     console.log(`模式 ${seg.value}: 持续 ${seg.duration} 秒`);
 *   });
 */
export function groupByState(
  data: SignalRow[],
  signal: string,
  startIndex: number = 0,
  endIndex?: number
): StateSegment[] {
  const segments: StateSegment[] = [];
  const start = Math.max(0, startIndex);
  const end = endIndex !== undefined ? Math.min(endIndex, data.length - 1) : data.length - 1;

  if (start > end) return segments;

  let currentValue = data[start][signal];
  let segStart = start;

  for (let i = start + 1; i <= end; i++) {
    const val = data[i][signal];
    if (val != currentValue) {
      segments.push({
        value: currentValue,
        startIndex: segStart,
        endIndex: i - 1,
        duration: i - segStart,
      });
      currentValue = val;
      segStart = i;
    }
  }

  // 最后一段
  segments.push({
    value: currentValue,
    startIndex: segStart,
    endIndex: end,
    duration: end - segStart + 1,
  });

  return segments;
}
