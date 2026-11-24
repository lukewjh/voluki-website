import type { APIRoute } from "astro";
import { rioLists, type RioMaterial } from "../../../lib/rioMaterials";
import { resolveAiConfig } from "../../../lib/aiConfig";
import { readJsonBody } from "../../../lib/readJsonBody";

export const prerender = false;

type MaterialGroup = { label: string; type: string; items: RioMaterial[] };

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

function groupMaterials(value: unknown): MaterialGroup[] {
  const maxItems = rioLists.reduce((total, list) => total + list.limit, 0);
  if (!Array.isArray(value) || !value.length || value.length > maxItems) return [];
  const groups: MaterialGroup[] = [];
  for (const list of rioLists) {
    const items = value.filter((item) => item?.type === list.type);
    if (items.length > list.limit || items.some((item) =>
      !Number.isSafeInteger(item.id) || item.id < 1 ||
      typeof item.text !== "string" || !item.text.trim() || item.text.length > 4096
    )) return [];
    if (items.length) groups.push({
      label: list.title, type: list.type,
      items: items.map(({ id, text }) => ({ id, text: text.trim(), type: list.type }))
    });
  }
  return groups.reduce((sum, group) => sum + group.items.length, 0) === value.length ? groups : [];
}

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
  groups: MaterialGroup[],
  type: string
) => groups.find((group) => group.type === type)?.items ?? [];

const buildChallengePlan = (
  groups: MaterialGroup[]
) => {
  const chunks = itemsForType(groups, "chunk");
  const sentencePatterns = itemsForType(groups, "sentence_pattern");
  const vocabulary = itemsForType(groups, "vocabulary");
  const adverbs = itemsForType(groups, "adverb");
  const idioms = itemsForType(groups, "idiom");
  const outputScenes = sample(scenes, Math.random() < 0.5 ? 2 : 3);

  const plan = [
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
      required_items: [chunks[1], chunks[2], ...idioms].filter(Boolean)
    }
  ];
  const pool = groups.flatMap((group) => group.items);
  return plan.map((challenge, index) => ({
    ...challenge,
    required_items: challenge.required_items.length ? challenge.required_items : [pool[index % pool.length]]
  }));
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
  const config = resolveAiConfig(request, locals);
  if (config instanceof Response) return config;
  const { apiKey, model, apiBaseUrl } = config;

  if (!apiKey) {
    return jsonResponse({ error: "请在顶部 AI 设置中填写配置，或配置服务器 DEEPSEEK_API_KEY。" }, 500);
  }

  const body = await readJsonBody(request).catch(() => null);
  const selectedGroups = groupMaterials(body?.materials);
  if (!selectedGroups.length) {
    return jsonResponse({ error: "请先加载已映射的生词本，再开始练习。" }, 400);
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
      redirect: "manual",
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
- Use every provided training item naturally in the input passage. Use each idiom with its idiomatic meaning in a suitable context.
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
