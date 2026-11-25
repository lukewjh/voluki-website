import type { APIRoute } from "astro";
import { resolveAiConfig } from "../../../lib/aiConfig";
import { rioLists, type RioType } from "../../../lib/rioMaterials";

export const prerender = false;

const fail = (error: string, status: number) =>
  Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

const usage: Record<RioType, string> = {
  vocabulary: "Use the word in one common sense and make its meaning clear through the situation.",
  chunk: "Use the phrase as a natural collocation, filling any variable slots and inflecting it as needed.",
  idiom: "Use the idiom naturally so the situation makes its figurative meaning clear.",
  sentence_pattern: "Instantiate the sentence pattern with your own words and ask a question that invites a reply using the same structure.",
  adverb: "Use the adverb in a context that makes its effect on tone, emphasis, or meaning clear."
};

export const POST: APIRoute = async ({ request, locals }) => {
  const config = resolveAiConfig(request, locals);
  if (config instanceof Response) return config;
  if (!config.apiKey) return fail("请先在顶部 AI 设置中配置模型。", 400);

  const body = await request.json().catch(() => null);
  const material = body?.material ?? { type: "idiom", text: body?.idiom };
  const category = rioLists.find(list => list.type === material?.type);
  if (!category || typeof material.text !== "string" || !material.text.trim() || material.text.length > 4000 ||
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
    { role: "system", content: "Have friendly everyday small talk in English with a language learner. Model the target expression in the opening and ask an easy question. " + usage[category.type] + " Follow their replies, gently recast mistakes, and give them a chance to use the expression without forcing it. Use one or two short sentences and at most one question per turn. Plain text only." },
    { role: "user", content: "Start a conversation using this practice target: " + JSON.stringify(material.text.trim()) },
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
