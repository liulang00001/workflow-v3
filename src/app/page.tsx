'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { FlowChart, DataTable, ExecutionResult } from '@/lib/types';
import { WorkflowDefinition } from '@/lib/workflow-schema';
import { workflowToFlowChart } from '@/lib/json-to-flow';
import ResultPanel from '@/components/ResultPanel';
import DataPreviewPanel, { formatHeader } from '@/components/DataPreviewPanel';
import { FileUp, Play, Sparkles, Code2, GitBranch, Terminal, Save, FolderOpen, Trash2, Table2, Braces, Check, X } from 'lucide-react';

interface SavedScript {
  name: string;
  fileName: string;
  updatedAt: string;
  size: number;
}

// 动态加载避免 SSR 问题
const CodeEditor = dynamic(() => import('@/components/CodeEditor'), { ssr: false });
const FlowChartView = dynamic(() => import('@/components/FlowChart'), { ssr: false });
const MonacoEditor = dynamic(() => import('@monaco-editor/react').then(m => m.default), { ssr: false });

type Tab = 'flow' | 'data' | 'result' | 'code';

export default function Home() {
  // === 核心状态 ===
  const [description, setDescription] = useState('');
  const [workflowDef, setWorkflowDef] = useState<WorkflowDefinition | null>(null);
  const [code, setCode] = useState('');
  const [flowChart, setFlowChart] = useState<FlowChart | null>(null);
  const [data, setData] = useState<DataTable | null>(null);
  const [headerOverrides, setHeaderOverrides] = useState<Record<number, string>>({});
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [status, setStatus] = useState<'idle' | 'generating' | 'generating-code' | 'executing'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('flow');
  const [highlightRange, setHighlightRange] = useState<{ startLine: number; endLine: number } | null>(null);
  const [showCodeTab, setShowCodeTab] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // === JSON 编辑面板状态 ===
  const [showJsonPanel, setShowJsonPanel] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [jsonDirty, setJsonDirty] = useState(false);

  // === 脚本管理 ===
  const [savedScripts, setSavedScripts] = useState<SavedScript[]>([]);
  const [saveName, setSaveName] = useState('');
  const [showSaveInput, setShowSaveInput] = useState(false);

  const loadScriptList = useCallback(async () => {
    try {
      const res = await fetch('/api/scripts');
      const json = await res.json();
      if (json.success) setSavedScripts(json.scripts);
    } catch {}
  }, []);

  useEffect(() => { loadScriptList(); }, [loadScriptList]);

  // 当 workflowDef 变化时，同步 JSON 文本
  useEffect(() => {
    if (workflowDef) {
      setJsonText(JSON.stringify(workflowDef, null, 2));
      setJsonDirty(false);
      setJsonError(null);
    }
  }, [workflowDef]);

  const handleSaveScript = useCallback(async () => {
    if (!saveName.trim() || !code.trim()) return;
    try {
      const res = await fetch('/api/scripts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: saveName.trim(), code }),
      });
      const json = await res.json();
      if (json.success) {
        setShowSaveInput(false);
        setSaveName('');
        loadScriptList();
      } else {
        setError(json.error);
      }
    } catch (e) {
      setError(String(e));
    }
  }, [saveName, code, loadScriptList]);

  // === 步骤 1: 自然语言 → JSON 工作流定义 → 流程图 ===
  const handleGenerate = useCallback(async () => {
    if (!description.trim()) return;
    setStatus('generating');
    setError(null);

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);

      const wfDef: WorkflowDefinition = json.workflowDef;
      setWorkflowDef(wfDef);

      // 从 JSON 生成流程图
      const chart = workflowToFlowChart(wfDef);
      setFlowChart(chart);
      setActiveTab('flow');

      // 自动生成 TS 代码
      setStatus('generating-code');
      setCode(''); // 清除旧代码，避免 JSON 和代码不匹配
      const codeRes = await fetch('/api/generate-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowDef: wfDef }),
      });
      const codeJson = await codeRes.json();
      if (codeJson.success) {
        setCode(codeJson.code);
      } else {
        setError(`代码生成失败: ${codeJson.error}`);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setStatus('idle');
    }
  }, [description]);

  // === JSON 编辑 → 应用更改 ===
  const handleJsonChange = useCallback((value: string | undefined) => {
    const text = value || '';
    setJsonText(text);
    setJsonDirty(true);

    // 实时校验 JSON 格式
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

      // 更新工作流定义
      setWorkflowDef(parsed);
      setJsonDirty(false);
      setJsonError(null);

      // 重新生成流程图
      const chart = workflowToFlowChart(parsed);
      setFlowChart(chart);

      // 重新生成代码
      setCode(''); // 清除旧代码
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

      // 清除旧结果
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

  // === 脚本加载/删除 ===
  const handleLoadScript = useCallback(async (name: string) => {
    try {
      const res = await fetch(`/api/scripts/${encodeURIComponent(name)}`);
      const json = await res.json();
      if (json.success) {
        setCode(json.code);
        setShowCodeTab(true);
        setActiveTab('code');
      } else {
        setError(json.error);
      }
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const handleDeleteScript = useCallback(async (name: string) => {
    try {
      const res = await fetch('/api/scripts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const json = await res.json();
      if (json.success) loadScriptList();
    } catch {}
  }, [loadScriptList]);

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

  return (
    <div className="h-screen flex flex-col">
      {/* 顶部栏 */}
      <header className="border-b border-[var(--border)] px-4 py-2 flex items-center gap-4 shrink-0">
        <h1 className="font-bold text-lg">Workflow Analyzer V3</h1>
        <span className="text-xs text-[var(--muted)]">自然语言 → JSON节点 → 流程图 → 代码 → 执行</span>

        <div className="flex-1" />

        {/* 文件上传 */}
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFileUpload} className="hidden" />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-[var(--border)] rounded hover:bg-[var(--accent-light)] transition"
        >
          <FileUp size={14} />
          {data ? `${data.fileName} (${data.rows.length}行)` : '上传数据'}
        </button>

        {/* 执行按钮 */}
        <button
          onClick={handleExecute}
          disabled={(!code && !workflowDef) || !data || status === 'executing'}
          className="flex items-center gap-1.5 px-4 py-1.5 text-xs bg-[var(--accent)] text-white rounded hover:opacity-90 transition disabled:opacity-40"
        >
          <Play size={14} />
          {status === 'executing' ? '执行中...' : status === 'generating-code' ? '生成代码...' : '执行分析'}
        </button>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* 左侧：输入面板 */}
        <div className="w-80 border-r border-[var(--border)] flex flex-col shrink-0">
          <div className="p-3 border-b border-[var(--border)]">
            <label className="text-xs font-bold text-[var(--muted)] uppercase">自然语言描述</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={"描述你的分析需求，例如：\n\n分析蓝牙钥匙离车落锁问题：\n1. 识别四门一盖全关闭的时刻\n2. 排除上车场景\n3. 检查蓝牙连接状态\n4. 连续8秒基础条件检查\n5. 600秒蓝牙定位检查"}
              className="w-full mt-2 p-2 text-sm border border-[var(--border)] rounded resize-none bg-transparent"
              rows={10}
            />
            <button
              onClick={handleGenerate}
              disabled={!description.trim() || status === 'generating'}
              className="w-full mt-2 flex items-center justify-center gap-1.5 px-3 py-2 text-sm bg-[var(--accent)] text-white rounded hover:opacity-90 transition disabled:opacity-40"
            >
              <Sparkles size={14} />
              {status === 'generating' ? '生成中...' : status === 'generating-code' ? '生成代码中...' : '生成工作流'}
            </button>
          </div>

          {/* 错误提示 */}
          {error && (
            <div className="mx-3 mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-600">
              {error}
            </div>
          )}

          {/* 状态信息 */}
          <div className="p-3 border-b border-[var(--border)]">
            <div className="space-y-2 text-xs text-[var(--muted)]">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${workflowDef ? 'bg-green-400' : 'bg-gray-300'}`} />
                <span>工作流 {workflowDef ? `(${workflowDef.steps.length} 步骤)` : '未生成'}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${flowChart ? 'bg-green-400' : 'bg-gray-300'}`} />
                <span>流程图 {flowChart ? `(${flowChart.nodes.length} 节点)` : '未生成'}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${code ? 'bg-green-400' : 'bg-gray-300'}`} />
                <span>代码 {code ? `(${code.length} 字符)` : '未生成'}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${data ? 'bg-green-400' : 'bg-gray-300'}`} />
                <span>数据 {data ? `(${data.rows.length} 行)` : '未上传'}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${result ? 'bg-green-400' : 'bg-gray-300'}`} />
                <span>结果 {result ? `(${result.findings.length} 发现)` : '未执行'}</span>
              </div>
            </div>
          </div>

          {/* 代码管理 */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="p-3 flex items-center justify-between">
              <label className="text-xs font-bold text-[var(--muted)] uppercase">历史代码</label>
              <button
                onClick={() => { setShowSaveInput(!showSaveInput); setSaveName(''); }}
                disabled={!code}
                className="flex items-center gap-1 px-2 py-1 text-xs text-[var(--muted)] hover:text-[var(--accent)] transition disabled:opacity-40"
              >
                <Save size={12} />
                保存当前
              </button>
            </div>

            {showSaveInput && (
              <div className="px-3 pb-2 flex gap-1">
                <input
                  value={saveName}
                  onChange={e => setSaveName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSaveScript()}
                  placeholder="输入脚本名称..."
                  className="flex-1 px-2 py-1 text-xs border border-[var(--border)] rounded bg-transparent"
                  autoFocus
                />
                <button
                  onClick={handleSaveScript}
                  disabled={!saveName.trim()}
                  className="px-2 py-1 text-xs bg-[var(--accent)] text-white rounded disabled:opacity-40"
                >
                  保存
                </button>
              </div>
            )}

            <div className="flex-1 overflow-auto px-3 pb-3">
              {savedScripts.length === 0 ? (
                <div className="text-xs text-[var(--muted)] text-center py-4">暂无保存的脚本</div>
              ) : (
                <div className="space-y-1">
                  {savedScripts.map(s => (
                    <div key={s.name} className="group flex items-center gap-1 p-2 rounded hover:bg-[var(--accent-light)] transition text-xs cursor-pointer"
                         onClick={() => handleLoadScript(s.name)}>
                      <FolderOpen size={12} className="text-[var(--muted)] shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{s.name}</div>
                        <div className="text-[var(--muted)] text-[10px]">
                          {new Date(s.updatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); handleDeleteScript(s.name); }}
                        className="opacity-0 group-hover:opacity-100 p-1 text-red-400 hover:text-red-600 transition"
                        title="删除"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 右侧：流程图/数据/结果/代码 tab */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Tab 栏 */}
          <div className="flex border-b border-[var(--border)] shrink-0">
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
            {activeTab === 'flow' && (
              <div className="h-full relative flex">
                {/* 流程图主区域 */}
                <div className={`h-full transition-all duration-300 ${showJsonPanel ? 'flex-1 min-w-0' : 'w-full'}`}>
                  {flowChart ? (
                    <FlowChartView flowChart={flowChart} onNodeClick={handleNodeClick} />
                  ) : (
                    <div className="h-full flex items-center justify-center text-[var(--muted)]">
                      请先输入描述并生成工作流
                    </div>
                  )}

                  {/* 右上角 JSON 展开按钮 */}
                  {workflowDef && !showJsonPanel && (
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

                {/* JSON 编辑面板（右侧滑出） */}
                {showJsonPanel && (
                  <div className="w-[480px] h-full border-l border-[var(--border)] flex flex-col bg-[var(--bg)] shrink-0">
                    {/* JSON 面板头部 */}
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)]">
                      <Braces size={14} className="text-[var(--muted)]" />
                      <span className="text-xs font-bold">工作流 JSON</span>
                      <div className="flex-1" />
                      {jsonError && (
                        <span className="text-[10px] text-red-500 truncate max-w-[150px]" title={jsonError}>
                          格式错误
                        </span>
                      )}
                      {jsonDirty && !jsonError && (
                        <span className="text-[10px] text-orange-500">已修改</span>
                      )}
                      {jsonDirty && (
                        <>
                          <button
                            onClick={handleRevertJson}
                            className="flex items-center gap-1 px-2 py-1 text-xs border border-[var(--border)] rounded hover:bg-red-50 hover:text-red-600 transition"
                            title="撤销修改"
                          >
                            <X size={12} />
                          </button>
                          <button
                            onClick={handleApplyJson}
                            disabled={!!jsonError}
                            className="flex items-center gap-1 px-2.5 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 transition disabled:opacity-40"
                            title="保存并更新流程图"
                          >
                            <Check size={12} /> 保存
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => setShowJsonPanel(false)}
                        className="p-1 text-[var(--muted)] hover:text-[var(--fg)] transition"
                        title="关闭"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    {/* JSON 编辑器 */}
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

            {activeTab === 'data' && (
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
            )}

            {activeTab === 'result' && (
              result ? (
                <ResultPanel result={result} code={code} />
              ) : (
                <div className="h-full flex items-center justify-center text-[var(--muted)]">
                  请上传数据并执行分析
                </div>
              )
            )}

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
    </div>
  );
}
