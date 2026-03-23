/**
 * API: 读取单个脚本
 * GET /api/scripts/[name] - 读取脚本内容
 */
import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const SCRIPTS_DIR = join(process.cwd(), 'scripts');

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    const filePath = join(SCRIPTS_DIR, `${name}.ts`);

    if (!existsSync(filePath)) {
      return NextResponse.json({ success: false, error: '脚本不存在' }, { status: 404 });
    }

    const code = readFileSync(filePath, 'utf-8');
    return NextResponse.json({ success: true, code });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) });
  }
}
