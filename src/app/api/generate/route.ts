/**
 * API: 自然语言 → JSON 工作流定义（SSE 流式响应）
 *
 * 包含以下保护机制：
 * 1. 429 自动重试（连接阶段）
 * 2. 流中断检测 + 自动重试（消费阶段）
 * 3. JSON 截断修复
 * 4. 完整的文件日志
 */
import { getConfig } from '@/lib/config';
import { NextRequest } from 'next/server';
import { SYSTEM_PROMPT } from '@/lib/prompts';
import { extractJSON } from '@/lib/extract-json';
import { createLogSession } from '@/lib/logger';
import { callLLMStreamWithRetry } from '@/lib/llm-client';

function sseChunk(data: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

/** 消费一次完整的 LLM 流，返回收集到的内容和元信息 */
async function consumeStream(
  completion: any,
  log: ReturnType<typeof createLogSession>,
): Promise<{
  fullContent: string;
  tokenCount: number;
  gotCompleted: boolean;
  llmStatus: string;
  llmIncompleteReason: string;
  outputTokens: number;
  inputTokens: number;
  lastEventType: string;
  collectedTokens: string[];
}> {
  let fullContent = '';
  let tokenCount = 0;
  let llmStatus = 'unknown';
  let llmIncompleteReason = '';
  let outputTokens = 0;
  let inputTokens = 0;
  let gotCompleted = false;
  let lastEventType = '';
  const collectedTokens: string[] = [];

  for await (const event of completion) {
    lastEventType = event.type;

    if (event.type === 'response.output_text.delta') {
      const delta = event.delta ?? '';
      if (delta) {
        fullContent += delta;
        tokenCount++;
        collectedTokens.push(delta);
      }
    } else if (event.type === 'response.completed') {
      gotCompleted = true;
      const resp = (event as any).response;
      llmStatus = resp?.status ?? 'unknown';
      log.log('INFO', `response.completed — status: ${llmStatus}`);
      if (resp?.incomplete_details) {
        llmIncompleteReason = resp.incomplete_details.reason ?? 'unknown';
        log.log('WARN', `INCOMPLETE — reason: ${llmIncompleteReason}`);
      }
      if (resp?.usage) {
        inputTokens = resp.usage.input_tokens ?? 0;
        outputTokens = resp.usage.output_tokens ?? 0;
        log.log('INFO', `Token usage — input: ${inputTokens}, output: ${outputTokens}`);
      }
    } else {
      log.log('DEBUG', `Stream event: ${event.type}`);
    }
  }

  return { fullContent, tokenCount, gotCompleted, llmStatus, llmIncompleteReason, outputTokens, inputTokens, lastEventType, collectedTokens };
}

export async function POST(request: NextRequest) {
  const log = createLogSession('generate');
  const { description, signals } = await request.json();

  log.log('INFO', `Request — desc=${description?.length ?? 0} chars, signals=${signals?.length ?? 0}`);
  log.dump('USER_DESCRIPTION', description || '(empty)');

  const signalInfo = signals && signals.length > 0
    ? `\n\n可用信号：\n${signals.map((s: any) => `- ${s.name}: ${s.description}${s.values ? ' (' + Object.entries(s.values).map(([k, v]) => `${k}=${v}`).join(', ') + ')' : ''}`).join('\n')}`
    : '';

  const userPrompt = `${description}${signalInfo}`;
  log.dump('FULL_USER_PROMPT', userPrompt);

  const { apiKey, apiBase, model } = getConfig().llm;
  log.log('INFO', `LLM config — model=${model}, apiBase=${apiBase}`);

  if (!apiKey) {
    log.log('ERROR', 'No apiKey configured');
    return new Response(
      `data: ${JSON.stringify({ type: 'error', error: '未配置 LLM apiKey（请检查 config.json）' })}\n\n`,
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
    );
  }

  const MAX_STREAM_RETRIES = 3;
  const MIN_VALID_LENGTH = 200; // 有效输出的最小字符数

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const t0 = Date.now();

        for (let streamAttempt = 1; streamAttempt <= MAX_STREAM_RETRIES; streamAttempt++) {
          if (streamAttempt > 1) {
            const waitSec = 3 * streamAttempt;
            log.log('WARN', `Stream retry ${streamAttempt}/${MAX_STREAM_RETRIES}, waiting ${waitSec}s...`);
            controller.enqueue(sseChunk({
              type: 'progress',
              message: `⚠ LLM 输出中断，${waitSec}秒后第${streamAttempt}次重试...`,
            }));
            await new Promise(r => setTimeout(r, waitSec * 1000));
          }

          controller.enqueue(sseChunk({ type: 'progress', message: streamAttempt === 1 ? '正在连接 LLM...' : `正在重新连接 LLM（第${streamAttempt}次）...` }));
          log.log('INFO', `Stream attempt ${streamAttempt}/${MAX_STREAM_RETRIES}`);

          let completion;
          try {
            completion = await callLLMStreamWithRetry(
              {
                instructions: SYSTEM_PROMPT,
                input: [{ role: 'user', content: userPrompt }],
                temperature: 0.3,
                max_output_tokens: 16384,
              },
              {
                maxRetries: 3,
                label: `generate-attempt${streamAttempt}`,
                onRetry: (attempt, waitSec) => {
                  log.log('WARN', `429 rate limit, retry ${attempt} after ${waitSec}s`);
                  controller.enqueue(sseChunk({
                    type: 'progress',
                    message: `⚠ 触发速率限制，${waitSec}秒后重试...`,
                  }));
                },
              }
            );
          } catch (connectErr) {
            log.log('ERROR', `Stream connect failed: ${String(connectErr)}`);
            if (streamAttempt === MAX_STREAM_RETRIES) throw connectErr;
            continue;
          }

          controller.enqueue(sseChunk({ type: 'progress', message: 'LLM 开始输出...' }));
          log.log('INFO', 'LLM stream started');

          // 消费流并实时转发 tokens
          let result;
          try {
            // 边消费边转发（不能用 consumeStream 因为需要实时转发）
            let fullContent = '';
            let tokenCount = 0;
            let llmStatus = 'unknown';
            let llmIncompleteReason = '';
            let outputTokens = 0;
            let inputTokens = 0;
            let gotCompleted = false;
            let lastEventType = '';

            for await (const event of completion) {
              lastEventType = event.type;

              if (event.type === 'response.output_text.delta') {
                const delta = event.delta ?? '';
                if (delta) {
                  fullContent += delta;
                  tokenCount++;
                  controller.enqueue(sseChunk({ type: 'token', content: delta }));
                }
              } else if (event.type === 'response.completed') {
                gotCompleted = true;
                const resp = (event as any).response;
                llmStatus = resp?.status ?? 'unknown';
                log.log('INFO', `response.completed — status: ${llmStatus}`);
                if (resp?.incomplete_details) {
                  llmIncompleteReason = resp.incomplete_details.reason ?? 'unknown';
                  log.log('WARN', `INCOMPLETE — reason: ${llmIncompleteReason}`);
                }
                if (resp?.usage) {
                  inputTokens = resp.usage.input_tokens ?? 0;
                  outputTokens = resp.usage.output_tokens ?? 0;
                  log.log('INFO', `Token usage — input: ${inputTokens}, output: ${outputTokens}`);
                }
              } else {
                log.log('DEBUG', `Stream event: ${event.type}`);
              }
            }

            result = { fullContent, tokenCount, gotCompleted, llmStatus, llmIncompleteReason, outputTokens, inputTokens, lastEventType };
          } catch (streamErr) {
            log.log('ERROR', `Stream consumption error: ${String(streamErr)}`);
            if (streamAttempt === MAX_STREAM_RETRIES) throw streamErr;
            continue;
          }

          const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
          log.log('INFO', `Stream ended — attempt=${streamAttempt}, elapsed=${elapsed}s, tokens=${result.tokenCount}, chars=${result.fullContent.length}, gotCompleted=${result.gotCompleted}, lastEvent=${result.lastEventType}`);
          log.dump('LLM_FULL_OUTPUT', result.fullContent);

          // === 检测流是否异常中断 ===
          if (result.fullContent.length < MIN_VALID_LENGTH && !result.gotCompleted) {
            log.log('WARN', `Stream ABORTED — only ${result.fullContent.length} chars, no completed event`);
            if (streamAttempt < MAX_STREAM_RETRIES) {
              // 清除前端已显示的部分 token，重试
              controller.enqueue(sseChunk({
                type: 'progress',
                message: `⚠ LLM 仅输出 ${result.fullContent.length} 字符后中断，准备重试...`,
              }));
              continue; // 重试
            }
            // 最后一次也失败了
            controller.enqueue(sseChunk({
              type: 'error',
              error: `LLM 流式输出反复中断（${MAX_STREAM_RETRIES}次尝试均失败，最后仅输出 ${result.fullContent.length} 字符）。可能原因：模型服务不稳定。请稍后重试。`,
              debug: result.fullContent,
              logFile: log.filePath,
            }));
            controller.close();
            return;
          }

          // === 流输出正常，继续解析 ===
          const isTruncated = result.llmStatus === 'incomplete' || result.llmIncompleteReason === 'max_output_tokens';
          if (isTruncated) {
            log.log('WARN', `Output TRUNCATED (status=${result.llmStatus}, reason=${result.llmIncompleteReason}, output_tokens=${result.outputTokens})`);
            controller.enqueue(sseChunk({
              type: 'progress',
              message: `⚠ LLM 输出被截断（已用 ${result.outputTokens} tokens），尝试修复...`,
            }));
          }

          controller.enqueue(sseChunk({
            type: 'progress',
            message: `LLM 完成（${elapsed}s, ${result.outputTokens || result.tokenCount} tokens），正在解析 JSON...`,
          }));

          // 检查输出末尾
          const trimmed = result.fullContent.trim();
          const endsWithClose = trimmed.endsWith('}') || trimmed.endsWith('```');
          log.log('INFO', `Ends with closing: ${endsWithClose}, last 100: ${trimmed.substring(Math.max(0, trimmed.length - 100)).replace(/\n/g, '\\n')}`);

          const workflowDef = extractJSON(result.fullContent, log);

          if (!workflowDef || !workflowDef.steps || !Array.isArray(workflowDef.steps)) {
            log.log('ERROR', `extractJSON failed: ${workflowDef === null ? 'null' : JSON.stringify(Object.keys(workflowDef))}`);

            // 如果是截断导致的且内容较多，还可以再试
            if (!isTruncated && streamAttempt < MAX_STREAM_RETRIES && result.fullContent.length < 500) {
              log.log('WARN', 'Output too short and unparseable, retrying...');
              controller.enqueue(sseChunk({
                type: 'progress',
                message: `⚠ LLM 输出不完整（${result.fullContent.length} 字符），准备重试...`,
              }));
              continue;
            }

            const errorMsg = isTruncated
              ? `LLM 输出被截断（${result.outputTokens} tokens 达到上限），JSON 无法修复。请简化分析步骤。`
              : `LLM 返回的工作流 JSON 格式无效（${result.fullContent.length} 字符），详见日志`;
            controller.enqueue(sseChunk({
              type: 'error',
              error: errorMsg,
              debug: result.fullContent.substring(0, 500),
              logFile: log.filePath,
            }));
            controller.close();
            return;
          }

          // === 成功！===
          if (isTruncated) {
            log.log('INFO', `Truncated output RECOVERED — ${workflowDef.steps.length} steps`);
            controller.enqueue(sseChunk({
              type: 'progress',
              message: `✓ 截断修复成功，恢复了 ${workflowDef.steps.length} 个步骤（可能不完整）`,
            }));
          }

          log.log('INFO', `SUCCESS — ${workflowDef.steps.length} steps, name="${workflowDef.name}", attempt=${streamAttempt}`);
          log.dump('PARSED_WORKFLOW', JSON.stringify(workflowDef, null, 2));

          console.log(`[generate] ✓ ${workflowDef.steps.length} steps, ${elapsed}s, attempt=${streamAttempt}, log=${log.filePath}`);
          controller.enqueue(sseChunk({ type: 'done', workflowDef }));
          controller.close();
          return; // 成功退出
        }

        // 不应该到这里，但以防万一
        controller.enqueue(sseChunk({ type: 'error', error: '所有重试均失败' }));
        controller.close();
      } catch (error) {
        log.log('ERROR', `Exception: ${String(error)}`);
        log.dump('ERROR_STACK', (error as Error).stack ?? 'no stack');
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
