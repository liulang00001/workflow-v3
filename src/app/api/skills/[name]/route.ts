/**
 * API: 读取单个 Skill
 * GET /api/skills/[name] - 读取完整 skill 数据
 */
import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const SKILLS_DIR = join(process.cwd(), 'skills');

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    const filePath = join(SKILLS_DIR, `${name}.json`);

    if (!existsSync(filePath)) {
      return NextResponse.json({ success: false, error: 'Skill 不存在' }, { status: 404 });
    }

    const raw = readFileSync(filePath, 'utf-8');
    const skill = JSON.parse(raw);
    return NextResponse.json({ success: true, skill });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) });
  }
}
