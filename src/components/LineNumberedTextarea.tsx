'use client';

import { useRef, useCallback, useEffect, useState } from 'react';

interface LineNumberedTextareaProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  /** 需要标红高亮的行号集合（1-based） */
  errorLines?: Set<number>;
}

const LINE_HEIGHT = 22;
const FONT_SIZE = 14;
const PADDING = 12;

export default function LineNumberedTextarea({ value, onChange, placeholder, className, errorLines }: LineNumberedTextareaProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const [lineHeights, setLineHeights] = useState<number[]>([]);

  const lines = value.split('\n');

  // 用 mirror div 测量每一行的实际渲染高度（含软换行）
  const measureLines = useCallback(() => {
    const mirror = mirrorRef.current;
    const textarea = textareaRef.current;
    if (!mirror || !textarea) return;

    const style = window.getComputedStyle(textarea);
    const width = textarea.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    mirror.style.width = `${width}px`;

    const currentLines = value.split('\n');
    const heights: number[] = [];

    mirror.innerHTML = '';
    for (const line of currentLines) {
      const lineDiv = document.createElement('div');
      lineDiv.style.whiteSpace = 'pre-wrap';
      lineDiv.style.wordBreak = 'break-all';
      lineDiv.style.fontSize = `${FONT_SIZE}px`;
      lineDiv.style.lineHeight = `${LINE_HEIGHT}px`;
      lineDiv.style.fontFamily = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';
      lineDiv.textContent = line || '\u200b';
      mirror.appendChild(lineDiv);
      heights.push(lineDiv.offsetHeight);
    }

    setLineHeights(heights);
  }, [value]);

  useEffect(() => {
    measureLines();
  }, [measureLines]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const ro = new ResizeObserver(() => { measureLines(); });
    ro.observe(textarea);
    return () => ro.disconnect();
  }, [measureLines]);

  // 同步滚动：textarea → 行号栏 + 高亮层
  const handleScroll = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = ta.scrollTop;
    }
    if (highlightRef.current) {
      highlightRef.current.scrollTop = ta.scrollTop;
    }
  }, []);

  // 兜底：原生 scroll 事件监听
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const sync = () => {
      if (lineNumbersRef.current) lineNumbersRef.current.scrollTop = ta.scrollTop;
      if (highlightRef.current) highlightRef.current.scrollTop = ta.scrollTop;
    };
    ta.addEventListener('scroll', sync, { passive: true });
    return () => ta.removeEventListener('scroll', sync);
  }, []);

  const lineCount = lines.length;

  return (
    <div
      ref={containerRef}
      className={`flex border border-[var(--border)] rounded min-h-0 ${className || ''}`}
      style={{ overflow: 'hidden', position: 'relative' }}
    >
      {/* 隐藏的 mirror div，用于测量每行实际渲染高度 */}
      <div
        ref={mirrorRef}
        aria-hidden
        style={{
          position: 'absolute',
          top: -9999,
          left: -9999,
          visibility: 'hidden',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          fontSize: `${FONT_SIZE}px`,
          lineHeight: `${LINE_HEIGHT}px`,
          fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
        }}
      />

      {/* 行号栏 */}
      <div
        ref={lineNumbersRef}
        className="shrink-0 bg-gray-50 border-r border-[var(--border)] text-right select-none"
        style={{
          width: lineCount >= 1000 ? '4rem' : lineCount >= 100 ? '3.5rem' : '2.8rem',
          overflowY: 'hidden',
        }}
      >
        <div style={{ paddingTop: PADDING, paddingRight: 8, paddingLeft: 8 }}>
          {lines.map((_, i) => {
            const isError = errorLines?.has(i + 1);
            return (
              <div
                key={i}
                className="font-mono flex items-start"
                style={{
                  height: lineHeights[i] || LINE_HEIGHT,
                  lineHeight: `${LINE_HEIGHT}px`,
                  fontSize: 12,
                  color: isError ? '#dc2626' : 'var(--muted)',
                  fontWeight: isError ? 600 : 400,
                  backgroundColor: isError ? '#fef2f2' : 'transparent',
                }}
              >
                <span className="ml-auto">{i + 1}</span>
              </div>
            );
          })}
          <div style={{ height: PADDING }} />
        </div>
      </div>

      {/* 编辑区容器（高亮层 + textarea 叠加） */}
      <div className="flex-1 relative min-h-0 min-w-0">
        {/* 高亮背景层 — 位于 textarea 下方，与 textarea 同步滚动 */}
        <div
          ref={highlightRef}
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            overflowY: 'hidden',
            paddingTop: PADDING,
            paddingLeft: PADDING,
            paddingRight: PADDING,
          }}
        >
          {lines.map((_, i) => {
            const isError = errorLines?.has(i + 1);
            return (
              <div
                key={i}
                style={{
                  height: lineHeights[i] || LINE_HEIGHT,
                  backgroundColor: isError ? 'rgba(254, 202, 202, 0.35)' : 'transparent',
                  borderRadius: isError ? 2 : 0,
                  marginLeft: -PADDING,
                  marginRight: -PADDING,
                  paddingLeft: PADDING,
                  paddingRight: PADDING,
                  // 给错误行左侧加一条红色竖线标记
                  borderLeft: isError ? '3px solid #f87171' : '3px solid transparent',
                }}
              />
            );
          })}
          <div style={{ height: PADDING }} />
        </div>

        {/* 实际输入 textarea — 背景透明，叠在高亮层上方 */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={e => onChange(e.target.value)}
          onScroll={handleScroll}
          placeholder={placeholder}
          className="absolute inset-0 w-full h-full resize-none font-mono outline-none"
          style={{
            padding: PADDING,
            fontSize: FONT_SIZE,
            lineHeight: `${LINE_HEIGHT}px`,
            overflowY: 'auto',
            wordBreak: 'break-all',
            background: 'transparent',
            caretColor: '#000',
          }}
        />
      </div>
    </div>
  );
}
