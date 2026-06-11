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

export const POST: APIRoute = async ({ request, locals }) => {
  const apiKey = getEnv(locals, "DEEPSEEK_API_KEY") ?? getEnv(locals, "OPENAI_API_KEY");
  const model = getEnv(locals, "OPENAI_MODEL") ?? "deepseek-v4-pro";
  const apiBaseUrl = getEnv(locals, "AI_BASE_URL") ?? "https://api.deepseek.com";

  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Missing DEEPSEEK_API_KEY" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  let body;

  try {
    body = await readJsonBody(request);
  } catch (error) {
    return new Response(JSON.stringify({ error: getErrorMessage(error) }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  const { text } = body;

  if (!text || typeof text !== "string") {
    return new Response(JSON.stringify({ error: "Text is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
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
              '你是一个精通中英双语的语言教学专家。你的任务是将用户输入的英文文章进行逐句拆解。要求：1. 保持句子的完整语义，不要过度切碎，确保每一句都适合用来做翻译练习。2. 将每句英文翻译成自然、符合中文习惯、但又能提示英文结构的中文。3. 提取出该句的主干结构，如：Some people believe that...。请严格返回 JSON，不要包含任何 Markdown 标记。格式为：{"sentences":[{"sequence":1,"english_text":"...","chinese_text":"...","structure":"..."}]}。'
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
    return new Response(
      JSON.stringify({ error: `AI connection failed: ${getErrorMessage(error)}` }),
      {
        status: 502,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  const data = await response.json();

  if (!response.ok) {
    return new Response(
      JSON.stringify({ error: data.error?.message ?? "OpenAI request failed" }),
      {
        status: response.status,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  const outputText = extractOutputText(data);

  if (!outputText) {
    return new Response(JSON.stringify({ error: "OpenAI returned empty output" }), {
      status: 502,
      headers: { "Content-Type": "application/json" }
    });
  }

  const parsed = JSON.parse(outputText);
  const sentences = Array.isArray(parsed) ? parsed : parsed.sentences;

  return new Response(JSON.stringify({ sentences: sentences ?? [] }), {
    headers: { "Content-Type": "application/json" }
  });
};
