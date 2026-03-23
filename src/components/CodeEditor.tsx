'use client';

import { useRef, useCallback } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';

interface CodeEditorProps {
  code: string;
  onChange: (code: string) => void;
  /** 高亮指定行范围 */
  highlightRange?: { startLine: number; endLine: number } | null;
  readOnly?: boolean;
}

export default function CodeEditor({ code, onChange, highlightRange, readOnly }: CodeEditorProps) {
  const editorRef = useRef<any>(null);
  const decorationsRef = useRef<string[]>([]);

  const handleMount: OnMount = useCallback((editor) => {
    editorRef.current = editor;
  }, []);

  // 高亮行范围
  const updateHighlight = useCallback(() => {
    const editor = editorRef.current;
    if (!editor || !highlightRange) return;

    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, [
      {
        range: {
          startLineNumber: highlightRange.startLine,
          startColumn: 1,
          endLineNumber: highlightRange.endLine,
          endColumn: 1,
        },
        options: {
          isWholeLine: true,
          className: 'highlighted-line',
          linesDecorationsClassName: 'highlighted-line-gutter',
        },
      },
    ]);

    editor.revealLineInCenter(highlightRange.startLine);
  }, [highlightRange]);

  // highlightRange 变化时更新
  if (editorRef.current && highlightRange) {
    updateHighlight();
  }

  return (
    <div className="h-full w-full border border-[var(--border)] rounded overflow-hidden">
      <Editor
        height="100%"
        defaultLanguage="typescript"
        value={code}
        onChange={(v) => onChange(v || '')}
        onMount={handleMount}
        theme="vs-dark"
        options={{
          readOnly,
          minimap: { enabled: false },
          fontSize: 13,
          lineNumbers: 'on',
          wordWrap: 'on',
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
        }}
      />
    </div>
  );
}
