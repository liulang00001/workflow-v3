/**
 * API: 自然语言 → JSON 工作流定义
 */
import { getConfig } from '@/lib/config';
import { NextRequest, NextResponse } from 'next/server';
import { SYSTEM_PROMPT } from '@/lib/prompts';
import { extractJSON } from '@/lib/extract-json';

export async function POST(request: NextRequest) {
  try {
    const { description, signals } = await request.json();

    // 构建 user prompt
    const signalInfo = signals && signals.length > 0
      ? `\n\n可用信号：\n${signals.map((s: any) => `- ${s.name}: ${s.description}${s.values ? ' (' + Object.entries(s.values).map(([k, v]) => `${k}=${v}`).join(', ') + ')' : ''}`).join('\n')}`
      : '';

    const userPrompt = `${description}${signalInfo}`;

    const { apiKey, apiBase, model } = getConfig().llm;

    if (!apiKey) {
      return NextResponse.json({ success: false, error: '未配置 LLM apiKey（请检查 config.json）' }, { status: 500 });
    }

    const t0 = Date.now();
    console.log('[generate] Calling LLM for workflow JSON...');
    const llmResponse = await fetch(`${apiBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 8192,
      }),
    });

    if (!llmResponse.ok) {
      const errText = await llmResponse.text();
      console.error('[generate] LLM error:', errText);
      return NextResponse.json({ success: false, error: `LLM 调用失败: ${llmResponse.status}` }, { status: 502 });
    }

    const llmData = await llmResponse.json();
    const aiContent = llmData.choices?.[0]?.message?.content || '';

    // 提取 JSON
    const workflowDef = extractJSON(aiContent);

    if (!workflowDef || !workflowDef.steps || !Array.isArray(workflowDef.steps)) {
      console.error('[generate] Invalid workflow JSON:', aiContent.substring(0, 500));
      return NextResponse.json({
        success: false,
        error: 'LLM 返回的工作流 JSON 格式无效',
        debug: { preview: aiContent.substring(0, 300) },
      });
    }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[generate] Workflow generated: ${workflowDef.steps.length} steps, LLM耗时: ${elapsed}s`);

    return NextResponse.json({ success: true, workflowDef });
  } catch (error) {
    console.error('[generate] Error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
