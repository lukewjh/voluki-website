import { getEnv } from "./env";
import { AI_SETTINGS_HEADER, validateAiSettings } from "./aiSettings";

export function resolveAiConfig(request: Request, locals: unknown) {
  const raw = request.headers.get(AI_SETTINGS_HEADER);
  if (raw !== null) {
    try {
      if (raw.length > 18000) throw new Error("AI 配置过长。");
      const settings = validateAiSettings(JSON.parse(decodeURIComponent(raw)));
      // Custom endpoints always use the user's own key, never a server secret.
      return { apiKey: settings.apiKey, model: settings.model, apiBaseUrl: settings.baseUrl };
    } catch (error) {
      return new Response(JSON.stringify({ error: error instanceof SyntaxError ? "AI 配置格式无效。" : error instanceof Error ? error.message : "AI 配置无效。" }), {
        status: 400, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
      });
    }
  }
  return {
    apiKey: getEnv(locals, "DEEPSEEK_API_KEY") ?? getEnv(locals, "OPENAI_API_KEY"),
    model: getEnv(locals, "OPENAI_MODEL") ?? "deepseek-v4-pro",
    apiBaseUrl: String(getEnv(locals, "AI_BASE_URL") ?? "https://api.deepseek.com").replace(/\/+$/, "")
  };
}
