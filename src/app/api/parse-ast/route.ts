/**
 * API: TypeScript 代码 → 流程图（AST 解析）
 */
import { NextRequest, NextResponse } from 'next/server';
import { parseCodeToFlowChart } from '@/lib/ast-parser';

export async function POST(request: NextRequest) {
  try {
    const { code } = await request.json();

    if (!code) {
      return NextResponse.json({ success: false, error: '代码为空' });
    }

    console.log(`[parse-ast] Parsing ${code.length} chars...`);
    const flowChart = parseCodeToFlowChart(code);
    console.log(`[parse-ast] Generated ${flowChart.nodes.length} nodes, ${flowChart.edges.length} edges`);

    return NextResponse.json({ success: true, flowChart });
  } catch (error) {
    console.error('[parse-ast] Error:', error);
    return NextResponse.json({
      success: false,
      error: `AST 解析失败: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
