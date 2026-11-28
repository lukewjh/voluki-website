import type { APIRoute } from "astro";
import { resolveAiConfig } from "../../../lib/aiConfig";
import { readVocabularyMeanings, vocabularyMeaningRule } from "../../../lib/rioVocabulary";

export const prerender = false;

const headers = { "Cache-Control": "private, no-store" };
const fail = (error: string, status: number) => Response.json({ error }, { status, headers });

export const POST: APIRoute = async ({ request, locals }) => {
  const body = await request.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text || text.length > 500) return fail("请输入不超过 500 个字符的词条。", 400);

  const config = resolveAiConfig(request, locals);
  if (config instanceof Response) return config;
  const { apiBaseUrl, apiKey, model } = config;
  if (!apiKey) return fail("请先在顶部 AI 设置中配置模型。", 400);

  const fast = /^https:\/\/api\.deepseek\.com(?:\/v1)?$/i.test(apiBaseUrl) &&
    /^(?:deepseek-v4-(?:pro|flash)|deepseek-chat|deepseek-flash)$/i.test(model);
  try {
    const response = await fetch(apiBaseUrl + "/chat/completions", {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: `Give the common meanings of one English vocabulary item for a Chinese learner. Return only a JSON object like {"meanings":["v. 产生","n. 产量"]}. Give 1–4 common, distinct meanings, most common first. Never invent a sense. ${vocabularyMeaningRule} No examples or explanations.` },
          { role: "user", content: JSON.stringify(text) }
        ],
        response_format: { type: "json_object" },
        ...(fast ? { thinking: { type: "disabled" } } : {}),
        max_tokens: fast ? 256 : 2048,
        stream: false
      })
    });
    if (!response.ok) {
      await response.body?.cancel();
      if ([401, 403].includes(response.status)) return fail("AI 服务拒绝了请求，请检查 AI 设置。", response.status);
      if (response.status === 429) return fail("释义服务暂时限流，请稍后重试。", 429);
      return fail("暂时无法获取释义，请重试。", 502);
    }

    const data = await response.json();
    const output = data?.choices?.[0]?.message?.content ?? data?.output_text;
    const decoded = typeof output === "string" ? JSON.parse(output) : null;
    const meanings = readVocabularyMeanings(decoded?.meanings);
    return meanings ? Response.json({ meanings }, { headers }) : fail("AI 返回的释义不完整，请重试。", 502);
  } catch {
    return fail("暂时无法获取释义，请重试。", 502);
  }
};
