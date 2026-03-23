/**
 * 从 LLM 返回的文本中提取 JSON 对象
 * 支持多种格式：```json 包裹、```包裹、裸 JSON、带前后文字的 JSON、截断的 JSON
 */
export function extractJSON(text: string): any | null {
  if (!text?.trim()) return null;

  // 1. 标准 ```json ... ``` 格式（各种变体）
  const fencedPatterns = [
    /```json\s*\n([\s\S]*?)```/i,
    /```\s*\n([\s\S]*?)```/,
  ];
  for (const pattern of fencedPatterns) {
    const match = text.match(pattern);
    if (match) {
      const result = tryParse(match[1].trim());
      if (result !== null) return result;
    }
  }

  // 2. 没有结尾 ``` 的情况（LLM 输出被截断）
  //    匹配 ```json 开头，取后面所有内容
  const openFenceMatch = text.match(/```json\s*\n([\s\S]+)/i);
  if (openFenceMatch) {
    let content = openFenceMatch[1];
    // 去掉可能存在的结尾 ```
    content = content.replace(/```\s*$/, '');
    const result = tryParse(content.trim());
    if (result !== null) return result;
    // 尝试修复截断
    const fixed = tryFixTruncatedJSON(content.trim());
    if (fixed !== null) return fixed;
  }

  // 3. 直接尝试整个文本作为 JSON
  const directResult = tryParse(text.trim());
  if (directResult !== null) return directResult;

  // 4. 找到第一个 { 到最后一个 } 之间的内容
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const result = tryParse(text.substring(firstBrace, lastBrace + 1));
    if (result !== null) return result;
  }

  // 5. 清理 markdown 标记后再尝试
  const cleaned = text
    .replace(/^```(?:json)?\s*/gim, '')
    .replace(/```\s*$/gim, '')
    .trim();
  const cleanedResult = tryParse(cleaned);
  if (cleanedResult !== null) return cleanedResult;

  // 6. 从第一个 { 开始，尝试修复截断的 JSON
  if (firstBrace !== -1) {
    const fromBrace = text.substring(firstBrace);
    const fixed = tryFixTruncatedJSON(fromBrace);
    if (fixed !== null) return fixed;
  }

  return null;
}

/** 安全解析 JSON */
function tryParse(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * 尝试修复被截断的 JSON
 * 策略：找到最后一个完整的数组元素，截断后闭合 JSON
 */
function tryFixTruncatedJSON(text: string): any | null {
  // 尝试多个可能的数组字段名
  const arrayFields = ['"steps"', '"logicPoints"'];
  let arrayStart = -1;

  for (const field of arrayFields) {
    arrayStart = text.indexOf(field);
    if (arrayStart !== -1) break;
  }
  if (arrayStart === -1) return null;

  const bracketStart = text.indexOf('[', arrayStart);
  if (bracketStart === -1) return null;

  // 从数组开始位置，逐个找完整的 { } 对象
  let lastCompleteEnd = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = bracketStart + 1; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        lastCompleteEnd = i;
      }
    }
  }

  if (lastCompleteEnd === -1) return null;

  // 在最后一个完整对象后截断，闭合数组和外层对象
  const truncated = text.substring(0, lastCompleteEnd + 1);
  const fixed = text.substring(0, bracketStart + 1) +
    truncated.substring(bracketStart + 1) +
    ']}';

  const result = tryParse(fixed);
  if (result !== null) {
    if (result.steps && Array.isArray(result.steps)) {
      console.log(`[extractJSON] Fixed truncated JSON: recovered ${result.steps.length} steps`);
    }
    if (result.logicPoints && Array.isArray(result.logicPoints)) {
      result.totalPoints = result.logicPoints.length;
      console.log(`[extractJSON] Fixed truncated JSON: recovered ${result.totalPoints} logic points`);
    }
    return result;
  }

  return null;
}
