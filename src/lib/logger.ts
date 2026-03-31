/**
 * 文件日志工具 — 将调试信息写入 logs/ 目录
 * 每次 API 调用生成独立日志文件，方便排查问题
 */
import fs from 'fs';
import path from 'path';

const LOGS_DIR = path.join(process.cwd(), 'logs');

function ensureLogsDir() {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export interface LogSession {
  /** 追加一行日志 */
  log(level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', message: string): void;
  /** 追加大段内容（如 LLM 完整输出） */
  dump(label: string, content: string): void;
  /** 获取日志文件路径 */
  filePath: string;
}

/**
 * 创建一个日志会话，所有内容写入同一个文件
 * @param prefix 文件名前缀，如 "generate" / "validate"
 */
export function createLogSession(prefix: string): LogSession {
  ensureLogsDir();
  const ts = timestamp();
  const fileName = `${prefix}_${ts}.log`;
  const filePath = path.join(LOGS_DIR, fileName);

  // 写入文件头
  fs.writeFileSync(filePath, `=== ${prefix.toUpperCase()} LOG ===\nTime: ${new Date().toISOString()}\n\n`, 'utf-8');

  return {
    filePath,
    log(level, message) {
      const line = `[${new Date().toISOString()}] [${level}] ${message}\n`;
      fs.appendFileSync(filePath, line, 'utf-8');
    },
    dump(label, content) {
      const section = `\n--- ${label} (${content.length} chars) ---\n${content}\n--- END ${label} ---\n\n`;
      fs.appendFileSync(filePath, section, 'utf-8');
    },
  };
}
