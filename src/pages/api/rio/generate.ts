import type { APIRoute } from "astro";
import { getEnv } from "../../../lib/env";

export const prerender = false;

type EnglishItem = {
  id: number;
  type: string;
  text: string;
};

type D1PreparedStatement = {
  bind: (...values: unknown[]) => D1PreparedStatement;
  all: <T>() => Promise<{ results?: T[] }>;
};

type D1Database = {
  prepare: (query: string) => D1PreparedStatement;
};

const requirements = [
  { label: "Chunks", type: "chunk", count: 3 },
  { label: "Sentence Pattern", type: "sentence_pattern", count: 1 },
  { label: "Vocabulary", type: "vocabulary", count: 2 },
  { label: "Adverb", type: "adverb", count: 1 }
] as const;

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
      return "AI 服务暂时繁忙，请稍后重新生成短文。";
    }

    return typeof message === "string" ? message : text;
  } catch {
    return text || "AI request failed";
  }
};

export const POST: APIRoute = async ({ locals }) => {
  const db = (locals as any).runtime?.env?.DB as D1Database | undefined;
  const apiKey = getEnv(locals, "DEEPSEEK_API_KEY") ?? getEnv(locals, "OPENAI_API_KEY");
  const model = getEnv(locals, "OPENAI_MODEL") ?? "deepseek-v4-pro";
  const apiBaseUrl = getEnv(locals, "AI_BASE_URL") ?? "https://api.deepseek.com";

  if (!db) {
    return jsonResponse({ error: "Missing D1 binding: DB" }, 500);
  }

  if (!apiKey) {
    return jsonResponse({ error: "Missing DEEPSEEK_API_KEY" }, 500);
  }

  let selectedGroups: Array<{ label: string; type: string; items: EnglishItem[] }>;

  try {
    selectedGroups = await Promise.all(
      requirements.map(async (requirement) => {
        const result = await db
          .prepare("SELECT id, type, text FROM english_items WHERE type = ? ORDER BY RANDOM() LIMIT ?")
          .bind(requirement.type, requirement.count)
          .all<EnglishItem>();

        return {
          label: requirement.label,
          type: requirement.type,
          items: result.results ?? []
        };
      })
    );
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : "Failed to select random RIO items"
      },
      500
    );
  }

  const missingGroup = selectedGroups.find((group, index) => {
    return group.items.length < requirements[index].count;
  });

  if (missingGroup) {
    return jsonResponse(
      {
        error: `Not enough ${missingGroup.label} items in D1 for generation`
      },
      400
    );
  }

  const selectedText = selectedGroups
    .map((group) => `${group.label}: ${group.items.map((item) => item.text).join(", ")}`)
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
            content: `You are an expert IELTS reading passage writer.

Write one realistic short IELTS-style reading passage for English learners.

Requirements:
- Length: about 180-220 English words.
- Use a natural, credible context rather than a list-like exercise.
- The passage should feel like a compact magazine or IELTS reading text.
- Include every provided chunk, sentence pattern, vocabulary item, and adverb exactly as usable language in the passage.
- Keep the language close to IELTS Academic Reading difficulty.
- Do not explain the task.
- Do not add headings, bullet points, Markdown, Chinese translation, or vocabulary notes.
- Return only the passage text.`
          },
          {
            role: "user",
            content: `Please write the passage using all of these items:\n\n${selectedText}`
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
        controller.enqueue(encoder.encode(streamEvent("materials", selectedGroups)));

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
