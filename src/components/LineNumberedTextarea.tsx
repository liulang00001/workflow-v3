'use client';

import React, { useRef, useCallback, useEffect, useState, useMemo } from 'react';

interface LineNumberedTextareaProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  /** 需要整行标红的行号集合（1-based），用于 LLM 逻辑校验结果 */
  errorLines?: Set<number>;
  /** 需要标红的具体信号词：行号(1-based) → 信号名数组 */
  highlightWords?: Map<number, string[]>;
}

const LINE_HEIGHT = 22;
const FONT_SIZE = 14;
const PADDING = 12;
const FONT_FAMILY = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

/** 将一行文本中的指定 words 用红色高亮，其余保持正常颜色 */
function renderLineWithHighlights(text: string, words: string[]): React.ReactNode[] {
  if (!words.length || !text) return [text || '\u200b'];

  // 构造正则：匹配所有需要高亮的信号名（精确匹配单词边界）
  const escaped = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`(${escaped.join('|')})`, 'g');

  const parts = text.split(regex);
  const wordSet = new Set(words);

  return parts.map((part, i) => {
    if (wordSet.has(part)) {
      return (
        <span
          key={i}
          style={{
            color: '#dc2626',
            backgroundColor: 'rgba(254, 202, 202, 0.45)',
            borderRadius: 2,
            textDecoration: 'wavy underline #f87171',
            textUnderlineOffset: 3,
          }}
        >
          {part}
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

export default function LineNumberedTextarea({
  value, onChange, placeholder, className, errorLines, highlightWords,
}: LineNumberedTextareaProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const [lineHeights, setLineHeights] = useState<number[]>([]);

  const lines = value.split('\n');

  // 是否有任何需要高亮的信号词
  const hasHighlightWords = highlightWords && highlightWords.size > 0;

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
      lineDiv.style.fontFamily = FONT_FAMILY;
      lineDiv.textContent = line || '\u200b';
      mirror.appendChild(lineDiv);
      heights.push(lineDiv.offsetHeight);
    }

    setLineHeights(heights);
  }, [value]);

  useEffect(() => { measureLines(); }, [measureLines]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const ro = new ResizeObserver(() => { measureLines(); });
    ro.observe(textarea);
    return () => ro.disconnect();
  }, [measureLines]);

  // 同步滚动：textarea → 行号栏 + 叠加层
  const handleScroll = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (lineNumbersRef.current) lineNumbersRef.current.scrollTop = ta.scrollTop;
    if (overlayRef.current) overlayRef.current.scrollTop = ta.scrollTop;
  }, []);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const sync = () => {
      if (lineNumbersRef.current) lineNumbersRef.current.scrollTop = ta.scrollTop;
      if (overlayRef.current) overlayRef.current.scrollTop = ta.scrollTop;
    };
    ta.addEventListener('scroll', sync, { passive: true });
    return () => ta.removeEventListener('scroll', sync);
  }, []);

  const lineCount = lines.length;

  // 预计算每行是否有错误（整行标红 or 有高亮词）
  const lineFlags = useMemo(() => {
    return lines.map((_, i) => {
      const lineNum = i + 1;
      const hasLineError = errorLines?.has(lineNum) ?? false;
      const hasWordError = highlightWords?.has(lineNum) ?? false;
      return { hasLineError, hasWordError, hasAny: hasLineError || hasWordError };
    });
  }, [lines, errorLines, highlightWords]);

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
          position: 'absolute', top: -9999, left: -9999, visibility: 'hidden',
          whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          fontSize: `${FONT_SIZE}px`, lineHeight: `${LINE_HEIGHT}px`, fontFamily: FONT_FAMILY,
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
            const { hasAny } = lineFlags[i];
            return (
              <div
                key={i}
                className="font-mono flex items-start"
                style={{
                  height: lineHeights[i] || LINE_HEIGHT,
                  lineHeight: `${LINE_HEIGHT}px`,
                  fontSize: 12,
                  color: hasAny ? '#dc2626' : 'var(--muted)',
                  fontWeight: hasAny ? 600 : 400,
                  backgroundColor: hasAny ? '#fef2f2' : 'transparent',
                }}
              >
                <span className="ml-auto">{i + 1}</span>
              </div>
            );
          })}
          <div style={{ height: PADDING }} />
        </div>
      </div>

      {/* 编辑区容器 */}
      <div className="flex-1 relative min-h-0 min-w-0">
        {/* 文本渲染叠加层 — 显示带高亮的文字，和 textarea 完全重叠 */}
        <div
          ref={overlayRef}
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            overflowY: 'hidden',
            padding: PADDING,
            fontSize: FONT_SIZE,
            lineHeight: `${LINE_HEIGHT}px`,
            fontFamily: FONT_FAMILY,
            wordBreak: 'break-all',
            whiteSpace: 'pre-wrap',
            // 只有存在高亮词时才显示叠加层文字（textarea 文字会透明）
            color: hasHighlightWords ? 'var(--fg, #1a1a1a)' : 'transparent',
          }}
        >
          {lines.map((lineText, i) => {
            const lineNum = i + 1;
            const { hasLineError, hasWordError } = lineFlags[i];
            const words = highlightWords?.get(lineNum);

            // 行背景样式（LLM 逻辑校验整行标红）
            const bgStyle: React.CSSProperties = {
              minHeight: lineHeights[i] || LINE_HEIGHT,
              ...(hasLineError ? {
                backgroundColor: 'rgba(254, 202, 202, 0.35)',
                borderRadius: 2,
                marginLeft: -PADDING,
                marginRight: -PADDING,
                paddingLeft: PADDING,
                paddingRight: PADDING,
                borderLeft: '3px solid #f87171',
              } : {}),
            };

            return (
              <div key={i} style={bgStyle}>
                {words && words.length > 0
                  ? renderLineWithHighlights(lineText, words)
                  : (lineText || '\u200b')
                }
              </div>
            );
          })}
          <div style={{ height: PADDING }} />
        </div>

        {/* textarea — 存在高亮词时文字透明，光标可见 */}
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
            // 有高亮词时文字透明（由叠加层显示），否则正常显示
            color: hasHighlightWords ? 'transparent' : 'inherit',
          }}
        />
      </div>
    </div>
  );
}
