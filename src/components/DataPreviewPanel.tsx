'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import {
  Table2, Hash, Type, Calendar, AlertTriangle, CheckCircle2,
  ChevronDown, ChevronRight, Search, ArrowUpDown, Pencil, Check, X, RotateCcw
} from 'lucide-react';
import { DataTable } from '@/lib/types';

// === 列类型检测 ===

type ColType = 'number' | 'integer' | 'float' | 'string' | 'time' | 'boolean' | 'empty' | 'mixed';

interface ColInfo {
  index: number;
  /** 原始表头 */
  rawHeader: string;
  /** 自动清理后的表头 */
  autoClean: string;
  /** 最终使用的表头（用户编辑 > 自动清理） */
  cleanHeader: string;
  /** 是否被格式化（有变化） */
  wasFormatted: boolean;
  /** 是否被用户手动编辑 */
  isUserEdited: boolean;
  /** 检测到的数据类型 */
  detectedType: ColType;
  /** 非空值数量 */
  nonEmpty: number;
  /** 空值数量 */
  emptyCount: number;
  /** 唯一值数量 */
  uniqueCount: number;
  /** 数值列的 min/max */
  min?: number;
  max?: number;
  /** 样本值 */
  samples: (string | number)[];
  /** 是否为时间列 */
  isTimeCol: boolean;
  /** 格式化建议/警告 */
  warnings: string[];
}

interface DataPreviewPanelProps {
  data: DataTable | null;
  /** 列名覆盖映射：index → 用户编辑后的列名 */
  headerOverrides: Record<number, string>;
  /** 修改某列的列名 */
  onHeaderRename: (index: number, newName: string) => void;
  /** 重置某列的列名为原始值 */
  onHeaderReset: (index: number) => void;
  /** 重置所有列名 */
  onHeaderResetAll: () => void;
}

/** 检测单个值的类型 */
function detectValueType(v: any): ColType {
  if (v === undefined || v === null || v === '' || v === 0 && typeof v === 'string') return 'empty';
  if (typeof v === 'number') {
    return Number.isInteger(v) ? 'integer' : 'float';
  }
  if (typeof v === 'boolean') return 'boolean';
  const s = String(v).trim();
  if (s === '') return 'empty';
  // 时间格式检测
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(s) || /^\d{1,2}:\d{2}(:\d{2})?/.test(s)) return 'time';
  // 数字检测
  const num = Number(s);
  if (!isNaN(num) && s !== '') return Number.isInteger(num) ? 'integer' : 'float';
  if (s === 'true' || s === 'false') return 'boolean';
  return 'string';
}

/** 合并多个类型为最终类型 */
function mergeTypes(types: ColType[]): ColType {
  const nonEmpty = types.filter(t => t !== 'empty');
  if (nonEmpty.length === 0) return 'empty';
  const unique = [...new Set(nonEmpty)];
  if (unique.length === 1) return unique[0];
  // integer + float → float → number
  if (unique.every(t => t === 'integer' || t === 'float')) return 'float';
  if (unique.every(t => t === 'integer' || t === 'float' || t === 'number')) return 'number';
  return 'mixed';
}

/** 类型图标 */
function TypeIcon({ type }: { type: ColType }) {
  switch (type) {
    case 'integer':
    case 'float':
    case 'number':
      return <Hash size={12} className="text-blue-500" />;
    case 'time':
      return <Calendar size={12} className="text-purple-500" />;
    case 'string':
      return <Type size={12} className="text-green-500" />;
    case 'boolean':
      return <CheckCircle2 size={12} className="text-amber-500" />;
    default:
      return <AlertTriangle size={12} className="text-gray-400" />;
  }
}

const TYPE_LABELS: Record<ColType, string> = {
  number: '数值',
  integer: '整数',
  float: '浮点数',
  string: '文本',
  time: '时间',
  boolean: '布尔',
  empty: '空',
  mixed: '混合',
};

/** 自动格式化表头：特殊映射 → 剔除中文 → 清理空白 */
export function formatHeader(raw: string): string {
  let h = raw.replace(/[\r\n]+/g, '').trim();

  // 特殊映射：含"采集时间"的列名 → time
  if (/采集时间/.test(h)) return 'time';

  // 剔除中文字符（保留英文、数字、下划线、点、中横线）
  h = h.replace(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g, '');

  // 清理多余空白和首尾特殊字符
  h = h.replace(/\s+/g, '_').replace(/^[_\-]+|[_\-]+$/g, '');

  return h || raw.replace(/[\r\n]+/g, '').trim(); // fallback：如果全是中文，保留原始清理值
}

export default function DataPreviewPanel({ data, headerOverrides, onHeaderRename, onHeaderReset, onHeaderResetAll }: DataPreviewPanelProps) {
  const [showAllCols, setShowAllCols] = useState(false);
  const [searchHeader, setSearchHeader] = useState('');
  const [previewRows, setPreviewRows] = useState(20);
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  /** 当前正在编辑的列 index，null 表示不在编辑 */
  const [editingCol, setEditingCol] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  // === 列分析 ===
  const colInfos: ColInfo[] = useMemo(() => {
    if (!data) return [];

    return data.headers.map((rawHeader, idx) => {
      const autoClean = formatHeader(rawHeader);
      // 用户编辑过的列名优先
      const cleanHeader = headerOverrides[idx] ?? autoClean;
      const wasFormatted = cleanHeader !== rawHeader;
      const isUserEdited = idx in headerOverrides;

      const isTimeCol = /时间|time|采集|timestamp/i.test(cleanHeader);

      const values = data.rows.map(row => row[idx]);
      const types = values.map(detectValueType);
      const detectedType = mergeTypes(types);

      const nonEmpty = types.filter(t => t !== 'empty').length;
      const emptyCount = types.filter(t => t === 'empty').length;
      const uniqueVals = new Set(values.map(v => String(v)));

      let min: number | undefined;
      let max: number | undefined;
      if (['integer', 'float', 'number'].includes(detectedType)) {
        const nums = values.filter(v => typeof v === 'number') as number[];
        if (nums.length > 0) {
          min = Math.min(...nums);
          max = Math.max(...nums);
        }
      }

      // 取前 3 个非空样本
      const samples = values.filter(v => v !== undefined && v !== null && v !== '' && v !== 0).slice(0, 3);

      const warnings: string[] = [];
      if (wasFormatted) warnings.push('表头含换行符，已自动清理');
      if (emptyCount > 0) warnings.push(`${emptyCount} 个空值 (${((emptyCount / data.rows.length) * 100).toFixed(1)}%)`);
      if (detectedType === 'mixed') warnings.push('列数据类型不一致，可能影响分析');

      return {
        index: idx,
        rawHeader,
        autoClean,
        cleanHeader,
        wasFormatted,
        isUserEdited,
        detectedType,
        nonEmpty,
        emptyCount,
        uniqueCount: uniqueVals.size,
        min,
        max,
        samples,
        isTimeCol,
        warnings,
      };
    });
  }, [data, headerOverrides]);

  // === 过滤列 ===
  const filteredCols = useMemo(() => {
    if (!searchHeader.trim()) return colInfos;
    const q = searchHeader.toLowerCase();
    return colInfos.filter(c => c.cleanHeader.toLowerCase().includes(q));
  }, [colInfos, searchHeader]);

  // === 排序数据预览 ===
  const sortedRows = useMemo(() => {
    if (!data) return [];
    const rows = [...data.rows];
    if (sortCol !== null) {
      rows.sort((a, b) => {
        const va = a[sortCol];
        const vb = b[sortCol];
        if (typeof va === 'number' && typeof vb === 'number') return sortAsc ? va - vb : vb - va;
        return sortAsc ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
      });
    }
    return rows.slice(0, previewRows);
  }, [data, sortCol, sortAsc, previewRows]);

  if (!data) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-[var(--muted)]">
        <Table2 size={48} className="mb-4 opacity-30" />
        <p className="text-sm">请先上传 Excel 数据文件</p>
        <p className="text-xs mt-1">支持 .xlsx / .xls / .csv 格式</p>
      </div>
    );
  }

  const warningCols = colInfos.filter(c => c.warnings.length > 0);
  const timeCol = colInfos.find(c => c.isTimeCol);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 头部统计 */}
      <div className="shrink-0 p-4 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Table2 size={18} className="text-[var(--accent)]" />
            <h2 className="font-bold text-sm">数据预览</h2>
            <span className="text-xs text-[var(--muted)] bg-[var(--bg-tertiary)] px-2 py-0.5 rounded">
              {data.fileName}
            </span>
          </div>
        </div>

        {/* 统计卡片 */}
        <div className="flex gap-4 text-xs">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 rounded border border-blue-100">
            <Hash size={12} className="text-blue-500" />
            <span className="text-blue-700 font-medium">{data.rows.length}</span> 行
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-50 rounded border border-purple-100">
            <Table2 size={12} className="text-purple-500" />
            <span className="text-purple-700 font-medium">{data.headers.length}</span> 列
          </div>
          {timeCol && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 rounded border border-green-100">
              <Calendar size={12} className="text-green-500" />
              时间列: <span className="text-green-700 font-medium">{timeCol.cleanHeader}</span>
            </div>
          )}
          {warningCols.length > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 rounded border border-amber-100">
              <AlertTriangle size={12} className="text-amber-500" />
              <span className="text-amber-700 font-medium">{warningCols.length}</span> 列有提示
            </div>
          )}
          {Object.keys(headerOverrides).length > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 rounded border border-blue-100">
              <Pencil size={12} className="text-blue-500" />
              <span className="text-blue-700 font-medium">{Object.keys(headerOverrides).length}</span> 列已编辑
              <button
                onClick={onHeaderResetAll}
                className="ml-1 text-[10px] text-blue-500 hover:text-blue-700 underline"
              >
                全部重置
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {/* 列信息表 */}
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold flex items-center gap-2">
              <Type size={14} /> 列信息 & 类型检测
            </h3>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                <input
                  value={searchHeader}
                  onChange={e => setSearchHeader(e.target.value)}
                  placeholder="搜索列名..."
                  className="pl-7 pr-2 py-1 text-xs border border-[var(--border)] rounded bg-transparent w-40"
                />
              </div>
              <button
                onClick={() => setShowAllCols(!showAllCols)}
                className="text-xs text-[var(--muted)] hover:text-[var(--accent)]"
              >
                {showAllCols ? '收起' : `展开全部 (${data.headers.length})`}
              </button>
            </div>
          </div>

          <div className="border border-[var(--border)] rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-[var(--bg-tertiary)] text-[var(--muted)]">
                  <th className="px-3 py-2 text-left w-8">#</th>
                  <th className="px-3 py-2 text-left">列名</th>
                  <th className="px-3 py-2 text-left w-20">类型</th>
                  <th className="px-3 py-2 text-right w-16">非空</th>
                  <th className="px-3 py-2 text-right w-16">唯一</th>
                  <th className="px-3 py-2 text-left">范围 / 样本</th>
                  <th className="px-3 py-2 text-left w-8"></th>
                </tr>
              </thead>
              <tbody>
                {(showAllCols ? filteredCols : filteredCols.slice(0, 15)).map(col => (
                  <tr
                    key={col.index}
                    className={`border-t border-[var(--border)] hover:bg-[var(--bg-secondary)] transition ${
                      col.warnings.length > 0 ? 'bg-amber-50/30' : ''
                    }`}
                  >
                    <td className="px-3 py-2 text-[var(--muted)]">{col.index + 1}</td>
                    <td className="px-3 py-2">
                      {editingCol === col.index ? (
                        /* 编辑模式 */
                        <div className="flex items-center gap-1">
                          <input
                            ref={editInputRef}
                            value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                if (editValue.trim() && editValue.trim() !== col.autoClean) {
                                  onHeaderRename(col.index, editValue.trim());
                                }
                                setEditingCol(null);
                              }
                              if (e.key === 'Escape') setEditingCol(null);
                            }}
                            className="flex-1 px-1.5 py-0.5 text-xs border border-[var(--accent)] rounded bg-white outline-none min-w-[80px]"
                            autoFocus
                          />
                          <button
                            onClick={() => {
                              if (editValue.trim() && editValue.trim() !== col.autoClean) {
                                onHeaderRename(col.index, editValue.trim());
                              }
                              setEditingCol(null);
                            }}
                            className="p-0.5 text-green-600 hover:text-green-700"
                          >
                            <Check size={12} />
                          </button>
                          <button
                            onClick={() => setEditingCol(null)}
                            className="p-0.5 text-gray-400 hover:text-gray-600"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ) : (
                        /* 展示模式 */
                        <div className="flex items-center gap-1.5 group/name">
                          <span className={`font-medium ${col.isUserEdited ? 'text-[var(--accent)]' : ''}`}>
                            {col.cleanHeader}
                          </span>
                          {col.isUserEdited && (
                            <span className="text-[10px] px-1 bg-blue-100 text-blue-600 rounded">已编辑</span>
                          )}
                          {col.wasFormatted && !col.isUserEdited && (
                            <span className="text-[10px] px-1 bg-amber-100 text-amber-600 rounded">已清理</span>
                          )}
                          {col.isTimeCol && (
                            <span className="text-[10px] px-1 bg-purple-100 text-purple-600 rounded">时间列</span>
                          )}
                          {/* 编辑按钮 */}
                          <button
                            onClick={() => {
                              setEditingCol(col.index);
                              setEditValue(col.cleanHeader);
                            }}
                            className="opacity-0 group-hover/name:opacity-100 p-0.5 text-[var(--muted)] hover:text-[var(--accent)] transition"
                          >
                            <Pencil size={10} />
                          </button>
                          {/* 重置按钮（仅用户编辑过时显示） */}
                          {col.isUserEdited && (
                            <button
                              onClick={() => onHeaderReset(col.index)}
                              className="opacity-0 group-hover/name:opacity-100 p-0.5 text-[var(--muted)] hover:text-amber-500 transition"
                              title={`重置为: ${col.autoClean}`}
                            >
                              <RotateCcw size={10} />
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <TypeIcon type={col.detectedType} />
                        <span>{TYPE_LABELS[col.detectedType]}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {col.nonEmpty}
                      {col.emptyCount > 0 && (
                        <span className="text-amber-500 ml-1">({col.emptyCount}空)</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">{col.uniqueCount}</td>
                    <td className="px-3 py-2 text-[var(--muted)]">
                      {col.min !== undefined && col.max !== undefined ? (
                        <span>{col.min} ~ {col.max}</span>
                      ) : (
                        <span className="truncate max-w-[200px] inline-block">
                          {col.samples.map(s => String(s)).join(', ')}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {col.warnings.length > 0 && (
                        <span title={col.warnings.join('\n')}>
                          <AlertTriangle size={12} className="text-amber-500" />
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!showAllCols && filteredCols.length > 15 && (
              <div className="text-center py-2 text-xs text-[var(--muted)] bg-[var(--bg-tertiary)] border-t border-[var(--border)]">
                还有 {filteredCols.length - 15} 列未显示，点击「展开全部」查看
              </div>
            )}
          </div>
        </div>

        {/* 数据预览表 */}
        <div className="p-4 pt-0">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold flex items-center gap-2">
              <Table2 size={14} /> 数据预览
            </h3>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-[var(--muted)]">显示行数:</span>
              {[10, 20, 50, 100].map(n => (
                <button
                  key={n}
                  onClick={() => setPreviewRows(n)}
                  className={`px-2 py-0.5 rounded ${previewRows === n ? 'bg-[var(--accent)] text-white' : 'bg-[var(--bg-tertiary)] text-[var(--muted)] hover:text-[var(--fg)]'}`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className="border border-[var(--border)] rounded-lg overflow-auto max-h-[400px]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10">
                <tr className="bg-[var(--bg-tertiary)] text-[var(--muted)]">
                  <th className="px-2 py-2 text-left w-10 sticky left-0 bg-[var(--bg-tertiary)]">#</th>
                  {data.headers.map((h, i) => {
                    const info = colInfos[i];
                    const clean = info?.cleanHeader || h.replace(/[\r\n]+/g, '').trim();
                    return (
                      <th
                        key={i}
                        className="px-2 py-2 text-left whitespace-nowrap cursor-pointer hover:text-[var(--accent)] select-none"
                        onClick={() => {
                          if (sortCol === i) setSortAsc(!sortAsc);
                          else { setSortCol(i); setSortAsc(true); }
                        }}
                      >
                        <div className="flex items-center gap-1">
                          {info && <TypeIcon type={info.detectedType} />}
                          <span className="truncate max-w-[120px]">{clean}</span>
                          {sortCol === i && (
                            <ArrowUpDown size={10} className="text-[var(--accent)]" />
                          )}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row, ri) => (
                  <tr key={ri} className="border-t border-[var(--border)] hover:bg-[var(--bg-secondary)] transition">
                    <td className="px-2 py-1.5 text-[var(--muted)] sticky left-0 bg-[var(--bg-primary)]">{ri + 1}</td>
                    {row.map((cell, ci) => (
                      <td key={ci} className="px-2 py-1.5 whitespace-nowrap max-w-[150px] truncate">
                        {cell === undefined || cell === null || cell === '' ? (
                          <span className="text-gray-300 italic">-</span>
                        ) : typeof cell === 'number' ? (
                          <span className="text-blue-600 font-mono">{cell}</span>
                        ) : (
                          <span>{String(cell)}</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-xs text-[var(--muted)] mt-2 text-center">
            显示前 {Math.min(previewRows, data.rows.length)} / {data.rows.length} 行
          </div>
        </div>
      </div>
    </div>
  );
}
