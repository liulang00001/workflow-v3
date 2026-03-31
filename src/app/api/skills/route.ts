/**
 * API: 管理保存的 Skill（完整工作流快照）
 * GET    - 列出所有已保存的 skill
 * POST   - 保存新 skill
 * DELETE - 删除 skill
 */
import { NextRequest, NextResponse } from 'next/server';
import { readdirSync, writeFileSync, readFileSync, mkdirSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';

const SKILLS_DIR = join(process.cwd(), 'skills');

function ensureDir() {
  mkdirSync(SKILLS_DIR, { recursive: true });
}

export async function GET() {
  try {
    ensureDir();
    const files = readdirSync(SKILLS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const filePath = join(SKILLS_DIR, f);
        const stat = statSync(filePath);
        const content = JSON.parse(readFileSync(filePath, 'utf-8'));
        return {
          name: content.name || f.replace(/\.json$/, ''),
          fileName: f,
          updatedAt: stat.mtime.toISOString(),
          size: stat.size,
          description: content.description || '',
        };
      })
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    return NextResponse.json({ success: true, skills: files });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) });
  }
}

export async function POST(request: NextRequest) {
  try {
    ensureDir();
    const body = await request.json();
    const { name, signalsDef, analyzeSteps, workflowDef, code, description, validationResult } = body;

    if (!name) {
      return NextResponse.json({ success: false, error: '缺少名称' });
    }

    const safeName = name.replace(/[<>:"/\\|?*]/g, '_').trim();
    if (!safeName) {
      return NextResponse.json({ success: false, error: '无效的名称' });
    }

    const skillData = {
      name: safeName,
      description: description || '',
      signalsDef: signalsDef || '',
      analyzeSteps: analyzeSteps || '',
      workflowDef: workflowDef || null,
      code: code || '',
      validationResult: validationResult || null,
      savedAt: new Date().toISOString(),
    };

    const filePath = join(SKILLS_DIR, `${safeName}.json`);
    writeFileSync(filePath, JSON.stringify(skillData, null, 2), 'utf-8');

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

    const filePath = join(SKILLS_DIR, `${name}.json`);
    unlinkSync(filePath);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) });
  }
}
