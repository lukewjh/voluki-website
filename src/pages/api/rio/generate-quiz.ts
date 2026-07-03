import type { APIRoute } from "astro";
import { getEnv } from "../../../lib/env";
import { getErrorMessage, readJsonBody } from "../../../lib/readJsonBody";

export const prerender = false;

type QuizOption = {
  label: string;
  text: string;
};

type QuizCard = {
  index: number;
  scene: string;
  english_sentence: string;
  options: QuizOption[];
  correct_label: string;
};

const scenes = [
  "教育",
  "科技",
  "工作与经济",
  "环境",
  "政府与法律",
  "家庭与儿童",
  "社会问题",
  "媒体与广告",
  "文化与传统",
  "国际化与全球化",
  "健康与生活方式"
] as const;

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });

const sample = <T>(items: readonly T[], count: number) => {
  const pool = [...items];

  for (let index = pool.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [pool[index], pool[target]] = [pool[target], pool[index]];
  }

  return pool.slice(0, count);
};

const extractOutputText = (data: any) => {
  if (typeof data.output_text === "string") return data.output_text;
  if (typeof data.choices?.[0]?.message?.content === "string") {
    return data.choices[0].message.content;
  }

  return "";
};

const getAiErrorMessage = async (response: Response) => {
  const text = await response.text();

  try {
    const data = JSON.parse(text);
    const message = data.error?.message;

    if (typeof message === "string" && message.includes("Service is too busy")) {
      return "AI 服务暂时繁忙，请稍后重新生成 Quiz。";
    }

    return typeof message === "string" ? message : text;
  } catch {
    return text || "AI request failed";
  }
};

const normalizeOption = (value: unknown, fallbackLabel: string): QuizOption => {
  const candidate = value && typeof value === "object" ? (value as Record<string, unknown>) : {};

  return {
    label: typeof candidate.label === "string" ? candidate.label.trim().slice(0, 1) : fallbackLabel,
    text: typeof candidate.text === "string" ? candidate.text.trim() : ""
  };
};

const normalizeCard = (value: unknown, index: number, scene: string): QuizCard => {
  const candidate = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const rawOptions = Array.isArray(candidate.options) ? candidate.options : [];
  const options = ["A", "B", "C", "D"].map((label, optionIndex) =>
    normalizeOption(rawOptions[optionIndex], label)
  );
  const rawCorrectLabel =
    typeof candidate.correct_label === "string" ? candidate.correct_label.trim().slice(0, 1) : "";
  const correctLabel = ["A", "B", "C", "D"].includes(rawCorrectLabel) ? rawCorrectLabel : "A";

  return {
    index,
    scene: typeof candidate.scene === "string" ? candidate.scene.trim() || scene : scene,
    english_sentence:
      typeof candidate.english_sentence === "string" ? candidate.english_sentence.trim() : "",
    options,
    correct_label: correctLabel
  };
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

  const patternCandidate =
    body.pattern && typeof body.pattern === "object"
      ? (body.pattern as Record<string, unknown>)
      : {};
  const patternText =
    typeof patternCandidate.text === "string" ? patternCandidate.text.trim() : "";

  if (!patternText) {
    return jsonResponse({ error: "Sentence pattern is required" }, 400);
  }

  const selectedScenes = sample(scenes, 3);
  let response: Response;

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
            content: `You are an expert IELTS reading trainer for Chinese learners.

Create sentence-pattern recognition quiz cards.

Return only valid JSON. Do not return Markdown, code fences, headings, or extra explanation.

JSON shape:
{
  "cards": [
    {
      "index": 1,
      "scene": "教育",
      "english_sentence": "One long and complex English sentence that clearly uses the target sentence pattern.",
      "options": [
        { "label": "A", "text": "中文翻译选项" },
        { "label": "B", "text": "中文翻译选项" },
        { "label": "C", "text": "中文翻译选项" },
        { "label": "D", "text": "中文翻译选项" }
      ],
      "correct_label": "A"
    }
  ]
}

Rules:
- Create exactly 3 cards.
- Use the same target sentence pattern in every English sentence.
- Use the provided scenes in order, one scene per card.
- Each English sentence should be 25-45 words, natural, academic, and suitable for IELTS reading practice.
- Each card must have exactly 4 Chinese translation options: A, B, C, D.
- Exactly one option must be the accurate translation.
- The other three options must be plausible but wrong. Make them wrong through common reading mistakes: reversed subject/object, wrong logical relation, wrong scope of modifier, missed negation, missed emphasis, or confused concession/cause/contrast.
- Keep all explanations out of the JSON.`
          },
          {
            role: "user",
            content: `Target sentence pattern:
${patternText}

Scenes:
1. ${selectedScenes[0]}
2. ${selectedScenes[1]}
3. ${selectedScenes[2]}`
          }
        ],
        response_format: { type: "json_object" },
        max_tokens: 1800,
        stream: false
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

  if (!response.ok) {
    const message = await getAiErrorMessage(response);
    return jsonResponse({ error: message || "AI request failed" }, response.status || 502);
  }

  let data;

  try {
    data = await response.json();
  } catch {
    return jsonResponse({ error: "AI returned an unreadable response" }, 502);
  }

  const outputText = extractOutputText(data);

  if (!outputText) {
    return jsonResponse({ error: "AI returned empty output" }, 502);
  }

  try {
    const parsed = JSON.parse(outputText);
    const rawCards = Array.isArray(parsed.cards) ? parsed.cards : [];
    const cards = selectedScenes.map((scene, index) => normalizeCard(rawCards[index], index + 1, scene));
    const isValid = cards.every(
      (card) =>
        card.english_sentence &&
        card.options.length === 4 &&
        card.options.every((option) => option.label && option.text) &&
        ["A", "B", "C", "D"].includes(card.correct_label)
    );

    if (!isValid) {
      return jsonResponse({ error: "AI returned invalid Quiz cards" }, 502);
    }

    return jsonResponse({
      pattern: patternText,
      cards
    });
  } catch {
    return jsonResponse({ error: "AI returned invalid Quiz JSON" }, 502);
  }
};
