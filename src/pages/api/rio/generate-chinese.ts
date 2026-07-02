import type { APIRoute } from "astro";
import { getEnv } from "../../../lib/env";
import { getErrorMessage, readJsonBody } from "../../../lib/readJsonBody";

export const prerender = false;

type RioItem = {
  text?: string;
};

type RioGroup = {
  label?: string;
  type?: string;
  items?: RioItem[];
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });

const extractDelta = (line: string) => {
  if (!line.startsWith("data:")) return "";

  const payload = line.slice(5).trim();
  if (!payload || payload === "[DONE]") return "";

  try {
    const data = JSON.parse(payload);
    return data.choices?.[0]?.delta?.content ?? "";
  } catch {
    return "";
  }
};

const streamEvent = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

const getAiErrorMessage = async (response: Response) => {
  const text = await response.text();

  try {
    const data = JSON.parse(text);
    const message = data.error?.message;

    if (typeof message === "string" && message.includes("Service is too busy")) {
      return "AI 服务暂时繁忙，请稍后重新生成中文短文。";
    }

    return typeof message === "string" ? message : text;
  } catch {
    return text || "AI request failed";
  }
};

const normalizeGroups = (groups: unknown) => {
  if (!Array.isArray(groups)) return [];

  return groups
    .map((group) => {
      const candidate = group as RioGroup;
      const items = Array.isArray(candidate.items)
        ? candidate.items
            .map((item) => (typeof item.text === "string" ? item.text.trim() : ""))
            .filter(Boolean)
        : [];

      return {
        label: typeof candidate.label === "string" ? candidate.label : "",
        type: typeof candidate.type === "string" ? candidate.type : "",
        items
      };
    })
    .filter((group) => group.type && group.items.length);
};

export const POST: APIRoute = async ({ request, locals }) => {
  const apiKey = getEnv(locals, "DEEPSEEK_API_KEY") ?? getEnv(locals, "OPENAI_API_KEY");
  const model = getEnv(locals, "OPENAI_MODEL") ?? "deepseek-v4-pro";
  const apiBaseUrl = getEnv(locals, "AI_BASE_URL") ?? "https://api.deepseek.com";

  if (!apiKey) {
    return jsonResponse({ error: "Missing DEEPSEEK_API_KEY" }, 500);
  }

  let body: Record<string, unknown>;

  try {
    body = await readJsonBody(request);
  } catch (error) {
    return jsonResponse({ error: getErrorMessage(error) }, 400);
  }

  const groups = normalizeGroups(body.materials);

  if (!groups.length) {
    return jsonResponse({ error: "Materials are required" }, 400);
  }

  const selectedText = groups
    .map((group) => `${group.type}: ${group.items.join(", ")}`)
    .join("\n");

  let aiResponse: Response;

  try {
    aiResponse = await fetch(`${apiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: `你是一位雅思阅读与中英双语训练材料设计者。

请根据给定的英文 chunk、sentence pattern、vocabulary 和 adverb，创作一篇中文短文。

要求：
- 中文短文约 200 个汉字。
- 内容尽可能有逻辑，像一篇真实语境下的短阅读材料。
- 这篇中文短文应当自然对应到一篇可能使用这些英文表达的英文短文。
- 不要逐条翻译素材，不要列清单。
- 不要添加标题、Markdown、解释、词汇注释或英文。
- 只返回中文短文正文。`
          },
          {
            role: "user",
            content: `请基于这些素材生成中文短文：\n\n${selectedText}`
          }
        ],
        max_tokens: 520,
        stream: true
      })
    });
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : "AI connection failed"
      },
      502
    );
  }

  if (!aiResponse.ok || !aiResponse.body) {
    const message = await getAiErrorMessage(aiResponse);
    return jsonResponse({ error: message || "AI request failed" }, aiResponse.status || 502);
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  return new Response(
    new ReadableStream({
      async start(controller) {
        const reader = aiResponse.body!.getReader();
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              const delta = extractDelta(line);
              if (delta) {
                controller.enqueue(encoder.encode(streamEvent("delta", delta)));
              }
            }
          }

          controller.enqueue(encoder.encode(streamEvent("done", true)));
        } catch (error) {
          controller.enqueue(
            encoder.encode(
              streamEvent("error", error instanceof Error ? error.message : "AI stream failed")
            )
          );
        } finally {
          controller.close();
        }
      }
    }),
    {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/event-stream; charset=utf-8"
      }
    }
  );
};
