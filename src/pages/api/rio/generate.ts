import type { APIRoute } from "astro";
import { getEnv } from "../../../lib/env";
import { readJsonBody } from "../../../lib/readJsonBody";

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

const streamEvent = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const chunkText = (text: string) => {
  const chunks = text.match(/.{1,14}(?:\s+|$)/gs);
  return chunks?.filter(Boolean) ?? [text];
};

const normalizeSelectedIds = (value: unknown) => {
  if (!Array.isArray(value)) return [];

  return [
    ...new Set(
      value
        .map((id) => (typeof id === "number" ? id : Number(id)))
        .filter((id) => Number.isInteger(id) && id > 0)
    )
  ];
};

const readSelectedPayload = async (request: Request) => {
  try {
    const body = await readJsonBody(request);
    const selected = (body as { selected?: Record<string, unknown> }).selected;

    if (!selected || typeof selected !== "object") return {};

    return Object.fromEntries(
      requirements.map((requirement) => [
        requirement.type,
        normalizeSelectedIds(selected[requirement.type])
      ])
    );
  } catch {
    return {};
  }
};

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

const sample = <T>(items: readonly T[], count: number) => {
  const pool = [...items];

  for (let index = pool.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [pool[index], pool[target]] = [pool[target], pool[index]];
  }

  return pool.slice(0, count);
};

const itemsForType = (
  groups: Array<{ label: string; type: string; items: EnglishItem[] }>,
  type: string
) => groups.find((group) => group.type === type)?.items ?? [];

const buildChallengePlan = (
  groups: Array<{ label: string; type: string; items: EnglishItem[] }>
) => {
  const chunks = itemsForType(groups, "chunk");
  const sentencePatterns = itemsForType(groups, "sentence_pattern");
  const vocabulary = itemsForType(groups, "vocabulary");
  const adverbs = itemsForType(groups, "adverb");
  const outputScenes = sample(scenes, Math.random() < 0.5 ? 2 : 3);

  return [
    {
      index: 1,
      scene: outputScenes[0],
      required_items: [sentencePatterns[0], chunks[0]].filter(Boolean)
    },
    {
      index: 2,
      scene: outputScenes[1],
      required_items: [vocabulary[0], vocabulary[1], adverbs[0]].filter(Boolean)
    },
    {
      index: 3,
      scene: outputScenes[2] ?? outputScenes[0],
      required_items: [chunks[1], chunks[2]].filter(Boolean)
    }
  ];
};

const extractOutputText = (data: any) => {
  if (typeof data.output_text === "string") return data.output_text;
  if (typeof data.choices?.[0]?.message?.content === "string") {
    return data.choices[0].message.content;
  }

  return "";
};

const normalizeChallenge = (value: unknown, fallback: { index: number; scene: string }) => {
  const candidate = value && typeof value === "object" ? (value as Record<string, unknown>) : {};

  return {
    index: typeof candidate.index === "number" ? candidate.index : fallback.index,
    scene: typeof candidate.scene === "string" ? candidate.scene : fallback.scene,
    chinese_prompt:
      typeof candidate.chinese_prompt === "string" ? candidate.chinese_prompt.trim() : "",
    reference_answer:
      typeof candidate.reference_answer === "string" ? candidate.reference_answer.trim() : ""
  };
};

export const POST: APIRoute = async ({ request, locals }) => {
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

  const selectedByType = await readSelectedPayload(request);
  let selectedGroups: Array<{ label: string; type: string; items: EnglishItem[] }>;

  try {
    selectedGroups = await Promise.all(
      requirements.map(async (requirement) => {
        const requestedIds = selectedByType[requirement.type] ?? [];
        let selectedItems: EnglishItem[] = [];

        if (requestedIds.length) {
          const placeholders = requestedIds.map(() => "?").join(", ");
          const result = await db
            .prepare(
              `SELECT id, type, text
               FROM english_items
               WHERE type = ? AND id IN (${placeholders})`
            )
            .bind(requirement.type, ...requestedIds)
            .all<EnglishItem>();

          const selectedById = new Map((result.results ?? []).map((item) => [item.id, item]));
          selectedItems = requestedIds
            .map((id) => selectedById.get(id))
            .filter((item): item is EnglishItem => Boolean(item))
            .slice(0, requirement.count);
        }

        const remainingCount = requirement.count - selectedItems.length;
        let randomItems: EnglishItem[] = [];

        if (remainingCount > 0) {
          const excludedIds = selectedItems.map((item) => item.id);
          const excludedClause = excludedIds.length
            ? ` AND id NOT IN (${excludedIds.map(() => "?").join(", ")})`
            : "";
          const result = await db
            .prepare(
              `SELECT id, type, text
               FROM english_items
               WHERE type = ?${excludedClause}
               ORDER BY RANDOM()
               LIMIT ?`
            )
            .bind(requirement.type, ...excludedIds, remainingCount)
            .all<EnglishItem>();

          randomItems = result.results ?? [];
        }

        return {
          label: requirement.label,
          type: requirement.type,
          items: [...selectedItems, ...randomItems]
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

  const inputScene = sample(scenes, 1)[0];
  const challengePlan = buildChallengePlan(selectedGroups);
  const challengePlanText = challengePlan
    .map((challenge) => {
      const items = challenge.required_items
        .map((item) => `${item.type}: ${item.text}`)
        .join("; ");

      return `Challenge ${challenge.index} | Scene: ${challenge.scene} | Required items: ${items}`;
    })
    .join("\n");

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
            content: `You are an expert IELTS bilingual training designer.

Create one RIO training package for English learners.

Return only valid JSON. Do not return Markdown, code fences, headings, or extra explanation.

JSON shape:
{
  "input_passage": "100-150 English words, 3-4 sentences",
  "challenges": [
    {
      "index": 1,
      "scene": "教育",
      "chinese_prompt": "A natural Chinese sentence for the learner to translate",
      "reference_answer": "A natural English answer using the required items"
    }
  ]
}

Rules:
- Input passage scene: use only the provided input scene.
- The input passage must include every provided chunk, sentence pattern, vocabulary item, and adverb exactly as usable language.
- Distribute the provided items naturally across the 3-4 input passage sentences.
- Output challenges: create exactly 3 Chinese translation prompts.
- Each challenge must use its assigned scene and assigned required items only.
- Each Chinese prompt must be natural Chinese, not translationese.
- Each reference answer must be natural English and must include all assigned required items.
- Keep every challenge short enough for one sentence translation practice.
- Do not reveal the required items inside the Chinese prompt.`
          },
          {
            role: "user",
            content: `Input scene: ${inputScene}

All training items:
${selectedText}

Output challenge plan:
${challengePlanText}`
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
    const challenges = challengePlan.map((planned, index) => {
      const generated = normalizeChallenge(parsed.challenges?.[index], planned);

      return {
        ...generated,
        index: planned.index,
        scene: planned.scene,
        required_items: planned.required_items
      };
    });

    const trainingPackage = {
      materials: selectedGroups,
      input_scene: inputScene,
      input_passage:
        typeof parsed.input_passage === "string" ? parsed.input_passage.trim() : "",
      output_scenes: [...new Set(challengePlan.map((challenge) => challenge.scene))],
      challenges
    };
    const encoder = new TextEncoder();

    return new Response(
      new ReadableStream({
        async start(controller) {
          try {
            controller.enqueue(
              encoder.encode(
                streamEvent("package", {
                  materials: trainingPackage.materials,
                  input_scene: trainingPackage.input_scene,
                  output_scenes: trainingPackage.output_scenes,
                  challenges: trainingPackage.challenges
                })
              )
            );

            for (const chunk of chunkText(trainingPackage.input_passage)) {
              controller.enqueue(encoder.encode(streamEvent("delta", chunk)));
              await sleep(18);
            }

            controller.enqueue(encoder.encode(streamEvent("done", true)));
          } catch (error) {
            controller.enqueue(
              encoder.encode(
                streamEvent("error", error instanceof Error ? error.message : "RIO stream failed")
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
  } catch {
    return jsonResponse({ error: "AI returned invalid RIO package JSON" }, 502);
  }
};
