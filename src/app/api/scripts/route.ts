/**
 * API: 管理保存的分析脚本
 * GET  - 列出所有已保存的脚本
 * POST - 保存新脚本
 */
import { NextRequest, NextResponse } from 'next/server';
import { readdirSync, writeFileSync, readFileSync, mkdirSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';

const SCRIPTS_DIR = join(process.cwd(), 'scripts');

function ensureDir() {
  mkdirSync(SCRIPTS_DIR, { recursive: true });
}

export async function GET() {
  try {
    ensureDir();
    const files = readdirSync(SCRIPTS_DIR)
      .filter(f => f.endsWith('.ts'))
      .map(f => {
        const filePath = join(SCRIPTS_DIR, f);
        const stat = statSync(filePath);
        return {
          name: f.replace(/\.ts$/, ''),
          fileName: f,
          updatedAt: stat.mtime.toISOString(),
          size: stat.size,
        };
      })
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    return NextResponse.json({ success: true, scripts: files });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) });
  }
}

export async function POST(request: NextRequest) {
  try {
    ensureDir();
    const { name, code } = await request.json();

    if (!name || !code) {
      return NextResponse.json({ success: false, error: '缺少名称或代码' });
    }

    // 清理文件名
    const safeName = name.replace(/[<>:"/\\|?*]/g, '_').trim();
    if (!safeName) {
      return NextResponse.json({ success: false, error: '无效的文件名' });
    }

    const filePath = join(SCRIPTS_DIR, `${safeName}.ts`);
    writeFileSync(filePath, code, 'utf-8');

    return NextResponse.json({ success: true, name: safeName });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { name } = await request.json();
    if (!name) {
      return NextResponse.json({ success: false, error: '缺少名称' });
    }

    const filePath = join(SCRIPTS_DIR, `${name}.ts`);
    unlinkSync(filePath);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) });
  }
}
