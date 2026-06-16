import type { APIRoute } from "astro";
import { getEnv } from "../../../lib/env";
import { getErrorMessage, readJsonBody } from "../../../lib/readJsonBody";

export const prerender = false;

const extractOutputText = (data: any) => {
  if (typeof data.output_text === "string") return data.output_text;
  if (typeof data.choices?.[0]?.message?.content === "string") {
    return data.choices[0].message.content;
  }

  return "";
};

const normalizeChunks = (chunks: unknown) => {
  if (!Array.isArray(chunks)) return [];

  return chunks
    .map((chunk) => {
      if (typeof chunk === "string") {
        return { english: chunk, chinese: "" };
      }

      if (!chunk || typeof chunk !== "object") return null;

      const candidate = chunk as Record<string, unknown>;

      return {
        english: typeof candidate.english === "string" ? candidate.english : "",
        chinese: typeof candidate.chinese === "string" ? candidate.chinese : ""
      };
    })
    .filter((chunk) => chunk && (chunk.english || chunk.chinese));
};

const normalizeSentences = (sentences: unknown) => {
  if (!Array.isArray(sentences)) return [];

  return sentences.map((sentence, index) => {
    const item = sentence && typeof sentence === "object" ? (sentence as Record<string, unknown>) : {};

    return {
      sequence: typeof item.sequence === "number" ? item.sequence : index + 1,
      english_text: typeof item.english_text === "string" ? item.english_text : "",
      chinese_text: typeof item.chinese_text === "string" ? item.chinese_text : "",
      structure: typeof item.structure === "string" ? item.structure : "",
      chunks: normalizeChunks(item.chunks)
    };
  });
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });

export const POST: APIRoute = async ({ request, locals }) => {
  const apiKey = getEnv(locals, "DEEPSEEK_API_KEY") ?? getEnv(locals, "OPENAI_API_KEY");
  const model = getEnv(locals, "OPENAI_MODEL") ?? "deepseek-v4-pro";
  const apiBaseUrl = getEnv(locals, "AI_BASE_URL") ?? "https://api.deepseek.com";

  if (!apiKey) {
    return jsonResponse({ error: "Missing DEEPSEEK_API_KEY" }, 500);
  }

  let body;

  try {
    body = await readJsonBody(request);
  } catch (error) {
    return jsonResponse({ error: getErrorMessage(error) }, 400);
  }

  const { text } = body;

  if (!text || typeof text !== "string") {
    return jsonResponse({ error: "Text is required" }, 400);
  }

  let response;

  try {
    response = await fetch(`${apiBaseUrl}/chat/completions`, {
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
            content:
              '你是一个精通中英双语的语言教学专家。你的任务是将用户输入的英文文章进行逐句拆解。要求：1. 保持句子的完整语义，不要过度切碎，确保每一句都适合用来做翻译练习。2. 将每句英文翻译成自然、符合中文习惯、但又能提示英文结构的中文。3. 提取出该句的主干结构，如：Some people believe that...。4. 为每一句提取 3-6 个回译时可能会用到的英文词块或表达块，优先选择固定搭配、介词短语、从句连接方式、抽象名词表达、动词搭配等，并提供对应中文意思。请严格返回 JSON，不要包含任何 Markdown 标记。格式为：{"sentences":[{"sequence":1,"english_text":"...","chinese_text":"...","structure":"...","chunks":[{"english":"...","chinese":"..."}]}]}。'
          },
          {
            role: "user",
            content: text
          }
        ],
        response_format: { type: "json_object" },
        max_tokens: 4000,
        stream: false
      })
    });
  } catch (error) {
    return jsonResponse({ error: `AI connection failed: ${getErrorMessage(error)}` }, 502);
  }

  let data;

  try {
    data = await response.json();
  } catch {
    return jsonResponse({ error: "AI returned an unreadable response. Please retry." }, 502);
  }

  if (!response.ok) {
    return jsonResponse({ error: data.error?.message ?? "OpenAI request failed" }, response.status);
  }

  const outputText = extractOutputText(data);

  if (!outputText) {
    return jsonResponse({ error: "OpenAI returned empty output" }, 502);
  }

  let parsed;

  try {
    parsed = JSON.parse(outputText);
  } catch {
    return jsonResponse({ error: "AI returned invalid JSON. Please retry." }, 502);
  }

  const sentences = normalizeSentences(Array.isArray(parsed) ? parsed : parsed.sentences);

  return jsonResponse({ sentences });
};
