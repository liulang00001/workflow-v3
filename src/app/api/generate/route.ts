/**
 * API: 自然语言 → JSON 工作流定义（SSE 流式响应）
 */
import { getConfig } from '@/lib/config';
import { NextRequest } from 'next/server';
import { SYSTEM_PROMPT } from '@/lib/prompts';
import { extractJSON } from '@/lib/extract-json';

function sseChunk(data: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

export async function POST(request: NextRequest) {
  const { description, signals } = await request.json();

  const signalInfo = signals && signals.length > 0
    ? `\n\n可用信号：\n${signals.map((s: any) => `- ${s.name}: ${s.description}${s.values ? ' (' + Object.entries(s.values).map(([k, v]) => `${k}=${v}`).join(', ') + ')' : ''}`).join('\n')}`
    : '';

  const userPrompt = `${description}${signalInfo}`;
  const { apiKey, apiBase, model } = getConfig().llm;

  if (!apiKey) {
    return new Response(
      `data: ${JSON.stringify({ type: 'error', error: '未配置 LLM apiKey（请检查 config.json）' })}\n\n`,
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
    );
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(sseChunk({ type: 'progress', message: '正在连接 LLM...' }));

        const t0 = Date.now();
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
            stream: true,
          }),
        });

        if (!llmResponse.ok) {
          const errText = await llmResponse.text();
          controller.enqueue(sseChunk({ type: 'error', error: `LLM 调用失败: ${llmResponse.status} ${errText.substring(0, 200)}` }));
          controller.close();
          return;
        }

        controller.enqueue(sseChunk({ type: 'progress', message: 'LLM 开始输出...' }));

        const reader = llmResponse.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullContent = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const raw = trimmed.slice(5).trim();
            if (raw === '[DONE]') continue;
            try {
              const parsed = JSON.parse(raw);
              const delta = parsed.choices?.[0]?.delta?.content ?? '';
              if (delta) {
                fullContent += delta;
                controller.enqueue(sseChunk({ type: 'token', content: delta }));
              }
            } catch {
              // 忽略无法解析的 chunk
            }
          }
        }

        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        controller.enqueue(sseChunk({ type: 'progress', message: `LLM 完成（${elapsed}s），正在解析 JSON...` }));

        const workflowDef = extractJSON(fullContent);

        if (!workflowDef || !workflowDef.steps || !Array.isArray(workflowDef.steps)) {
          controller.enqueue(sseChunk({
            type: 'error',
            error: 'LLM 返回的工作流 JSON 格式无效',
            debug: fullContent.substring(0, 300),
          }));
          controller.close();
          return;
        }

        console.log(`[generate] Workflow generated: ${workflowDef.steps.length} steps, LLM耗时: ${elapsed}s`);
        controller.enqueue(sseChunk({ type: 'done', workflowDef }));
        controller.close();
      } catch (error) {
        controller.enqueue(sseChunk({ type: 'error', error: String(error) }));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
