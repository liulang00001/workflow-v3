import fs from 'fs';
import path from 'path';

interface AppConfig {
  llm: {
    apiKey: string;
    apiBase: string;
    model: string;
  };
}

function loadConfig(): AppConfig {
  const configPath = path.join(process.cwd(), 'config.json');
  const raw = fs.readFileSync(configPath, 'utf-8');
  return JSON.parse(raw);
}

// 缓存，避免每次请求都读文件
let _config: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}
