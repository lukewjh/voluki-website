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
  question_type?: string;
  english_sentence: string;
  target_text?: string;
  options: QuizOption[];
  correct_label: string;
  hint?: string;
  feedback?: string;
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
    question_type:
      typeof candidate.question_type === "string" ? candidate.question_type.trim() : undefined,
    english_sentence:
      typeof candidate.english_sentence === "string" ? candidate.english_sentence.trim() : "",
    target_text: typeof candidate.target_text === "string" ? candidate.target_text.trim() : undefined,
    options,
    correct_label: correctLabel,
    hint: typeof candidate.hint === "string" ? candidate.hint.trim() : undefined,
    feedback: typeof candidate.feedback === "string" ? candidate.feedback.trim() : undefined
  };
};

const getMaterial = (body: Record<string, unknown>) => {
  const materialCandidate =
    body.material && typeof body.material === "object"
      ? (body.material as Record<string, unknown>)
      : null;

  if (materialCandidate) {
    const type = typeof materialCandidate.type === "string" ? materialCandidate.type.trim() : "";
    const text = typeof materialCandidate.text === "string" ? materialCandidate.text.trim() : "";
    const id = Number(materialCandidate.id);

    return {
      id: Number.isFinite(id) ? id : undefined,
      type,
      text
    };
  }

  const patternCandidate =
    body.pattern && typeof body.pattern === "object"
      ? (body.pattern as Record<string, unknown>)
      : {};
  const text = typeof patternCandidate.text === "string" ? patternCandidate.text.trim() : "";
  const id = Number(patternCandidate.id);

  return {
    id: Number.isFinite(id) ? id : undefined,
    type: text ? "sentence_pattern" : "",
    text
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

  const material = getMaterial(body);

  if (!material.text) {
    return jsonResponse({ error: "Quiz material is required" }, 400);
  }

  if (!["chunk", "sentence_pattern", "vocabulary", "adverb"].includes(material.type)) {
    return jsonResponse({ error: "Unsupported Quiz material type" }, 400);
  }

  const selectedScenes = sample(scenes, 3);
  const isChunkQuiz = material.type === "chunk";
  const isVocabularyQuiz = material.type === "vocabulary";
  const isAdverbQuiz = material.type === "adverb";
  let systemPrompt: string;

  if (isChunkQuiz) {
    systemPrompt = `You are an expert IELTS collocation trainer for Chinese learners.

Create chunk cloze quiz cards.

Return only valid JSON. Do not return Markdown, code fences, headings, or extra explanation.

JSON shape:
{
  "cards": [
    {
      "index": 1,
      "scene": "Education",
      "english_sentence": "A short English sentence with exactly one _____ blank.",
      "options": [
        { "label": "A", "text": "correct word or phrase" },
        { "label": "B", "text": "wrong distractor" },
        { "label": "C", "text": "wrong distractor" },
        { "label": "D", "text": "wrong distractor" }
      ],
      "correct_label": "A",
      "feedback": "A brief Chinese explanation of why the correct collocation is natural."
    }
  ]
}

Rules:
- Create exactly 3 cards.
- Use the provided scenes in order, one scene per card.
- Each question must be one natural English sentence containing exactly one blank written as _____.
- Each sentence must be 10-18 words.
- The blank should remove the core word or phrase of the target chunk, especially a preposition, core verb, noun, or collocation component.
- The correct option must be the removed word or phrase.
- Each card must have exactly 4 English options: A, B, C, D.
- Exactly one option must be correct.
- The other three options must be plausible but wrong, especially common Chinese-English errors, wrong prepositions, unnatural verbs, wrong fixed collocations, or grammar mistakes.
- Keep each sentence suitable for IELTS writing or academic discussion.
- Keep feedback in Chinese and under 28 Chinese characters.
- Keep all explanations out of the JSON except the feedback field.`;
  } else if (isVocabularyQuiz) {
    systemPrompt = `You are an expert IELTS vocabulary and reading trainer for Chinese learners.

Create vocabulary contextual-paraphrase quiz cards.

Return only valid JSON. Do not return Markdown, code fences, headings, or extra explanation.

JSON shape:
{
  "cards": [
    {
      "index": 1,
      "scene": "Education",
      "english_sentence": "One natural English sentence that includes the target vocabulary exactly once.",
      "target_text": "exact target vocabulary from the sentence",
      "options": [
        { "label": "A", "text": "precise synonym" },
        { "label": "B", "text": "look-alike trap" },
        { "label": "C", "text": "wrong-sense trap" },
        { "label": "D", "text": "unrelated trap" }
      ],
      "correct_label": "A",
      "feedback": "A brief Chinese explanation of the contextual meaning."
    }
  ]
}

Rules:
- Create exactly 3 cards.
- Use the provided scenes in order, one scene per card.
- Each card must contain one natural English sentence.
- The sentence must include the target vocabulary exactly once.
- The target vocabulary must be used in a meaningful IELTS-style context.
- The question is: which option can best replace the target vocabulary in this context?
- The correct option must be the most precise synonym or paraphrase in the current context.
- Each option must be a very short English word or phrase, usually one word.
- Distractor A should be a spelling/look-alike confusion when possible, such as complement vs compliment.
- Distractor B should reflect a different common meaning, wrong part of speech, or familiar-word trap.
- Distractor C should be an antonym, unrelated advanced word, or context-related but semantically wrong word.
- Avoid options that are obviously silly.
- Return target_text as the exact word or phrase in the sentence that should be highlighted.
- Keep feedback in Chinese and explain the contextual meaning in under 28 Chinese characters.
- Keep all explanations out of the JSON except the feedback field.`;
  } else if (isAdverbQuiz) {
    systemPrompt = `You are an expert IELTS discourse and tone trainer for Chinese learners.

Create Adverb Sense Quiz cards.

Return only valid JSON. Do not return Markdown, code fences, headings, or extra explanation.

JSON shape:
{
  "cards": [
    {
      "index": 1,
      "scene": "Education",
      "question_type": "Meaning & Intensity",
      "english_sentence": "An IELTS-style sentence with one _____ blank.",
      "options": [
        { "label": "A", "text": "slightly" },
        { "label": "B", "text": "TargetAdverb" },
        { "label": "C", "text": "barely" },
        { "label": "D", "text": "rarely" }
      ],
      "correct_label": "A",
      "hint": "A short Chinese hint shown after a wrong answer.",
      "feedback": "A brief Chinese explanation of what the adverb adds."
    }
  ]
}

Rules:
- Create exactly 3 cards.
- Use the provided scenes in order, one scene per card.
- Card 1 must be question_type "Meaning & Intensity".
  - It tests what strength, degree, frequency, certainty, attitude, or logical force the target adverb adds.
  - The question must be one IELTS-style sentence with one _____ blank where the target adverb naturally fits.
  - Options must be 4 short English adverbs only.
  - Distractors should be same-category adverbs with different intensity, frequency, certainty, or attitude.
- Card 2 must be question_type "Position & Grammar".
  - The question must be exactly: "Choose the most natural sentence."
  - Options must be 4 full English sentences using the target adverb in different positions.
  - Exactly one option should place the adverb most naturally.
  - Wrong options should be plausible but awkward because of adverb placement, word order, or scope.
  - Test realistic positions such as after an auxiliary, before a main verb, before an adjective/participle, clause-final, or sentence-initial only when natural.
  - Provide a hint that points to the key position rule without revealing the exact answer.
- Card 3 must be question_type "Context Fit".
  - The question must be: "Which sentence best fits \"TARGET_ADVERB\"?" replacing TARGET_ADVERB with the actual target adverb.
  - Options must be 4 full English sentences.
  - Exactly one sentence should fit the semantic scenario of the target adverb.
  - The other sentences should be grammatical but semantically odd, trivial, or mismatched for that adverb.
  - Provide a hint that names the semantic scenario to look for without revealing the exact answer.
- Every card must have exactly 4 options: A, B, C, D.
- Exactly one option must be correct.
- Keep all examples suitable for IELTS writing or academic discussion.
- For Card 2 and Card 3, hint is required.
- Keep hint in Chinese and under 36 Chinese characters.
- Keep feedback in Chinese and under 32 Chinese characters.
- Do not add Chinese translations in options for adverb cards; options should stay visually quick to scan.
- Keep all explanations out of the JSON except the feedback field.`;
  } else {
    systemPrompt = `You are an expert IELTS reading trainer for Chinese learners.

Create sentence-pattern recognition quiz cards.

Return only valid JSON. Do not return Markdown, code fences, headings, or extra explanation.

JSON shape:
{
  "cards": [
    {
      "index": 1,
      "scene": "Education",
      "english_sentence": "One long and complex English sentence that clearly uses the target sentence pattern.",
      "options": [
        { "label": "A", "text": "Chinese translation option" },
        { "label": "B", "text": "Chinese translation option" },
        { "label": "C", "text": "Chinese translation option" },
        { "label": "D", "text": "Chinese translation option" }
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
- Keep all explanations out of the JSON.`;
  }

  const materialLabel = isChunkQuiz
    ? "Target chunk"
    : isVocabularyQuiz
      ? "Target vocabulary"
    : isAdverbQuiz
      ? "Target adverb"
      : "Target sentence pattern";
  const userPrompt = `${materialLabel}:
${material.text}

Scenes:
1. ${selectedScenes[0]}
2. ${selectedScenes[1]}
3. ${selectedScenes[2]}`;
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
            content: systemPrompt
          },
          {
            role: "user",
            content: userPrompt
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
        (!isChunkQuiz || card.english_sentence.includes("_____")) &&
        (!isVocabularyQuiz ||
          (card.target_text &&
            card.english_sentence.toLocaleLowerCase().includes(card.target_text.toLocaleLowerCase()))) &&
        card.options.length === 4 &&
        card.options.every((option) => option.label && option.text) &&
        ["A", "B", "C", "D"].includes(card.correct_label)
    );

    if (!isValid) {
      return jsonResponse({ error: "AI returned invalid Quiz cards" }, 502);
    }

    return jsonResponse({
      material,
      pattern: material.type === "sentence_pattern" ? material.text : undefined,
      cards
    });
  } catch {
    return jsonResponse({ error: "AI returned invalid Quiz JSON" }, 502);
  }
};
