'use client';

import { useCallback, useState } from 'react';
import { ExecutionResult } from '@/lib/types';
import { Download, ChevronDown, ChevronRight } from 'lucide-react';

interface ResultPanelProps {
  result: ExecutionResult;
  code?: string;
}

/** 生成调试日志文件内容 */
function buildDebugLog(result: ExecutionResult, code?: string): string {
  const lines: string[] = [];
  const now = new Date().toLocaleString('zh-CN');

  lines.push('='.repeat(60));
  lines.push(`  调试日志 - ${now}`);
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
  if (result.logs.length > 0) {
    for (const log of result.logs) lines.push(log);
  } else {
    lines.push('（无）');
  }
  lines.push('');

  if (result.timeline.length > 0) {
    lines.push('## 时间轴');
    for (const t of result.timeline) lines.push(`[${t.time}] ${t.event}`);
    lines.push('');
  }

  if (code) {
    lines.push('## 分析代码');
    lines.push('```typescript');
    lines.push(code);
    lines.push('```');
    lines.push('');
  }

  lines.push('='.repeat(60));
  return lines.join('\n');
}

export default function ResultPanel({ result, code }: ResultPanelProps) {
  const [showDebugLogs, setShowDebugLogs] = useState(false);

  const handleDownloadLog = useCallback(() => {
    const content = buildDebugLog(result, code);
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    a.href = url;
    a.download = `debug-log-${timestamp}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [result, code]);

  return (
    <div className="h-full overflow-auto p-4 space-y-4 text-sm">
      {/* 摘要 + 下载按钮 */}
      <div className={`p-3 rounded border-l-4 ${result.success ? 'bg-green-50 border-green-500 text-green-800' : 'bg-red-50 border-red-500 text-red-800'}`}>
        <div className="flex items-center justify-between">
          <div className="font-bold">{result.success ? '✅ 执行成功' : '❌ 执行失败'}</div>
          <button
            onClick={handleDownloadLog}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50 transition text-gray-700"
          >
            <Download size={12} />
            下载调试日志
          </button>
        </div>
        {/* 分析报告替换摘要文字 */}
        {result.report && result.report.length > 0 ? (
          <div className="mt-2 bg-white/60 rounded p-2 text-xs font-mono space-y-0.5 max-h-60 overflow-auto">
            {result.report.map((line, i) => (
              <div key={i} className="leading-relaxed">{line}</div>
            ))}
          </div>
        ) : (
          <div className="mt-1">{result.summary}</div>
        )}
        <div className="mt-1 text-xs opacity-70">耗时 {result.duration}ms</div>
      </div>

      {/* 发现列表 */}
      {result.findings.length > 0 && (
        <div>
          <h3 className="font-bold mb-2">分析发现 ({result.findings.length})</h3>
          <div className="space-y-1">
            {result.findings.map((f, i) => (
              <div key={i} className={`p-2 rounded text-xs border-l-2 ${
                f.type === 'success' ? 'bg-green-50 border-green-400' :
                f.type === 'warning' ? 'bg-amber-50 border-amber-400' :
                f.type === 'error' ? 'bg-red-50 border-red-400' :
                'bg-gray-50 border-gray-300'
              }`}>
                <div className="flex items-center gap-2">
                  <span>{f.type === 'success' ? '✅' : f.type === 'warning' ? '⚠️' : f.type === 'error' ? '❌' : 'ℹ️'}</span>
                  <span className="font-medium">{f.message}</span>
                </div>
                {f.time && <div className="mt-0.5 text-gray-500">时间: {f.time}</div>}
                {f.details && (
                  <div className="mt-0.5 text-gray-400">
                    {Object.entries(f.details).map(([k, v]) => `${k}=${v}`).join(', ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 时间轴 */}
      {result.timeline.length > 0 && (
        <div>
          <h3 className="font-bold mb-2">时间轴</h3>
          <div className="relative pl-4 border-l-2 border-gray-200 space-y-2">
            {result.timeline.map((t, i) => (
              <div key={i} className="relative text-xs">
                <div className="absolute -left-[21px] w-2.5 h-2.5 rounded-full bg-blue-400 border-2 border-white" />
                <div className="font-mono text-gray-500">{t.time}</div>
                <div>{t.event}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 系统调试日志（可折叠） */}
      {result.logs.length > 0 && (
        <div>
          <button
            onClick={() => setShowDebugLogs(!showDebugLogs)}
            className="flex items-center gap-1 font-bold mb-2 text-gray-500 hover:text-gray-700 transition"
          >
            {showDebugLogs ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            系统调试日志 ({result.logs.length})
          </button>
          {showDebugLogs && (
            <div className="bg-gray-900 text-green-400 rounded p-3 text-xs font-mono max-h-60 overflow-auto">
              {result.logs.map((log, i) => (
                <div key={i} className={
                  log.includes('[FATAL]') || log.includes('[ERROR]') ? 'text-red-400' :
                  log.includes('[WARN]') ? 'text-yellow-400' :
                  log.includes('[TRACE') ? 'text-cyan-400' :
                  log.includes('[DEBUG') ? 'text-purple-400' :
                  log.includes('[INFO]') ? 'text-blue-400' :
                  ''
                }>
                  {log}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
