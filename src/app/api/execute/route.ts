/**
 * API: 执行分析代码
 */
import { NextRequest, NextResponse } from 'next/server';
import { executeCode } from '@/lib/executor';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { ExecutionResult } from '@/lib/types';

/** 将执行结果保存到 logs/ 目录 */
function saveDebugFiles(code: string, result: ExecutionResult) {
  try {
    const logsDir = join(process.cwd(), 'logs');
    mkdirSync(logsDir, { recursive: true });

    const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const prefix = `${ts}`;

    // 保存 TypeScript 代码
    writeFileSync(join(logsDir, `${prefix}.ts`), code, 'utf-8');

    // 保存调试日志
    const lines: string[] = [];
    lines.push('='.repeat(60));
    lines.push(`  调试日志 - ${new Date().toLocaleString('zh-CN')}`);
    lines.push('='.repeat(60));
    lines.push('');
    lines.push('## 执行概况');
    lines.push(`状态: ${result.success ? '成功' : '失败'}`);
    lines.push(`耗时: ${result.duration}ms`);
    lines.push(`摘要: ${result.summary}`);
    lines.push('');
    lines.push('## 分析报告');
    if (result.report && result.report.length > 0) {
      for (const line of result.report) lines.push(line);
    } else {
      lines.push('（无报告输出）');
    }
    lines.push('');
    lines.push('## 分析发现');
    if (result.findings.length === 0) {
      lines.push('（无）');
    } else {
      for (const f of result.findings) {
        const icon = f.type === 'success' ? '[OK]' : f.type === 'warning' ? '[WARN]' : f.type === 'error' ? '[ERR]' : '[INFO]';
        lines.push(`${icon} ${f.message}`);
        if (f.time) lines.push(`     时间: ${f.time}`);
        if (f.details) lines.push(`     详情: ${JSON.stringify(f.details)}`);
      }
    }
    lines.push('');
    lines.push('## 系统调试日志');
    for (const log of result.logs) {
      lines.push(log);
    }
    lines.push('');
    if (result.timeline.length > 0) {
      lines.push('## 时间轴');
      for (const t of result.timeline) {
        lines.push(`[${t.time}] ${t.event}`);
      }
      lines.push('');
    }
    lines.push('='.repeat(60));

    writeFileSync(join(logsDir, `${prefix}.log`), lines.join('\n'), 'utf-8');

    console.log(`[execute] Debug files saved: logs/${prefix}.ts, logs/${prefix}.log`);
  } catch (e) {
    console.error('[execute] Failed to save debug files:', e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { code, data } = await request.json();

    if (!code || !data) {
      return NextResponse.json({ success: false, error: '缺少代码或数据' });
    }

    console.log(`[execute] Running code (${code.length} chars) on ${data.rows.length} rows...`);
    const result = executeCode(code, data);
    console.log(`[execute] Done in ${result.duration}ms, ${result.findings.length} findings`);

    // 自动保存调试文件
    saveDebugFiles(code, result);

    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error('[execute] Error:', error);
    return NextResponse.json({
      success: false,
      error: `执行失败: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
