export type AiSettings = { apiKey: string; model: string; baseUrl: string };

export const AI_SETTINGS_HEADER = "X-Voluki-AI-Settings";

// Shared validation for the settings form and the API boundary.
export function validateAiSettings(value: unknown): AiSettings {
  if (!value || typeof value !== "object") throw new Error("AI 配置格式无效。");
  const input = value as Record<string, unknown>;
  const field = (name: string, max: number) => {
    const value = input[name];
    if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) {
      throw new Error("请完整填写有效的 API Key、模型名称和 API Base URL。");
    }
    return value.trim();
  };
  const apiKey = field("apiKey", 2048);
  const model = field("model", 200);
  const baseUrl = field("baseUrl", 2048);
  if (!/^[\x21-\x7e]+$/.test(apiKey)) throw new Error("API Key 只能包含英文字符和符号。");
  let url: URL;
  try { url = new URL(baseUrl); } catch { throw new Error("请输入有效的 HTTPS API Base URL。"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      (url.port && url.port !== "443") || !url.hostname.includes(".") ||
      /^[\d.]+$/.test(url.hostname) || url.hostname.includes(":") ||
      /\.(localhost|local|internal|test|invalid|example)\.?$/i.test(url.hostname) || url.hostname.endsWith(".")) {
    throw new Error("API Base URL 必须是公开的 HTTPS 域名地址，不能包含账号、查询参数或非标准端口。");
  }
  return { apiKey, model, baseUrl: url.href.replace(/\/+$/, "").replace(/\/chat\/completions$/, "") };
}
