/**
 * LLM 客户端封装 — 全局单例 + 请求队列 + 429 自动重试
 * 确保同一时间只有一个 LLM 请求在执行，避免触发速率限制
 */
import OpenAI from 'openai';
import { getConfig } from './config';

// === 全局请求队列 ===
let requestQueue: Array<{
  execute: () => Promise<void>;
  label: string;
}> = [];
let isProcessing = false;

async function processQueue() {
  if (isProcessing) return;
  isProcessing = true;

  while (requestQueue.length > 0) {
    const task = requestQueue.shift()!;
    console.log(`[llm-queue] Executing: ${task.label} (remaining: ${requestQueue.length})`);
    try {
      await task.execute();
    } catch (e) {
      console.error(`[llm-queue] Task failed: ${task.label}`, e);
    }
    // 请求间最小间隔 1 秒，避免连续请求触发限流
    if (requestQueue.length > 0) {
      await sleep(1000);
    }
  }

  isProcessing = false;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** 获取 OpenAI 客户端实例 */
export function getClient(): OpenAI {
  const { apiKey, apiBase } = getConfig().llm;
  return new OpenAI({ baseURL: apiBase, apiKey });
}

/**
 * 带 429 重试的非流式 LLM 调用
 */
export async function callLLMWithRetry(
  params: {
    instructions: string;
    input: Array<{ role: string; content: string }>;
    temperature?: number;
    max_output_tokens?: number;
  },
  options?: {
    maxRetries?: number;
    label?: string;
    onRetry?: (attempt: number, waitSec: number) => void;
  }
): Promise<{ output_text: string; usage?: any; status?: string }> {
  const { apiKey, apiBase, model } = getConfig().llm;
  const client = new OpenAI({ baseURL: apiBase, apiKey });
  const maxRetries = options?.maxRetries ?? 3;
  const label = options?.label ?? 'llm-call';

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await client.responses.create({
        model,
        instructions: params.instructions,
        input: params.input as any,
        temperature: params.temperature ?? 0.3,
        max_output_tokens: params.max_output_tokens ?? 8192,
      });
      return response as any;
    } catch (error: any) {
      const status = error?.status ?? error?.statusCode ?? 0;
      const isRateLimit = status === 429 || String(error).includes('429');

      if (isRateLimit && attempt < maxRetries) {
        // 指数退避: 5s, 15s, 45s
        const waitSec = Math.min(5 * Math.pow(3, attempt - 1), 60);
        console.log(`[${label}] 429 rate limit, retry ${attempt}/${maxRetries} after ${waitSec}s`);
        options?.onRetry?.(attempt, waitSec);
        await sleep(waitSec * 1000);
        continue;
      }
      throw error;
    }
  }
  throw new Error('Max retries exceeded');
}

/**
 * 带 429 重试的流式 LLM 调用
 * 返回 async iterable 的 stream
 */
export async function callLLMStreamWithRetry(
  params: {
    instructions: string;
    input: Array<{ role: string; content: string }>;
    temperature?: number;
    max_output_tokens?: number;
  },
  options?: {
    maxRetries?: number;
    label?: string;
    onRetry?: (attempt: number, waitSec: number) => void;
  }
): Promise<any> {
  const { apiKey, apiBase, model } = getConfig().llm;
  const client = new OpenAI({ baseURL: apiBase, apiKey });
  const maxRetries = options?.maxRetries ?? 3;
  const label = options?.label ?? 'llm-stream';

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const completion = await client.responses.create({
        model,
        instructions: params.instructions,
        input: params.input as any,
        temperature: params.temperature ?? 0.3,
        max_output_tokens: params.max_output_tokens ?? 16384,
        stream: true,
      });
      return completion;
    } catch (error: any) {
      const status = error?.status ?? error?.statusCode ?? 0;
      const isRateLimit = status === 429 || String(error).includes('429');

      if (isRateLimit && attempt < maxRetries) {
        const waitSec = Math.min(5 * Math.pow(3, attempt - 1), 60);
        console.log(`[${label}] 429 rate limit, retry ${attempt}/${maxRetries} after ${waitSec}s`);
        options?.onRetry?.(attempt, waitSec);
        await sleep(waitSec * 1000);
        continue;
      }
      throw error;
    }
  }
  throw new Error('Max retries exceeded');
}

/**
 * 排入全局队列执行（确保串行，不并发）
 */
export function enqueueRequest<T>(label: string, fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    requestQueue.push({
      label,
      execute: async () => {
        try {
          resolve(await fn());
        } catch (e) {
          reject(e);
        }
      },
    });
    processQueue();
  });
}
