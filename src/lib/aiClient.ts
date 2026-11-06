import { AI_SETTINGS_HEADER, validateAiSettings, type AiSettings } from "./aiSettings";

const storageKey = "voluki.ai-settings.v1";

export function readAiSettings(): AiSettings | null {
  const stored = sessionStorage.getItem(storageKey);
  return stored ? validateAiSettings(JSON.parse(stored)) : null;
}

export function saveAiSettings(settings: AiSettings | null) {
  if (settings) sessionStorage.setItem(storageKey, JSON.stringify(validateAiSettings(settings)));
  else sessionStorage.removeItem(storageKey);
}

export function aiRequestHeaders(): Record<string, string> {
  let settings;
  try { settings = readAiSettings(); } catch {
    throw new Error("无法读取 AI 配置，请打开顶部 AI 设置重新保存，或允许浏览器使用会话存储。");
  }
  return {
    "Content-Type": "application/json",
    ...(settings ? { [AI_SETTINGS_HEADER]: encodeURIComponent(JSON.stringify(settings)) } : {})
  };
}
