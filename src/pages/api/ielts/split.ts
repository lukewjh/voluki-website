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
              'You are an IELTS writing training assistant. Split the user\'s English passage into individual sentences and translate each sentence into natural, accurate Simplified Chinese. Return only valid json in this exact shape: {"sentences":[{"en":"original sentence","zh":"Chinese translation"}]}.'
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

  return new Response(JSON.stringify(parsed), {
    headers: { "Content-Type": "application/json" }
  });
};
