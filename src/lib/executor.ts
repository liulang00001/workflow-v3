/**
 * 代码执行器：在受控环境中执行 LLM 生成的分析代码
 *
 * 策略：用 ts-morph 将 TypeScript 编译为 JavaScript，再通过 Function 构造器执行
 * 生产环境可升级为 quickjs-emscripten 沙箱
 */
import { DataTable, ExecutionResult, Finding } from './types';
import { Project, ScriptTarget, ModuleKind, SyntaxKind } from 'ts-morph';
import {
  scanAll, checkValue, checkMultiValues,
  detectTransition, detectMultiTransition,
  checkTimeRange, loopScan, switchValue, forEachEvent,
  aggregate, detectDuration, countOccurrences,
  findFirst, findAll,
  // V2.1 新增模块
  compareSignals, detectSequence, slidingWindow,
  detectStable, detectOscillation, computeRate, groupByState,
} from './standard-modules';

/** 将 DataTable 转为 SignalRow[] 格式供分析函数使用 */
function tableToSignalRows(table: DataTable): Record<string, any>[] {
  const timeColIdx = table.headers.findIndex(h => {
    const cleaned = h.replace(/[\r\n]+/g, '').trim();
    return cleaned.includes('时间') || cleaned.includes('time') || cleaned.includes('Time') || cleaned.includes('采集');
  });

  // 清理列名中的换行符和多余空格
  const cleanHeaders = table.headers.map(h => h.replace(/[\r\n]+/g, '').trim());

  return table.rows.map(row => {
    const obj: Record<string, any> = {};
    for (let i = 0; i < cleanHeaders.length; i++) {
      const header = cleanHeaders[i];
      let value = row[i];
      // 自动转数字
      if (typeof value === 'string') {
        const num = Number(value);
        if (!isNaN(num) && value.trim() !== '') value = num;
      }
      obj[header] = value;
      // 时间列特殊处理
      if (i === timeColIdx) obj['time'] = String(value);
    }
    // 确保有 time 字段
    if (!obj['time'] && timeColIdx >= 0) obj['time'] = String(row[timeColIdx]);
    if (!obj['time']) obj['time'] = `row_${table.rows.indexOf(row)}`;
    return obj;
  });
}

/** 用 ts-morph 将 TypeScript 编译为 JavaScript */
function compileTypeScript(code: string): string {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      target: ScriptTarget.ES2020,
      module: ModuleKind.None,
      strict: false,
      removeComments: false,
    },
  });

  const sourceFile = project.createSourceFile('analyze.ts', code);
  const emitOutput = sourceFile.getEmitOutput();
  const jsFile = emitOutput.getOutputFiles()[0];

  if (!jsFile) {
    throw new Error('TypeScript 编译失败：无输出');
  }

  return jsFile.getText()
    .replace(/^"use strict";\s*/gm, '')
    .replace(/^Object\.defineProperty\(exports.*\n?/gm, '')
    .replace(/^exports\.\w+\s*=.*\n?/gm, '')
    .replace(/^export\s+/gm, '');
}

/** 从 TypeScript 源码中提取所有顶层函数名 */
function extractFunctionNames(code: string): string[] {
  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile('_extract.ts', code);
  return sourceFile.getFunctions().map(f => f.getName()).filter((n): n is string => !!n);
}

/** 生成函数追踪包装代码（输出到 console.log） */
function buildTraceCode(funcNames: string[]): string {
  const helpers = funcNames.filter(n => n !== 'analyze');
  if (helpers.length === 0) return '';

  let code = `
var __callSeq = 0;
var __debuggedFns = {};
function __wrapTrace(name, fn) {
  return function() {
    var seq = ++__callSeq;
    var argsSummary = [];
    for (var i = 0; i < arguments.length; i++) {
      var a = arguments[i];
      if (a && typeof a === 'object' && a.time) argsSummary.push('row@' + a.time);
      else if (Array.isArray(a)) argsSummary.push('Array(' + a.length + ')');
      else argsSummary.push(typeof a === 'object' ? JSON.stringify(a).substring(0, 60) : String(a));
    }
    console.log('[TRACE #' + seq + '] >> ' + name + '(' + argsSummary.join(', ') + ')');

    // 前5次调用打印每个参数的所有字段值
    if (!__debuggedFns[name]) __debuggedFns[name] = 0;
    __debuggedFns[name]++;
    if (__debuggedFns[name] <= 5) {
      for (var i = 0; i < arguments.length; i++) {
        var a = arguments[i];
        if (a && typeof a === 'object' && !Array.isArray(a)) {
          var keys = Object.keys(a);
          var details = [];
          for (var k = 0; k < keys.length; k++) {
            var key = keys[k];
            var val = a[key];
            details.push(key + '=' + JSON.stringify(val));
          }
          console.log('[DEBUG #' + __debuggedFns[name] + '] ' + name + ' arg[' + i + ']: {' + details.join(', ') + '}');
        }
      }
    }

    var result = fn.apply(this, arguments);
    var resultStr = typeof result === 'object' && result !== null ? JSON.stringify(result).substring(0, 120) : String(result);
    console.log('[TRACE #' + seq + '] << ' + name + ' => ' + resultStr);
    return result;
  };
}
`;
  code += helpers.map(n => `${n} = __wrapTrace('${n}', ${n});`).join('\n');
  return code;
}

/**
 * 执行分析代码
 */
export function executeCode(code: string, table: DataTable): ExecutionResult {
  const startTime = Date.now();
  const report: string[] = [];  // 代码中 console.log 输出 → 分析报告
  const logs: string[] = [];    // 系统追踪日志
  const findings: Finding[] = [];

  try {
    const data = tableToSignalRows(table);
    const funcNames = extractFunctionNames(code);
    const cleanedCode = compileTypeScript(code);
    const traceCode = buildTraceCode(funcNames);

    logs.push(`[INFO] 数据行数: ${data.length}`);
    logs.push(`[INFO] 数据列名: ${table.headers.join(', ')}`);
    logs.push(`[INFO] 首行数据: ${JSON.stringify(data[0]).substring(0, 300)}`);
    logs.push(`[INFO] 检测到函数: ${funcNames.join(', ')}`);
    logs.push(`[INFO] 开始执行分析...`);

    // 构建可执行代码
    const execCode = `
      ${cleanedCode}
      ${traceCode}

      // 执行入口
      var __result = analyze(__data);
      __result;
    `;

    // 创建受控 console：区分报告输出和系统日志
    const safeConsole = {
      log: (...args: any[]) => {
        const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
        // 系统追踪前缀 → 归入 logs；用户代码输出 → 归入 report
        if (msg.startsWith('[TRACE') || msg.startsWith('[DEBUG') || msg.startsWith('[INFO]')) {
          logs.push(msg);
        } else {
          report.push(msg);
        }
      },
      warn: (...args: any[]) => {
        const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
        logs.push(`[WARN] ${msg}`);
      },
      error: (...args: any[]) => {
        const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
        logs.push(`[ERROR] ${msg}`);
      },
    };

    // 用 Function 构造器执行（受控作用域，注入标准模块）
    const fn = new Function(
      '__data', 'console', 'Math', 'JSON', 'Array', 'Object', 'Number', 'String', 'Boolean', 'Date', 'isNaN', 'parseInt', 'parseFloat', 'Infinity', 'NaN', 'undefined',
      // 标准模块注入
      'scanAll', 'checkValue', 'checkMultiValues',
      'detectTransition', 'detectMultiTransition',
      'checkTimeRange', 'loopScan', 'switchValue', 'forEachEvent',
      'aggregate', 'detectDuration', 'countOccurrences',
      'findFirst', 'findAll',
      // V2.1 新增模块
      'compareSignals', 'detectSequence', 'slidingWindow',
      'detectStable', 'detectOscillation', 'computeRate', 'groupByState',
      execCode
    );

    const result = fn(
      data, safeConsole, Math, JSON, Array, Object, Number, String, Boolean, Date, isNaN, parseInt, parseFloat, Infinity, NaN, undefined,
      // 标准模块函数
      scanAll, checkValue, checkMultiValues,
      detectTransition, detectMultiTransition,
      checkTimeRange, loopScan, switchValue, forEachEvent,
      aggregate, detectDuration, countOccurrences,
      findFirst, findAll,
      // V2.1 新增模块
      compareSignals, detectSequence, slidingWindow,
      detectStable, detectOscillation, computeRate, groupByState
    );

    const duration = Date.now() - startTime;

    if (result && result.findings) {
      findings.push(...result.findings);
    }

    // 生成时间轴
    const timeline = findings.map((f, i) => ({
      time: f.time || `#${i + 1}`,
      event: `[${f.type}] ${f.message}`,
      row: f.details?.row,
    }));

    return {
      success: true,
      findings,
      timeline,
      summary: result?.summary || `分析完成，发现 ${findings.length} 个事件`,
      duration,
      report,
      logs,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errMsg = error instanceof Error ? error.message : String(error);
    logs.push(`[FATAL] ${errMsg}`);

    return {
      success: false,
      findings: [{ time: '', type: 'error', message: `执行错误: ${errMsg}` }],
      timeline: [],
      summary: `执行失败: ${errMsg}`,
      duration,
      report,
      logs,
    };
  }
}
