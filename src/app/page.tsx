'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { FlowChart, DataTable, ExecutionResult } from '@/lib/types';
import { WorkflowDefinition } from '@/lib/workflow-schema';
import { workflowToFlowChart } from '@/lib/json-to-flow';
import ResultPanel from '@/components/ResultPanel';
import LineNumberedTextarea from '@/components/LineNumberedTextarea';
import DataPreviewPanel, { formatHeader } from '@/components/DataPreviewPanel';
import { FileUp, Play, Sparkles, Code2, GitBranch, Terminal, Save, Trash2, Table2, Braces, Check, X, ClipboardList, ShieldCheck, AlertTriangle, CheckCircle2, Info, XCircle, BookMarked, ChevronDown } from 'lucide-react';

interface SavedSkill {
  name: string;
  fileName: string;
  updatedAt: string;
  size: number;
  description: string;
}

interface SkillData {
  name: string;
  description: string;
  signalsDef: string;
  analyzeSteps: string;
  workflowDef: any;
  code: string;
  validationResult?: ValidationResult | null;
  savedAt: string;
}

// 动态加载避免 SSR 问题
const CodeEditor = dynamic(() => import('@/components/CodeEditor'), { ssr: false });
const FlowChartView = dynamic(() => import('@/components/FlowChart'), { ssr: false });
const MonacoEditor = dynamic(() => import('@monaco-editor/react').then(m => m.default), { ssr: false });

type Tab = 'logic' | 'flow' | 'data' | 'result' | 'code';

interface ValidationResult {
  signalCheck: { passed: boolean; issues: Array<{ signal: string; line?: number; message: string; suggestion?: string }> };
  logicCheck: { passed: boolean; issues: Array<{ step: string; line?: number; type: string; message: string }> };
  adaptabilityCheck: { passed: boolean; issues: Array<{ step: string; line?: number; type: string; message: string; suggestion?: string }> };
  summary: string;
  optimizedSteps?: string;
}

export default function Home() {
  // === 核心状态 ===
  const [workflowDef, setWorkflowDef] = useState<WorkflowDefinition | null>(null);
  const [code, setCode] = useState('');
  const [flowChart, setFlowChart] = useState<FlowChart | null>(null);
  const [data, setData] = useState<DataTable | null>(null);
  const [headerOverrides, setHeaderOverrides] = useState<Record<number, string>>({});
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [status, setStatus] = useState<'idle' | 'generating' | 'generating-code' | 'executing'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('logic');
  const [highlightRange, setHighlightRange] = useState<{ startLine: number; endLine: number } | null>(null);
  const [showCodeTab, setShowCodeTab] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // === JSON 编辑面板状态 ===
  const [showJsonPanel, setShowJsonPanel] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [jsonDirty, setJsonDirty] = useState(false);

  // === Skill 管理 ===
  const [savedSkills, setSavedSkills] = useState<SavedSkill[]>([]);
  const [skillSaveName, setSkillSaveName] = useState('');
  const [skillSaveDesc, setSkillSaveDesc] = useState('');
  const [showSkillSave, setShowSkillSave] = useState(false);
  const [showSkillList, setShowSkillList] = useState(false);
  const [activeSkillName, setActiveSkillName] = useState<string | null>(null);

  // === 逻辑描述与处理 ===
  const [signalsDef, setSignalsDef] = useState('');
  const [analyzeSteps, setAnalyzeSteps] = useState('');
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [validating, setValidating] = useState(false);

  // === 实时信号引用检查（不走大模型） ===
  // 1) 从信号清单解析出已定义的信号名集合
  const definedSignalNames = useMemo<Set<string>>(() => {
    const set = new Set<string>();
    if (!signalsDef.trim()) return set;
    for (const line of signalsDef.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const name = trimmed.split(/\s+/)[0];
      if (name) set.add(name);
    }
    return set;
  }, [signalsDef]);

  // 2) 实时扫描分析步骤中引用的信号，检查是否在信号清单中
  const realtimeSignalIssues = useMemo<Array<{ line: number; signal: string }>>(() => {
    if (definedSignalNames.size === 0 || !analyzeSteps.trim()) return [];
    const issues: Array<{ line: number; signal: string }> = [];
    const seen = new Set<string>(); // 避免同一信号重复报告

    // 收集所有已定义信号名，用于构建正则：精确匹配这些信号名的变体 or 类似模式
    // 策略：找所有看起来像信号名的词（大驼峰/含数字的标识符，至少3字符）
    // 然后检查它是否在已定义集合中
    const signalPattern = /\b([A-Z][a-zA-Z0-9]{2,})\b/g;

    const lines = analyzeSteps.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let match;
      signalPattern.lastIndex = 0;
      while ((match = signalPattern.exec(line)) !== null) {
        const word = match[1];
        // 跳过常见的非信号关键词
        if (/^(AND|OR|NOT|TRUE|FALSE|NULL|NaN|Infinity)$/i.test(word)) continue;
        // 只对看起来确实像信号名的词报告（至少有一个小写字母+一个大写字母 or 含数字）
        const looksLikeSignal = (/[a-z]/.test(word) && /[A-Z]/.test(word)) || /\d/.test(word);
        if (!looksLikeSignal) continue;
        // 如果在已定义信号集合中，跳过
        if (definedSignalNames.has(word)) continue;
        // 新发现的未定义信号
        const key = `${i + 1}:${word}`;
        if (!seen.has(key)) {
          seen.add(key);
          issues.push({ line: i + 1, signal: word });
        }
      }
    }
    return issues;
  }, [analyzeSteps, definedSignalNames]);

  // 实时信号错误的行号集合
  const realtimeSignalErrorLines = useMemo<Set<number>>(() => {
    return new Set(realtimeSignalIssues.map(i => i.line));
  }, [realtimeSignalIssues]);

  // 合并所有错误行号：实时信号检查 + LLM逻辑校验结果
  const errorLines = useMemo<Set<number>>(() => {
    const set = new Set<number>(realtimeSignalErrorLines);
    if (!validationResult) return set;
    // 逻辑完整性检查的问题行
    for (const issue of validationResult.logicCheck.issues) {
      if (issue.line) set.add(issue.line);
    }
    return set;
  }, [validationResult, realtimeSignalErrorLines]);

  // === 生成进度流 ===
  const [streamLog, setStreamLog] = useState<Array<{ type: 'progress' | 'token' | 'error'; text: string }>>([]);
  const streamLogRef = useRef<HTMLDivElement>(null);

  const loadSkillList = useCallback(async () => {
    try {
      const res = await fetch('/api/skills');
      const json = await res.json();
      if (json.success) setSavedSkills(json.skills);
    } catch {}
  }, []);

  useEffect(() => { loadSkillList(); }, [loadSkillList]);

  // === 逻辑校验 ===
  const handleValidateLogic = useCallback(async () => {
    if (!signalsDef.trim() && !analyzeSteps.trim()) return;
    setValidating(true);
    setValidationResult(null);
    setError(null);
    try {
      const res = await fetch('/api/validate-logic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signals: signalsDef, steps: analyzeSteps }),
      });
      const json = await res.json();
      if (json.success) {
        setValidationResult(json.result);
      } else {
        setError(json.error);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setValidating(false);
    }
  }, [signalsDef, analyzeSteps]);

  // === 解析信号清单 ===
  const parseSignals = useCallback(() => {
    if (!signalsDef.trim()) return [];
    return signalsDef.trim().split('\n').filter(l => l.trim() && !l.trim().startsWith('#')).map(line => {
      const parts = line.trim().split(/\s+/);
      const name = parts[0];
      const rest = parts.slice(1).join(' ');
      const valMatch = rest.match(/^(.+?)\s+([\d]+:.+)$/);
      if (valMatch) {
        const description = valMatch[1];
        const valPairs = valMatch[2].split(',').reduce((acc: Record<string, string>, pair: string) => {
          const [k, v] = pair.split(':');
          if (k !== undefined && v !== undefined) acc[k.trim()] = v.trim();
          return acc;
        }, {});
        return { name, description, values: valPairs };
      }
      return { name, description: rest };
    });
  }, [signalsDef]);

  // 当 workflowDef 变化时，同步 JSON 文本
  useEffect(() => {
    if (workflowDef) {
      setJsonText(JSON.stringify(workflowDef, null, 2));
      setJsonDirty(false);
      setJsonError(null);
    }
  }, [workflowDef]);

  // 流日志自动滚动到底部
  useEffect(() => {
    if (streamLogRef.current) {
      streamLogRef.current.scrollTop = streamLogRef.current.scrollHeight;
    }
  }, [streamLog]);

  // === Skill 保存 ===
  const handleSaveSkill = useCallback(async () => {
    if (!skillSaveName.trim()) return;
    try {
      const res = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: skillSaveName.trim(),
          description: skillSaveDesc.trim(),
          signalsDef,
          analyzeSteps,
          workflowDef,
          code,
          validationResult,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setShowSkillSave(false);
        setSkillSaveName('');
        setSkillSaveDesc('');
        setActiveSkillName(json.name);
        loadSkillList();
      } else {
        setError(json.error);
      }
    } catch (e) {
      setError(String(e));
    }
  }, [skillSaveName, skillSaveDesc, signalsDef, analyzeSteps, workflowDef, code, validationResult, loadSkillList]);

  // === Skill 加载 ===
  const handleLoadSkill = useCallback(async (name: string) => {
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(name)}`);
      const json = await res.json();
      if (json.success) {
        const skill: SkillData = json.skill;
        setSignalsDef(skill.signalsDef || '');
        setAnalyzeSteps(skill.analyzeSteps || '');
        if (skill.workflowDef) {
          setWorkflowDef(skill.workflowDef);
          const chart = workflowToFlowChart(skill.workflowDef);
          setFlowChart(chart);
        } else {
          setWorkflowDef(null);
          setFlowChart(null);
        }
        setCode(skill.code || '');
        if (skill.code) setShowCodeTab(true);
        setValidationResult(skill.validationResult || null);
        setActiveSkillName(name);
        setShowSkillList(false);
        setResult(null);
        setActiveTab('logic');
      } else {
        setError(json.error);
      }
    } catch (e) {
      setError(String(e));
    }
  }, []);

  // === Skill 删除 ===
  const handleDeleteSkill = useCallback(async (name: string) => {
    try {
      const res = await fetch('/api/skills', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const json = await res.json();
      if (json.success) {
        if (activeSkillName === name) setActiveSkillName(null);
        loadSkillList();
      }
    } catch {}
  }, [activeSkillName, loadSkillList]);

  // === 步骤 1: 自然语言 → JSON 工作流定义 → 流程图（SSE 流式） ===
  const handleGenerate = useCallback(async () => {
    if (!analyzeSteps.trim()) return;

    setStatus('generating');
    setError(null);
    setStreamLog([]);
    setFlowChart(null);
    setWorkflowDef(null);
    setCode('');
    setActiveTab('flow');

    const parsedSignals = parseSignals();

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: analyzeSteps, signals: parsedSignals }),
      });

      if (!res.body) throw new Error('不支持流式响应');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let wfDef: WorkflowDefinition | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() ?? '';

        for (const block of blocks) {
          const line = block.trim();
          if (!line.startsWith('data:')) continue;
          const raw = line.slice(5).trim();
          try {
            const msg = JSON.parse(raw);
            if (msg.type === 'progress') {
              setStreamLog(prev => [...prev, { type: 'progress', text: msg.message }]);
            } else if (msg.type === 'token') {
              setStreamLog(prev => {
                const last = prev[prev.length - 1];
                if (last?.type === 'token') {
                  return [...prev.slice(0, -1), { type: 'token', text: last.text + msg.content }];
                }
                return [...prev, { type: 'token', text: msg.content }];
              });
            } else if (msg.type === 'error') {
              throw new Error(msg.error);
            } else if (msg.type === 'done') {
              wfDef = msg.workflowDef;
            }
          } catch (parseErr) {
            if (parseErr instanceof SyntaxError) continue;
            throw parseErr;
          }
        }
      }

      if (!wfDef) throw new Error('未收到工作流定义');

      setWorkflowDef(wfDef);
      const chart = workflowToFlowChart(wfDef);
      setFlowChart(chart);

      // 自动生成 TS 代码
      setStatus('generating-code');
      setStreamLog(prev => [...prev, { type: 'progress', text: '正在生成 TypeScript 代码...' }]);

      const codeRes = await fetch('/api/generate-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowDef: wfDef }),
      });
      const codeJson = await codeRes.json();
      if (codeJson.success) {
        setCode(codeJson.code);
        setStreamLog(prev => [...prev, { type: 'progress', text: `✓ 全部完成，代码 ${codeJson.code.length} 字符` }]);
      } else {
        setError(`代码生成失败: ${codeJson.error}`);
      }
    } catch (e) {
      setError(String(e));
      setStreamLog(prev => [...prev, { type: 'error', text: String(e) }]);
    } finally {
      setStatus('idle');
    }
  }, [analyzeSteps, parseSignals]);

  // === JSON 编辑 → 应用更改 ===
  const handleJsonChange = useCallback((value: string | undefined) => {
    const text = value || '';
    setJsonText(text);
    setJsonDirty(true);
    try {
      JSON.parse(text);
      setJsonError(null);
    } catch (e) {
      setJsonError(String(e).replace('SyntaxError: ', ''));
    }
  }, []);

  const handleApplyJson = useCallback(async () => {
    try {
      const parsed = JSON.parse(jsonText) as WorkflowDefinition;
      if (!parsed.steps || !Array.isArray(parsed.steps)) {
        setJsonError('JSON 必须包含 steps 数组');
        return;
      }
      setWorkflowDef(parsed);
      setJsonDirty(false);
      setJsonError(null);
      const chart = workflowToFlowChart(parsed);
      setFlowChart(chart);
      setCode('');
      const codeRes = await fetch('/api/generate-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowDef: parsed }),
      });
      const codeJson = await codeRes.json();
      if (codeJson.success) {
        setCode(codeJson.code);
      } else {
        setJsonError(`代码生成失败: ${codeJson.error}`);
      }
      setResult(null);
    } catch (e) {
      setJsonError(String(e).replace('SyntaxError: ', ''));
    }
  }, [jsonText]);

  const handleRevertJson = useCallback(() => {
    if (workflowDef) {
      setJsonText(JSON.stringify(workflowDef, null, 2));
      setJsonDirty(false);
      setJsonError(null);
    }
  }, [workflowDef]);


  // === 文件上传 ===
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const XLSX = await import('xlsx');
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

    if (raw.length < 2) {
      setError('Excel 文件至少需要 2 行（标题 + 数据）');
      return;
    }

    const headers = raw[0].map((h: any) => String(h).replace(/[\r\n]+/g, '').trim());
    const rows = raw.slice(1).map(row =>
      headers.map((_, i) => {
        const v = row[i];
        if (v === undefined || v === null) return 0;
        const num = Number(v);
        return isNaN(num) ? v : num;
      })
    );

    setData({ headers, rows, fileName: file.name });
    setHeaderOverrides({});
    setResult(null);
    setError(null);
    setActiveTab('data');

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const getEffectiveData = useCallback((): DataTable | null => {
    if (!data) return null;
    const effectiveHeaders = data.headers.map((h, i) => {
      if (i in headerOverrides) return headerOverrides[i];
      return formatHeader(h);
    });
    return { ...data, headers: effectiveHeaders };
  }, [data, headerOverrides]);

  // === 执行代码 ===
  const handleExecute = useCallback(async () => {
    if (!data) {
      setError('请先上传数据');
      return;
    }

    if (!code.trim() && workflowDef) {
      setStatus('generating-code');
      try {
        const codeRes = await fetch('/api/generate-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workflowDef }),
        });
        const codeJson = await codeRes.json();
        if (!codeJson.success) throw new Error(codeJson.error);
        setCode(codeJson.code);
      } catch (e) {
        setError(String(e));
        setStatus('idle');
        return;
      }
    }

    if (!code.trim()) {
      setError('需要先生成工作流');
      return;
    }

    setStatus('executing');
    setError(null);

    const effectiveData = getEffectiveData();
    try {
      const res = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, data: effectiveData }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);

      setResult(json.result);
      setActiveTab('result');
    } catch (e) {
      setError(String(e));
    } finally {
      setStatus('idle');
    }
  }, [code, data, workflowDef, getEffectiveData]);

  // === 流程图节点点击 ===
  const handleNodeClick = useCallback((nodeId: string, codeRange?: { startLine: number; endLine: number }) => {
    if (codeRange) {
      setHighlightRange(codeRange);
      setShowCodeTab(true);
      setActiveTab('code');
    }
  }, []);

  // === 代码编辑 ===
  const handleCodeChange = useCallback((newCode: string) => {
    setCode(newCode);
  }, []);

  const isGenerating = status === 'generating' || status === 'generating-code';

  const signalCount = signalsDef.trim() ? signalsDef.trim().split('\n').filter(l => l.trim() && !l.startsWith('#')).length : 0;
  const stepCount = (analyzeSteps.match(/^##\s/gm) || []).length;

  // === 可拖拽分割线：左右（信号清单 vs 分析步骤） ===
  const [leftWidth, setLeftWidth] = useState(50); // 百分比
  const logicContainerRef = useRef<HTMLDivElement>(null);

  const handleHDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const container = logicContainerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();

    const onMove = (ev: MouseEvent) => {
      const x = ev.clientX - containerRect.left;
      const pct = (x / containerRect.width) * 100;
      setLeftWidth(Math.max(20, Math.min(80, pct)));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  // === 可拖拽分割线：上下（分析步骤 vs 校验结果） ===
  const [topHeight, setTopHeight] = useState(60); // 百分比
  const rightPanelRef = useRef<HTMLDivElement>(null);

  const handleVDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = rightPanelRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();

    const onMove = (ev: MouseEvent) => {
      const y = ev.clientY - containerRect.top;
      const pct = (y / containerRect.height) * 100;
      setTopHeight(Math.max(20, Math.min(80, pct)));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  return (
    <div className="h-screen flex flex-col">
      {/* 顶部栏 */}
      <header className="border-b border-[var(--border)] px-4 py-2 flex items-center gap-4 shrink-0">
        <h1 className="font-bold text-lg">RDS SKILL HUB</h1>
        <span className="text-xs text-[var(--muted)]">信号定义 → 逻辑校验 → 工作流 → 代码 → 执行</span>

        <div className="flex-1" />

        {/* 错误提示 */}
        {error && (
          <div className="px-3 py-1 bg-red-50 border border-red-200 rounded text-xs text-red-600 max-w-md truncate" title={error}>
            {error}
          </div>
        )}

        {/* 状态指示灯 */}
        <div className="flex items-center gap-3 text-[10px] text-[var(--muted)]">
          <span className="flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${workflowDef ? 'bg-green-400' : 'bg-gray-300'}`} />
            工作流
          </span>
          <span className="flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${code ? 'bg-green-400' : 'bg-gray-300'}`} />
            代码
          </span>
          <span className="flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${data ? 'bg-green-400' : 'bg-gray-300'}`} />
            数据
          </span>
          <span className="flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${result ? 'bg-green-400' : 'bg-gray-300'}`} />
            结果
          </span>
        </div>

        {/* 隐藏的文件上传 input */}
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFileUpload} className="hidden" />

        {/* 执行按钮 */}
        <button
          onClick={handleExecute}
          disabled={(!code && !workflowDef) || !data || status === 'executing'}
          className="flex items-center gap-1.5 px-4 py-1.5 text-xs bg-[var(--accent)] text-white rounded hover:opacity-90 transition disabled:opacity-40"
        >
          <Play size={14} />
          {status === 'executing' ? '执行中...' : status === 'generating-code' ? '生成代码...' : '执行分析'}
        </button>

        {/* 保存 Skill */}
        <button
          onClick={() => { setShowSkillSave(true); setShowSkillList(false); setSkillSaveName(activeSkillName || ''); }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-[var(--border)] rounded hover:bg-[var(--accent-light)] transition"
        >
          <Save size={14} />
          保存 Skill
        </button>

        {/* 我的 Skill */}
        <div className="relative">
          <button
            onClick={() => { setShowSkillList(!showSkillList); setShowSkillSave(false); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded transition ${
              activeSkillName
                ? 'border-[var(--accent)] text-[var(--accent)] bg-blue-50'
                : 'border-[var(--border)] hover:bg-[var(--accent-light)]'
            }`}
          >
            <BookMarked size={14} />
            我的 Skill
            <ChevronDown size={12} />
          </button>

          {/* Skill 列表下拉 */}
          {showSkillList && (
            <div className="absolute right-0 top-full mt-1 w-72 bg-[var(--bg)] border border-[var(--border)] rounded-lg shadow-lg z-50 overflow-hidden">
              <div className="px-3 py-2 border-b border-[var(--border)] text-xs font-bold text-[var(--muted)]">
                我的 Skill ({savedSkills.length})
              </div>
              <div className="max-h-80 overflow-auto">
                {savedSkills.length === 0 ? (
                  <div className="px-3 py-6 text-xs text-[var(--muted)] text-center">暂无保存的 Skill</div>
                ) : (
                  savedSkills.map(s => (
                    <div
                      key={s.name}
                      className={`group flex items-center gap-2 px-3 py-2 text-xs cursor-pointer hover:bg-[var(--accent-light)] transition ${
                        activeSkillName === s.name ? 'bg-blue-50 border-l-2 border-[var(--accent)]' : ''
                      }`}
                      onClick={() => handleLoadSkill(s.name)}
                    >
                      <BookMarked size={12} className="text-[var(--muted)] shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{s.name}</div>
                        {s.description && <div className="text-[var(--muted)] text-[10px] truncate">{s.description}</div>}
                        <div className="text-[var(--muted)] text-[10px]">
                          {new Date(s.updatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); handleDeleteSkill(s.name); }}
                        className="opacity-0 group-hover:opacity-100 p-1 text-red-400 hover:text-red-600 transition"
                        title="删除"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Skill 保存弹出面板 */}
      {showSkillSave && (
        <div className="border-b border-[var(--border)] px-4 py-2.5 flex items-center gap-3 bg-gray-50 shrink-0">
          <Save size={14} className="text-[var(--muted)] shrink-0" />
          <input
            value={skillSaveName}
            onChange={e => setSkillSaveName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSaveSkill()}
            placeholder="Skill 名称..."
            className="w-40 px-2 py-1 text-xs border border-[var(--border)] rounded bg-white"
            autoFocus
          />
          <input
            value={skillSaveDesc}
            onChange={e => setSkillSaveDesc(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSaveSkill()}
            placeholder="描述（可选）..."
            className="flex-1 max-w-sm px-2 py-1 text-xs border border-[var(--border)] rounded bg-white"
          />
          <div className="flex items-center gap-1.5 text-[10px] text-[var(--muted)]">
            <span className={signalsDef.trim() ? 'text-green-600' : ''}>信号{signalsDef.trim() ? '✓' : '—'}</span>
            <span className={analyzeSteps.trim() ? 'text-green-600' : ''}>步骤{analyzeSteps.trim() ? '✓' : '—'}</span>
            <span className={workflowDef ? 'text-green-600' : ''}>工作流{workflowDef ? '✓' : '—'}</span>
            <span className={code ? 'text-green-600' : ''}>代码{code ? '✓' : '—'}</span>
          </div>
          <button
            onClick={handleSaveSkill}
            disabled={!skillSaveName.trim()}
            className="px-3 py-1 text-xs bg-[var(--accent)] text-white rounded disabled:opacity-40"
          >
            保存
          </button>
          <button
            onClick={() => setShowSkillSave(false)}
            className="px-2 py-1 text-xs text-[var(--muted)] hover:text-[var(--fg)]"
          >
            取消
          </button>
        </div>
      )}

      {/* 全屏 Tab 区域 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Tab 栏 */}
        <div className="flex border-b border-[var(--border)] shrink-0">
          <button
            onClick={() => setActiveTab('logic')}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm border-b-2 transition ${
              activeTab === 'logic' ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-[var(--muted)]'
            }`}
          >
            <ClipboardList size={14} /> 逻辑描述与处理
            {(signalCount > 0 || stepCount > 0) && (
              <span className="ml-1 px-1.5 py-0.5 text-[10px] rounded-full bg-indigo-100 text-indigo-700">
                {signalCount}信号 {stepCount}步骤
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('flow')}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm border-b-2 transition ${
              activeTab === 'flow' ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-[var(--muted)]'
            }`}
          >
            <GitBranch size={14} /> 流程图
            {flowChart && (
              <span className="ml-1 px-1.5 py-0.5 text-[10px] rounded-full bg-purple-100 text-purple-700">
                {flowChart.nodes.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('data')}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm border-b-2 transition ${
              activeTab === 'data' ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-[var(--muted)]'
            }`}
          >
            <Table2 size={14} /> 数据加工
            {data && (
              <span className="ml-1 px-1.5 py-0.5 text-[10px] rounded-full bg-blue-100 text-blue-700">
                {data.rows.length}行
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('result')}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm border-b-2 transition ${
              activeTab === 'result' ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-[var(--muted)]'
            }`}
          >
            <Terminal size={14} /> 结果输出 {result && `(${result.findings.length})`}
          </button>

          {showCodeTab && (
            <button
              onClick={() => setActiveTab('code')}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm border-b-2 transition ${
                activeTab === 'code' ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-[var(--muted)]'
              }`}
            >
              <Code2 size={14} /> 代码
            </button>
          )}

          <div className="flex-1" />

          {code && !showCodeTab && (
            <button
              onClick={() => { setShowCodeTab(true); setActiveTab('code'); }}
              className="mr-2 px-3 py-1 text-xs text-[var(--muted)] hover:text-[var(--accent)] transition"
            >
              <Code2 size={14} className="inline mr-1" />
              查看代码
            </button>
          )}

        </div>

        {/* Tab 内容 */}
        <div className="flex-1 overflow-hidden">
          {/* ========== 逻辑描述与处理 Tab ========== */}
          {activeTab === 'logic' && (
            <div ref={logicContainerRef} className="h-full flex">
              {/* 左：信号清单 */}
              <div style={{ width: `${leftWidth}%` }} className="h-full flex flex-col shrink-0">
                <div className="px-4 py-3 border-b border-[var(--border)] shrink-0">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-bold">
                      信号清单
                      <span className="ml-2 text-xs font-normal text-[var(--muted)]">{signalCount} 个信号</span>
                    </label>
                  </div>
                  <p className="text-xs text-[var(--muted)] mt-1">定义所有需要分析的信号名称、描述和取值含义</p>
                </div>
                <div className="flex-1 p-4 overflow-hidden flex flex-col">
                  <textarea
                    value={signalsDef}
                    onChange={e => setSignalsDef(e.target.value)}
                    placeholder={"# 信号定义格式示例\n# 信号名称 描述 值定义\n\nVehLckngSta 车锁信号 0:解锁,2:内锁,3:外锁\nRLDoorOpenSts 左后门开关信号 0:关闭,2:半开,3:全开\nRRDoorOpenSts 右后门开关信号 0:关闭,2:半开,3:全开\nDrvrDoorOpenSts 主驾门开关信号 0:关闭,2:半开,3:全开\nFrtPsngDoorOpenSts 副驾门开关信号 0:关闭,2:半开,3:全开\nLdspcOpenSts 后备箱开关信号 0:关闭,1:打开\nBCMDrvrDetSts 主驾占位信号 0:无占位,1:有占位\nDigKey1Loctn 主账号蓝牙钥匙位置 0,1,2:落锁区域,3-11:解锁区域\nDigKey2Loctn 授权账号蓝牙钥匙位置 0,1,2:落锁区域,3-11:解锁区域\nEPTRdy 车辆Ready状态 0:未上Ready,1:已上Ready"}
                    className="flex-1 w-full p-3 text-sm border border-[var(--border)] rounded resize-none bg-transparent font-mono leading-relaxed"
                  />
                  <p className="text-[10px] text-[var(--muted)] mt-2">格式: 信号名称 描述 值:含义,值:含义...</p>
                </div>
              </div>

              {/* 左右拖拽分割线 */}
              <div
                onMouseDown={handleHDragStart}
                className="w-1 hover:w-1.5 bg-[var(--border)] hover:bg-[var(--accent)] cursor-col-resize shrink-0 transition-all relative group"
              >
                <div className="absolute inset-y-0 -left-1 -right-1" />
              </div>

              {/* 右：分析步骤 + 校验结果 */}
              <div ref={rightPanelRef} className="flex-1 h-full flex flex-col min-w-0">
                <div className="px-4 py-3 border-b border-[var(--border)] shrink-0">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-bold">
                      分析步骤
                      <span className="ml-2 text-xs font-normal text-[var(--muted)]">{stepCount} 个步骤</span>
                    </label>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-[var(--muted)]">扫描模式:</span>
                      <label className="flex items-center gap-1 text-xs">
                        <input type="radio" name="scanMode" defaultChecked className="accent-[var(--accent)]" />
                        按时序扫描
                      </label>
                      <label className="flex items-center gap-1 text-xs">
                        <input type="radio" name="scanMode" className="accent-[var(--accent)]" />
                        全量扫描
                      </label>
                    </div>
                  </div>
                  <p className="text-xs text-[var(--muted)] mt-1">定义分析的逻辑流程，包括条件和动作（输入时实时校验）</p>
                </div>

                <div className="flex-1 flex flex-col min-h-0">
                  {/* 上部：分析步骤输入区 */}
                  <div style={{ height: validationResult ? `${topHeight}%` : '100%' }} className="p-4 flex flex-col min-h-0 shrink-0">
                    <LineNumberedTextarea
                      value={analyzeSteps}
                      onChange={setAnalyzeSteps}
                      placeholder={"# 分析逻辑格式示例\n\n## 步骤1：识别离车场景\n- 条件：四门一盖全部等于0\n- 动作：记录关闭最后一扇门的时间\n- 下一步：步骤2\n\n## 步骤2：检查蓝牙连接状态\n- 条件：DigKey1Loctn或DigKey2Loctn任一不为0\n- 若不满足：输出\"蓝牙钥匙已断联\""}
                      className="flex-1"
                      errorLines={errorLines}
                    />
                    <p className="text-[10px] text-[var(--muted)] mt-2">格式: ## 步骤N: 标题 + 条件/动作列表</p>

                    {/* 实时信号引用检查提示 */}
                    {realtimeSignalIssues.length > 0 && (
                      <div className="mt-2 px-2.5 py-1.5 bg-red-50 border border-red-200 rounded text-[11px] text-red-700 flex items-start gap-1.5 shrink-0">
                        <XCircle size={13} className="shrink-0 mt-0.5 text-red-400" />
                        <div className="flex-1 min-w-0">
                          <span className="font-medium">未定义的信号引用：</span>
                          <span className="flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5">
                            {realtimeSignalIssues.map((issue, i) => (
                              <span key={i}>
                                <span className="inline-block px-1 py-0.5 rounded bg-red-100 text-red-600 text-[10px] font-mono mr-0.5">L{issue.line}</span>
                                <span className="font-mono text-red-600">{issue.signal}</span>
                              </span>
                            ))}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* 操作按钮 */}
                    <div className="flex gap-2 mt-3 shrink-0">
                      <button
                        onClick={handleValidateLogic}
                        disabled={(!signalsDef.trim() && !analyzeSteps.trim()) || validating || isGenerating}
                        className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm border-2 border-[var(--accent)] text-[var(--accent)] rounded-lg hover:bg-[var(--accent)] hover:text-white transition disabled:opacity-40"
                      >
                        <ShieldCheck size={15} />
                        {validating ? '校验中...' : '逻辑校验'}
                      </button>
                      <button
                        onClick={handleGenerate}
                        disabled={!analyzeSteps.trim() || isGenerating || validating}
                        className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm bg-[var(--accent)] text-white rounded-lg hover:opacity-90 transition disabled:opacity-40"
                      >
                        <Sparkles size={15} />
                        {isGenerating ? '生成中...' : '生成工作流'}
                      </button>
                    </div>
                  </div>

                  {/* 上下拖拽分割线 + 校验结果 */}
                  {validationResult && (
                    <>
                      <div
                        onMouseDown={handleVDragStart}
                        className="h-1 hover:h-1.5 bg-[var(--border)] hover:bg-[var(--accent)] cursor-row-resize shrink-0 transition-all relative group"
                      >
                        <div className="absolute inset-x-0 -top-1 -bottom-1" />
                      </div>

                      <div style={{ height: `${100 - topHeight}%` }} className="overflow-auto p-4 min-h-0">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-bold">校验结果</span>
                          <button onClick={() => setValidationResult(null)} className="text-[var(--muted)] hover:text-[var(--fg)]">
                            <X size={14} />
                          </button>
                        </div>
                      <div className="text-xs space-y-3">
                        {/* 总结 */}
                        <div className={`p-2.5 rounded ${
                          validationResult.signalCheck.passed && validationResult.logicCheck.passed && validationResult.adaptabilityCheck.passed
                            ? 'bg-green-50 border border-green-200 text-green-700'
                            : 'bg-amber-50 border border-amber-200 text-amber-700'
                        }`}>
                          {validationResult.summary}
                        </div>

                        {/* 信号检查 */}
                        <div>
                          <div className="flex items-center gap-1.5 font-medium mb-1">
                            {validationResult.signalCheck.passed
                              ? <CheckCircle2 size={13} className="text-green-500" />
                              : <XCircle size={13} className="text-red-500" />}
                            信号引用检查
                          </div>
                          {validationResult.signalCheck.issues.length > 0 ? (
                            <div className="space-y-1 ml-5">
                              {validationResult.signalCheck.issues.map((issue, i) => (
                                <div key={i} className="text-[11px]">
                                  {issue.line && <span className="inline-block px-1 py-0.5 mr-1 rounded bg-red-100 text-red-600 text-[10px] font-mono">L{issue.line}</span>}
                                  <span className="text-red-500 font-mono">{issue.signal}</span>
                                  <span className="text-[var(--muted)]"> — {issue.message}</span>
                                  {issue.suggestion && <span className="text-blue-500"> 建议: {issue.suggestion}</span>}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="ml-5 text-[11px] text-green-600">所有信号引用正确</div>
                          )}
                        </div>

                        {/* 逻辑检查 */}
                        <div>
                          <div className="flex items-center gap-1.5 font-medium mb-1">
                            {validationResult.logicCheck.passed
                              ? <CheckCircle2 size={13} className="text-green-500" />
                              : <XCircle size={13} className="text-red-500" />}
                            逻辑完整性检查
                          </div>
                          {validationResult.logicCheck.issues.length > 0 ? (
                            <div className="space-y-1 ml-5">
                              {validationResult.logicCheck.issues.map((issue, i) => (
                                <div key={i} className="text-[11px]">
                                  {issue.line && <span className="inline-block px-1 py-0.5 mr-1 rounded bg-amber-100 text-amber-700 text-[10px] font-mono">L{issue.line}</span>}
                                  <span className="font-medium">[{issue.step}]</span>
                                  <span className="text-[var(--muted)]"> {issue.message}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="ml-5 text-[11px] text-green-600">逻辑结构完整</div>
                          )}
                        </div>

                        {/* 适配性检查 */}
                        <div>
                          <div className="flex items-center gap-1.5 font-medium mb-1">
                            {validationResult.adaptabilityCheck.passed
                              ? <CheckCircle2 size={13} className="text-green-500" />
                              : <Info size={13} className="text-blue-500" />}
                            工作流适配性检查
                          </div>
                          {validationResult.adaptabilityCheck.issues.length > 0 ? (
                            <div className="space-y-1 ml-5">
                              {validationResult.adaptabilityCheck.issues.map((issue, i) => (
                                <div key={i} className="text-[11px]">
                                  {issue.line && <span className="inline-block px-1 py-0.5 mr-1 rounded bg-blue-100 text-blue-700 text-[10px] font-mono">L{issue.line}</span>}
                                  <span className="font-medium">[{issue.step}]</span>
                                  <span className="text-[var(--muted)]"> {issue.message}</span>
                                  {issue.suggestion && <div className="text-blue-500 ml-2">→ {issue.suggestion}</div>}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="ml-5 text-[11px] text-green-600">步骤描述适合工作流生成</div>
                          )}
                        </div>

                        {/* 优化后的步骤 */}
                        {validationResult.optimizedSteps && (
                          <div className="border-t border-[var(--border)] pt-2">
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-medium flex items-center gap-1.5">
                                <Sparkles size={13} className="text-purple-500" />
                                优化建议
                              </span>
                              <button
                                onClick={() => {
                                  if (validationResult.optimizedSteps) {
                                    setAnalyzeSteps(validationResult.optimizedSteps);
                                  }
                                }}
                                className="px-2.5 py-1 text-[11px] bg-purple-100 text-purple-700 rounded hover:bg-purple-200 transition"
                              >
                                应用优化
                              </button>
                            </div>
                            <pre className="text-[11px] p-3 bg-gray-50 border border-gray-200 rounded max-h-[150px] overflow-auto whitespace-pre-wrap font-mono">
                              {validationResult.optimizedSteps}
                            </pre>
                          </div>
                        )}
                      </div>
                    </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ========== 流程图 Tab ========== */}
          {activeTab === 'flow' && (
            <div className="h-full relative flex">
              <div className={`h-full transition-all duration-300 ${showJsonPanel ? 'flex-1 min-w-0' : 'w-full'}`}>
                {isGenerating ? (
                  <div className="h-full flex flex-col p-4 gap-3">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <span className="inline-block w-2.5 h-2.5 rounded-full bg-[var(--accent)] animate-pulse" />
                      <span className="text-[var(--fg)]">
                        {status === 'generating' ? '正在生成工作流...' : '正在生成代码...'}
                      </span>
                    </div>
                    <div
                      ref={streamLogRef}
                      className="flex-1 overflow-auto rounded border border-[var(--border)] bg-[#0d1117] p-3 font-mono text-xs leading-relaxed"
                    >
                      {streamLog.map((entry, i) => (
                        <div key={i} className={
                          entry.type === 'progress' ? 'text-blue-400 mb-1'
                            : entry.type === 'error' ? 'text-red-400 mb-1'
                            : 'text-green-300 whitespace-pre-wrap'
                        }>
                          {entry.type === 'progress' && <span className="text-gray-500 mr-1">›</span>}
                          {entry.text}
                          {entry.type === 'token' && i === streamLog.length - 1 && isGenerating && (
                            <span className="animate-pulse text-white">▋</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : flowChart ? (
                  <FlowChartView flowChart={flowChart} onNodeClick={handleNodeClick} />
                ) : (
                  <div className="h-full flex items-center justify-center text-[var(--muted)]">
                    请先在「逻辑描述与处理」中输入分析步骤并生成工作流
                  </div>
                )}

                {workflowDef && !showJsonPanel && !isGenerating && flowChart && (
                  <button
                    onClick={() => setShowJsonPanel(true)}
                    className="absolute top-3 right-3 z-10 flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white border border-[var(--border)] rounded-lg shadow-sm hover:shadow-md hover:border-[var(--accent)] transition"
                    title="查看/编辑 JSON"
                  >
                    <Braces size={14} />
                    编辑 JSON
                    {jsonDirty && <span className="w-2 h-2 rounded-full bg-orange-400" />}
                  </button>
                )}
              </div>

              {/* JSON 编辑面板 */}
              {showJsonPanel && (
                <div className="w-[480px] h-full border-l border-[var(--border)] flex flex-col bg-[var(--bg)] shrink-0">
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)]">
                    <Braces size={14} className="text-[var(--muted)]" />
                    <span className="text-xs font-bold">工作流 JSON</span>
                    <div className="flex-1" />
                    {jsonError && (
                      <span className="text-[10px] text-red-500 truncate max-w-[150px]" title={jsonError}>格式错误</span>
                    )}
                    {jsonDirty && !jsonError && (
                      <span className="text-[10px] text-orange-500">已修改</span>
                    )}
                    {jsonDirty && (
                      <>
                        <button onClick={handleRevertJson} className="flex items-center gap-1 px-2 py-1 text-xs border border-[var(--border)] rounded hover:bg-red-50 hover:text-red-600 transition" title="撤销修改">
                          <X size={12} />
                        </button>
                        <button onClick={handleApplyJson} disabled={!!jsonError} className="flex items-center gap-1 px-2.5 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 transition disabled:opacity-40" title="保存并更新流程图">
                          <Check size={12} /> 保存
                        </button>
                      </>
                    )}
                    <button onClick={() => setShowJsonPanel(false)} className="p-1 text-[var(--muted)] hover:text-[var(--fg)] transition" title="关闭">
                      <X size={14} />
                    </button>
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <MonacoEditor
                      height="100%"
                      language="json"
                      value={jsonText}
                      onChange={handleJsonChange}
                      theme="vs-dark"
                      options={{
                        minimap: { enabled: false },
                        fontSize: 12,
                        lineNumbers: 'on',
                        wordWrap: 'on',
                        scrollBeyondLastLine: false,
                        automaticLayout: true,
                        tabSize: 2,
                        formatOnPaste: true,
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ========== 数据加工 Tab ========== */}
          {activeTab === 'data' && (
            <div className="h-full flex flex-col">
              {/* 数据加工顶部操作栏 */}
              <div className="px-4 py-2 border-b border-[var(--border)] flex items-center gap-3 shrink-0">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-[var(--border)] rounded hover:bg-[var(--accent-light)] transition"
                >
                  <FileUp size={14} />
                  {data ? '重新上传' : '上传数据'}
                </button>
                {data && (
                  <span className="text-xs text-[var(--muted)]">
                    当前: {data.fileName} ({data.rows.length} 行 × {data.headers.length} 列)
                  </span>
                )}
              </div>
              <div className="flex-1 overflow-hidden">
                <DataPreviewPanel
                  data={data}
                  headerOverrides={headerOverrides}
                  onHeaderRename={(idx, name) => setHeaderOverrides(prev => ({ ...prev, [idx]: name }))}
                  onHeaderReset={(idx) => setHeaderOverrides(prev => {
                    const next = { ...prev };
                    delete next[idx];
                    return next;
                  })}
                  onHeaderResetAll={() => setHeaderOverrides({})}
                />
              </div>
            </div>
          )}

          {/* ========== 结果输出 Tab ========== */}
          {activeTab === 'result' && (
            result ? (
              <ResultPanel result={result} code={code} />
            ) : (
              <div className="h-full flex items-center justify-center text-[var(--muted)]">
                请上传数据并执行分析
              </div>
            )
          )}

          {/* ========== 代码 Tab ========== */}
          {activeTab === 'code' && showCodeTab && (
            <CodeEditor
              code={code}
              onChange={handleCodeChange}
              highlightRange={highlightRange}
            />
          )}
        </div>
      </div>
    </div>
  );
}
