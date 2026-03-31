import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'RDS SKILL HUB',
  description: '信号定义 → 逻辑校验 → 工作流 → 代码 → 执行',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
