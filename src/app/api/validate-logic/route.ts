/**
 * API: 逻辑校验 — 校验信号定义与分析步骤的一致性和合理性
 */
import { getConfig } from '@/lib/config';
import { NextRequest, NextResponse } from 'next/server';
import { createLogSession } from '@/lib/logger';
import { callLLMWithRetry } from '@/lib/llm-client';

const VALIDATE_PROMPT = `你是一个时序数据分析逻辑校验助手。用户会提供两部分输入：

1. **信号清单**：定义了所有可用的信号名称、描述和取值含义
2. **分析步骤**：用自然语言描述的分析逻辑流程

你需要完成以下校验任务：

## 校验任务 1: 信号引用检查
检查分析步骤中引用的每个信号名是否都在信号清单中定义过。
- 如果有未定义的信号，列出信号名并标记为错误
- 如果信号名疑似拼写错误（与某个已定义信号相似），给出建议

## 校验任务 2: 逻辑完整性检查
检查分析步骤的逻辑是否完整合理：
- 是否存在缺失的逻辑分支（比如只处理了条件为真的情况，没处理为假的情况）
- 是否存在死循环或无法到达的步骤
- 条件判断是否使用了信号清单中定义的合法取值
- 步骤之间的跳转/依赖关系是否正确

## 校验任务 3: 工作流生成适配性检查
检查分析步骤是否适合转化为自动化工作流：
- 步骤描述是否足够清晰明确（而非模糊的自然语言）
- 条件表达式是否可以映射到具体的信号比较操作
- 是否缺少必要的阈值、时间窗口等参数
- 给出优化建议，使步骤描述更适合自动生成工作流

## 输出格式

返回一个 JSON 对象（用 \`\`\`json 包裹）：

\`\`\`json
{
  "signalCheck": {
    "passed": true/false,
    "issues": [
      { "signal": "信号名", "message": "问题描述", "suggestion": "建议（可选）" }
    ]
  },
  "logicCheck": {
    "passed": true/false,
    "issues": [
      { "step": "步骤标识", "type": "missing_branch|unreachable|invalid_value|dependency_error", "message": "问题描述" }
    ]
  },
  "adaptabilityCheck": {
    "passed": true/false,
    "issues": [
      { "step": "步骤标识", "type": "vague_description|missing_param|unmappable", "message": "问题描述", "suggestion": "优化建议" }
    ]
  },
  "summary": "总体评价（1-2句话）",
  "optimizedSteps": "优化后的分析步骤文本（如果有改进建议的话）"
}
\`\`\`

只输出 JSON，不要输出其他解释文字。
`;

export async function POST(request: NextRequest) {
  const log = createLogSession('validate');
  try {
    const { signals, steps } = await request.json();
    log.log('INFO', `Request — signals length=${signals?.length ?? 0}, steps length=${steps?.length ?? 0}`);
    log.dump('SIGNALS_INPUT', signals || '(empty)');
    log.dump('STEPS_INPUT', steps || '(empty)');

    if (!signals?.trim() && !steps?.trim()) {
      log.log('WARN', 'Empty input, returning error');
      return NextResponse.json({ success: false, error: '请至少填写信号清单或分析步骤' });
    }

    const { apiKey } = getConfig().llm;

    if (!apiKey) {
      return NextResponse.json({ success: false, error: '未配置 LLM apiKey（请检查 config.json）' });
    }

    const userMessage = `## 信号清单\n\n${signals || '（未提供）'}\n\n## 分析步骤\n\n${steps || '（未提供）'}`;
    log.dump('USER_MESSAGE', userMessage);

    const t0 = Date.now();
    const response = await callLLMWithRetry(
      {
        instructions: VALIDATE_PROMPT,
        input: [{ role: 'user', content: userMessage }],
        temperature: 0.2,
        max_output_tokens: 15000,
      },
      {
        maxRetries: 3,
        label: 'validate',
        onRetry: (attempt, waitSec) => {
          log.log('WARN', `429 rate limit, retry ${attempt} after ${waitSec}s`);
        },
      }
    );

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const content = response.output_text;
    log.log('INFO', `LLM completed in ${elapsed}s, output length=${content.length}`);
    log.dump('LLM_OUTPUT', content);

    // 提取 JSON
    const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) || content.match(/(\{[\s\S]*\})/);
    if (!jsonMatch) {
      log.log('ERROR', 'No JSON found in LLM output');
      return NextResponse.json({ success: false, error: 'LLM 返回格式无效', raw: content });
    }

    log.log('INFO', `JSON extracted, length=${jsonMatch[1].length}`);
    const result = JSON.parse(jsonMatch[1]);
    log.log('INFO', 'JSON parsed successfully');
    log.dump('PARSED_RESULT', JSON.stringify(result, null, 2));

    return NextResponse.json({ success: true, result });
  } catch (error) {
    log.log('ERROR', `Exception: ${String(error)}`);
    log.dump('ERROR_STACK', (error as Error).stack ?? 'no stack');
    return NextResponse.json({ success: false, error: String(error) });
  }
}
