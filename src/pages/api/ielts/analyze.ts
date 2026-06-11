import type { APIRoute } from "astro";
import { getErrorMessage, readJsonBody } from "../../../lib/readJsonBody";

export const prerender = false;

const model = import.meta.env.OPENAI_MODEL ?? "gpt-5.5";
const apiBaseUrl = import.meta.env.AI_BASE_URL ?? "https://api.deepseek.com";

const extractOutputText = (data: any) => {
  if (typeof data.output_text === "string") return data.output_text;
  if (typeof data.choices?.[0]?.message?.content === "string") {
    return data.choices[0].message.content;
  }

  return "";
};

export const POST: APIRoute = async ({ request }) => {
  const apiKey = import.meta.env.DEEPSEEK_API_KEY ?? import.meta.env.OPENAI_API_KEY;

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

  const { sentences } = body;

  if (!Array.isArray(sentences) || sentences.length === 0) {
    return new Response(JSON.stringify({ error: "Sentences are required" }), {
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
              'You are a rigorous IELTS writing teacher for Chinese learners. For each item, you will receive the original English sentence, a Chinese prompt, and the learner\'s English back-translation. Analyze each sentence and provide a corrected natural English version, grammar feedback, comparisons between unnatural and idiomatic expressions, useful chunks to memorize, and useful sentence patterns. Be specific and concise. Return only valid json in this exact shape: {"analyses":[{"corrected":"...","grammar":"...","expressionComparisons":[{"mine":"...","natural":"...","reason":"..."}],"chunks":["..."],"patterns":["..."]}]}.'
          },
          {
            role: "user",
            content: JSON.stringify(sentences)
          }
        ],
        response_format: { type: "json_object" },
        max_tokens: 6000,
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

  return new Response(JSON.stringify(parsed), {
    headers: { "Content-Type": "application/json" }
  });
};
