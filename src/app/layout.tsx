import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Workflow Analyzer V2',
  description: '自然语言 → 代码 → 流程图 → 执行',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
