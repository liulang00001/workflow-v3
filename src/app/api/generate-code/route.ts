/**
 * API: JSON 工作流定义 → TypeScript 可执行代码
 */
import { NextRequest, NextResponse } from 'next/server';
import { workflowToCode } from '@/lib/json-to-code';
import { createLogSession } from '@/lib/logger';

export async function POST(request: NextRequest) {
  const log = createLogSession('generate-code');
  try {
    const { workflowDef } = await request.json();

    log.log('INFO', `Request — steps count=${workflowDef?.steps?.length ?? 'N/A'}`);
    log.dump('WORKFLOW_INPUT', JSON.stringify(workflowDef, null, 2));

    if (!workflowDef || !workflowDef.steps) {
      log.log('ERROR', 'Missing workflowDef or steps');
      return NextResponse.json({ success: false, error: '缺少工作流定义' }, { status: 400 });
    }

    const code = workflowToCode(workflowDef);

    log.log('INFO', `Code generated: ${code?.length ?? 0} chars`);
    log.dump('GENERATED_CODE', code || '(empty)');

    if (!code || code.length < 30) {
      log.log('ERROR', 'Generated code too short or empty');
      return NextResponse.json({ success: false, error: '生成的代码为空或过短' });
    }

    return NextResponse.json({ success: true, code });
  } catch (error) {
    log.log('ERROR', `Exception: ${String(error)}`);
    log.dump('ERROR_STACK', (error as Error).stack ?? 'no stack');
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
