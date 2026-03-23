/**
 * API: JSON 工作流定义 → TypeScript 可执行代码
 */
import { NextRequest, NextResponse } from 'next/server';
import { workflowToCode } from '@/lib/json-to-code';

export async function POST(request: NextRequest) {
  try {
    const { workflowDef } = await request.json();

    if (!workflowDef || !workflowDef.steps) {
      return NextResponse.json({ success: false, error: '缺少工作流定义' }, { status: 400 });
    }

    const code = workflowToCode(workflowDef);

    if (!code || code.length < 30) {
      return NextResponse.json({ success: false, error: '生成的代码为空或过短' });
    }

    console.log(`[generate-code] Code generated: ${code.length} chars`);

    return NextResponse.json({ success: true, code });
  } catch (error) {
    console.error('[generate-code] Error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
