import type { APIRoute } from "astro";
import { resolveAiConfig } from "../../../lib/aiConfig";

export const prerender = false;

const fail = (error: string, status: number) =>
  Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

export const POST: APIRoute = async ({ request, locals }) => {
  const config = resolveAiConfig(request, locals);
  if (config instanceof Response) return config;
  if (!config.apiKey) return fail("请先在顶部 AI 设置中配置模型。", 400);

  const body = await request.json().catch(() => null);
  if (typeof body?.idiom !== "string" || !body.idiom.trim() || body.idiom.length > 500 ||
      !["open", "reply", "hint"].includes(body.action) || !Array.isArray(body.history) ||
      body.history.length > 16) return fail("对话请求格式不正确。", 400);

  const history: { role: "user" | "assistant"; content: string }[] = [];
  for (const turn of body.history) {
    if (!["user", "assistant"].includes(turn?.role) || typeof turn.content !== "string" ||
        !turn.content.trim() || turn.content.length > 4000) return fail("对话消息无效。", 400);
    history.push({ role: turn.role, content: turn.content.trim() });
  }
  const last = history.at(-1);
  if ((body.action === "open" && history.length) ||
      (body.action === "reply" && last?.role !== "user") ||
      (body.action === "hint" && last?.role !== "assistant")) return fail("对话轮次不正确。", 400);

  const messages = [
    { role: "system", content: "Have friendly everyday small talk in English with a language learner. Use the target idiom naturally in the opening, in an everyday situation, with an easy question. Follow their replies, gently recast mistakes, and give them a chance to use the idiom without forcing it. Use one or two short sentences and at most one question per turn. Plain text only." },
    { role: "user", content: "Start our conversation about this idiom: " + JSON.stringify(body.idiom.trim()) },
    ...history
  ];
  if (body.action === "hint") messages.push({ role: "user", content: "Help me reply to your last message. Give me only one unfinished English sentence starter in my voice, ending in an ellipsis." });

  const { apiBaseUrl, apiKey, model } = config;
  const fast = /^https:\/\/api\.deepseek\.com(?:\/v1)?$/i.test(apiBaseUrl) &&
    /^(?:deepseek-v4-(?:pro|flash)|deepseek-chat|deepseek-flash)$/i.test(model);
  try {
    const upstream = await fetch(apiBaseUrl + "/chat/completions", {
      method: "POST", redirect: "manual", signal: request.signal,
      headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: true, max_tokens: fast ? 256 : 2048,
        ...(fast ? { thinking: { type: "disabled" } } : {}) })
    });
    if (!upstream.ok || !upstream.body || !upstream.headers.get("content-type")?.includes("text/event-stream")) {
      await upstream.body?.cancel();
      if ([401, 403].includes(upstream.status)) return fail("AI 服务拒绝了请求，请检查 AI 设置。", upstream.status);
      if (upstream.status === 429) return fail("AI 服务暂时限流，请稍后重试。", 429);
      return fail("AI 服务未返回对话流，请检查模型配置或重试。", 502);
    }
    return new Response(upstream.body, { headers: {
      "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform"
    } });
  } catch {
    return fail("无法连接 AI 服务，请稍后重试。", 502);
  }
};
