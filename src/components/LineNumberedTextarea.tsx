'use client';

import { useRef, useCallback, useEffect, useState } from 'react';

interface LineNumberedTextareaProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

const LINE_HEIGHT = 22;
const FONT_SIZE = 14;
const PADDING = 12;

export default function LineNumberedTextarea({ value, onChange, placeholder, className }: LineNumberedTextareaProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const [lineHeights, setLineHeights] = useState<number[]>([]);

  const lines = value.split('\n');

  // 用 mirror div 测量每一行的实际渲染高度（含软换行）
  const measureLines = useCallback(() => {
    const mirror = mirrorRef.current;
    const textarea = textareaRef.current;
    if (!mirror || !textarea) return;

    // mirror 宽度必须和 textarea 内容区一致
    const style = window.getComputedStyle(textarea);
    const width = textarea.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    mirror.style.width = `${width}px`;

    const currentLines = value.split('\n');
    const heights: number[] = [];

    // 清空 mirror，逐行测量
    mirror.innerHTML = '';
    for (const line of currentLines) {
      const lineDiv = document.createElement('div');
      lineDiv.style.whiteSpace = 'pre-wrap';
      lineDiv.style.wordBreak = 'break-all';
      lineDiv.style.fontSize = `${FONT_SIZE}px`;
      lineDiv.style.lineHeight = `${LINE_HEIGHT}px`;
      lineDiv.style.fontFamily = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';
      // 空行也要有高度
      lineDiv.textContent = line || '\u200b';
      mirror.appendChild(lineDiv);
      heights.push(lineDiv.offsetHeight);
    }

    setLineHeights(heights);
  }, [value]);

  // 初始测量 + value/容器尺寸变化时重新测量
  useEffect(() => {
    measureLines();
  }, [measureLines]);

  // 监听容器宽度变化（窗口缩放、拖拽分割线等）
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const ro = new ResizeObserver(() => {
      measureLines();
    });
    ro.observe(textarea);
    return () => ro.disconnect();
  }, [measureLines]);

  // 同步滚动：textarea → 行号栏
  const handleScroll = useCallback(() => {
    if (textareaRef.current && lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  }, []);

  // 兜底：原生 scroll 事件监听
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const sync = () => {
      if (lineNumbersRef.current) {
        lineNumbersRef.current.scrollTop = ta.scrollTop;
      }
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
          {lines.map((_, i) => (
            <div
              key={i}
              className="text-[var(--muted)] font-mono flex items-start"
              style={{
                height: lineHeights[i] || LINE_HEIGHT,
                lineHeight: `${LINE_HEIGHT}px`,
                fontSize: 12,
              }}
            >
              <span className="ml-auto">{i + 1}</span>
            </div>
          ))}
          <div style={{ height: PADDING }} />
        </div>
      </div>

      {/* 编辑区 */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        onScroll={handleScroll}
        placeholder={placeholder}
        className="flex-1 resize-none bg-transparent font-mono outline-none min-h-0"
        style={{
          padding: PADDING,
          fontSize: FONT_SIZE,
          lineHeight: `${LINE_HEIGHT}px`,
          overflowY: 'auto',
          wordBreak: 'break-all',
        }}
      />
    </div>
  );
}
