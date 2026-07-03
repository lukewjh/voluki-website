import type { APIRoute } from "astro";
import { getEnv } from "../../../lib/env";
import { getErrorMessage, readJsonBody } from "../../../lib/readJsonBody";

export const prerender = false;

type RioItem = {
  id?: number;
  type?: string;
  text?: string;
};

type RioGroup = {
  type?: string;
  items?: RioItem[];
};

type RioChallenge = {
  index?: number;
  scene?: string;
  chinese_prompt?: string;
  reference_answer?: string;
  required_items?: RioItem[];
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });

const extractOutputText = (data: any) => {
  if (typeof data.output_text === "string") return data.output_text;
  if (typeof data.choices?.[0]?.message?.content === "string") {
    return data.choices[0].message.content;
  }

  return "";
};

const getAiErrorMessage = (data: any) => {
  const message = data.error?.message;

  if (typeof message === "string" && message.includes("Service is too busy")) {
    return "AI 服务暂时繁忙，请稍后重新进行语法检查。";
  }

  return typeof message === "string" ? message : "AI request failed";
};

const normalizeMaterials = (materials: unknown) => {
  if (!Array.isArray(materials)) return [];

  return materials
    .map((group) => {
      const candidate = group as RioGroup;
      const items = Array.isArray(candidate.items)
        ? candidate.items
            .map((item) => (typeof item.text === "string" ? item.text.trim() : ""))
            .filter(Boolean)
        : [];

      return {
        type: typeof candidate.type === "string" ? candidate.type : "",
        items
      };
    })
    .filter((group) => group.type && group.items.length);
};

const normalizeChallenges = (challenges: unknown) => {
  if (!Array.isArray(challenges)) return [];

  return challenges
    .map((challenge, index) => {
      const candidate = challenge as RioChallenge;
      const requiredItems = Array.isArray(candidate.required_items)
        ? candidate.required_items
            .map((item) => ({
              id: typeof item.id === "number" ? item.id : undefined,
              type: typeof item.type === "string" ? item.type : "",
              text: typeof item.text === "string" ? item.text.trim() : ""
            }))
            .filter((item) => item.type && item.text)
        : [];

      return {
        index: typeof candidate.index === "number" ? candidate.index : index + 1,
        scene: typeof candidate.scene === "string" ? candidate.scene : "",
        chinese_prompt:
          typeof candidate.chinese_prompt === "string" ? candidate.chinese_prompt.trim() : "",
        reference_answer:
          typeof candidate.reference_answer === "string" ? candidate.reference_answer.trim() : "",
        required_items: requiredItems
      };
    })
    .filter((challenge) => challenge.chinese_prompt && challenge.required_items.length);
};

const normalizeUserAnswers = (answers: unknown) => {
  if (!Array.isArray(answers)) return [];

  return answers.map((answer) => (typeof answer === "string" ? answer.trim() : ""));
};

const normalizeAnalyses = (analyses: unknown) => {
  if (!Array.isArray(analyses)) return [];

  return analyses.map((item, index) => {
    const candidate = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const grammarIssues = Array.isArray(candidate.grammar_issues)
      ? candidate.grammar_issues.filter((issue) => typeof issue === "string")
      : [];

    return {
      sentence_index:
        typeof candidate.sentence_index === "number" ? candidate.sentence_index : index + 1,
      scene: typeof candidate.scene === "string" ? candidate.scene : "",
      chinese_prompt:
        typeof candidate.chinese_prompt === "string" ? candidate.chinese_prompt : "",
      user_sentence: typeof candidate.user_sentence === "string" ? candidate.user_sentence : "",
      target_usage: typeof candidate.target_usage === "string" ? candidate.target_usage : "",
      grammar_issues: grammarIssues,
      idiomatic_suggestion:
        typeof candidate.idiomatic_suggestion === "string"
          ? candidate.idiomatic_suggestion
          : "",
      example_sentence:
        typeof candidate.example_sentence === "string" ? candidate.example_sentence : ""
    };
  });
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

  const materials = normalizeMaterials(body.materials);
  const challenges = normalizeChallenges(body.challenges);
  const userAnswers = normalizeUserAnswers(body.user_answers);

  if (!materials.length) {
    return jsonResponse({ error: "Materials are required" }, 400);
  }

  if (!challenges.length) {
    return jsonResponse({ error: "Challenges are required" }, 400);
  }

  if (userAnswers.length !== challenges.length || userAnswers.some((answer) => !answer)) {
    return jsonResponse({ error: "All user answers are required" }, 400);
  }

  const materialText = materials
    .map((group) => `${group.type}: ${group.items.join(", ")}`)
    .join("\n");
  const challengeText = challenges
    .map((challenge, index) => {
      const requiredItems = challenge.required_items
        .map((item) => `${item.type}: ${item.text}`)
        .join("; ");

      return `Sentence ${challenge.index}
Scene: ${challenge.scene}
Chinese prompt: ${challenge.chinese_prompt}
Reference answer: ${challenge.reference_answer}
Required items: ${requiredItems}
User answer: ${userAnswers[index]}`;
    })
    .join("\n\n");

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
            content: `你是一位英语语法教师和雅思表达教练。
你会收到 RIO 分布式翻译训练任务：每一句都有中文题目、用户英文答案、参考答案、必须使用的目标元素。

请逐句分析。每一句都必须包含：
- target_usage：用中文说明用户是否自然、准确地使用了本句 required items；逐个指出命中、漏用或误用。
- grammar_issues：语法和表达问题，使用中文说明。如果没有明显错误，也要说明“暂无明显语法错误”，并指出一个可更自然的细节。
- idiomatic_suggestion：地道表达建议，尤其说明如何更自然地使用 required items。
- example_sentence：给出一个更自然的英文示例句，尽量保留用户原意，并合理使用本句 required items。

只返回合法 JSON，不要返回 Markdown，不要代码块，不要额外解释。
JSON 格式：
{
  "analyses": [
    {
      "sentence_index": 1,
      "scene": "...",
      "chinese_prompt": "...",
      "user_sentence": "...",
      "target_usage": "...",
      "grammar_issues": ["..."],
      "idiomatic_suggestion": "...",
      "example_sentence": "..."
    }
  ]
}`
          },
          {
            role: "user",
            content: `本轮素材：\n${materialText}\n\n训练任务与用户答案：\n${challengeText}`
          }
        ],
        response_format: { type: "json_object" },
        max_tokens: 2600,
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

  let data;

  try {
    data = await response.json();
  } catch {
    return jsonResponse({ error: "AI returned an unreadable response" }, 502);
  }

  if (!response.ok) {
    return jsonResponse({ error: getAiErrorMessage(data) }, response.status);
  }

  const outputText = extractOutputText(data);

  if (!outputText) {
    return jsonResponse({ error: "AI returned empty output" }, 502);
  }

  try {
    const parsed = JSON.parse(outputText);
    return jsonResponse({ analyses: normalizeAnalyses(parsed.analyses) });
  } catch (error) {
    console.error("Failed to parse RIO grammar JSON", {
      error: getErrorMessage(error),
      outputPreview: outputText.slice(0, 600)
    });

    return jsonResponse({ error: "AI returned invalid grammar analysis JSON" }, 502);
  }
};
