import type { APIRoute } from "astro";
import { resolveAiConfig } from "../../../lib/aiConfig";
import { readChunkCard } from "../../../lib/rioChunk";
import { exampleCount, readVocabularyRound } from "../../../lib/rioVocabulary";
import { rioLists, usesPhraseMatch } from "../../../lib/rioMaterials";
import { getErrorMessage, readJsonBody } from "../../../lib/readJsonBody";

export const prerender = false;

type QuizOption = {
  label: string;
  text: string;
};

type PatternBuilderSentence = {
  scene: string;
  chunks: string[];
  answer_chunks: string[];
  hint?: string;
  feedback?: string;
};

type QuizCard = {
  index: number;
  scene: string;
  question_type?: string;
  english_sentence: string;
  target_text?: string;
  chunks?: string[];
  answer_chunks?: string[];
  builder_sentences?: PatternBuilderSentence[];
  options: QuizOption[];
  correct_label: string;
  hint?: string;
  feedback?: string;
};

type ChunkMatchItem = {
  id: string;
  type: string;
  scene?: string;
  sentence_type?: string;
  left: string;
  right: string;
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

const shuffleChunks = (chunks: string[]) => {
  if (chunks.length < 2) return [...chunks];

  let shuffled = sample(chunks, chunks.length);
  if (shuffled.every((chunk, index) => chunk === chunks[index])) {
    shuffled = [...chunks.slice(1), chunks[0]];
  }

  return shuffled;
};

const normalizePatternBuilderSentence = (
  value: unknown,
  fallbackScene: string
): PatternBuilderSentence => {
  const candidate = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const answerChunks = Array.isArray(candidate.answer_chunks)
    ? candidate.answer_chunks.filter(
        (item): item is string => typeof item === "string" && Boolean(item.trim())
      )
    : [];

  return {
    scene:
      typeof candidate.scene === "string" && candidate.scene.trim()
        ? candidate.scene.trim()
        : fallbackScene,
    chunks: shuffleChunks(answerChunks),
    answer_chunks: answerChunks,
    hint: typeof candidate.hint === "string" ? candidate.hint.trim() : undefined,
    feedback: typeof candidate.feedback === "string" ? candidate.feedback.trim() : undefined
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
    chunks: Array.isArray(candidate.chunks)
      ? candidate.chunks.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
      : undefined,
    answer_chunks: Array.isArray(candidate.answer_chunks)
      ? candidate.answer_chunks.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
      : undefined,
    builder_sentences: Array.isArray(candidate.builder_sentences)
      ? candidate.builder_sentences.map((item, builderIndex) =>
          normalizePatternBuilderSentence(item, `${scene} ${builderIndex + 1}`)
        )
      : undefined,
    options,
    correct_label: correctLabel,
    hint: typeof candidate.hint === "string" ? candidate.hint.trim() : undefined,
    feedback: typeof candidate.feedback === "string" ? candidate.feedback.trim() : undefined
  };
};

const normalizeChunkMatchItem = (value: unknown, index: number, materialType: string): ChunkMatchItem => {
  const candidate = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const scene = typeof candidate.scene === "string" ? candidate.scene.trim() : "";
  const sentenceType =
    typeof candidate.sentence_type === "string" ? candidate.sentence_type.trim() : "";
  const fallbackType =
    scene && sentenceType
      ? `${scene} / ${sentenceType}`
      : scene || sentenceType || (materialType === "idiom" ? "Idiom" : "Chunk");

  return {
    id: `${materialType}-${index + 1}`,
    type: typeof candidate.type === "string" && candidate.type.trim() ? candidate.type.trim() : fallbackType,
    scene: scene || undefined,
    sentence_type: sentenceType || undefined,
    left: typeof candidate.left === "string" ? candidate.left.trim() : "",
    right: typeof candidate.right === "string" ? candidate.right.trim() : ""
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

const getBatchConfig = (body: Record<string, unknown>, materialType: string) => {
  const requestedBatchIndex = Number(body.batchIndex);

  if (materialType === "sentence_pattern") {
    const batchIndex = Number.isInteger(requestedBatchIndex)
      ? Math.min(Math.max(requestedBatchIndex, 0), 1)
      : 0;

    return {
      totalCount: 4,
      batchSize: batchIndex === 0 ? 3 : 1,
      batchCount: 2,
      batchIndex,
      offset: batchIndex === 0 ? 0 : 3
    };
  }

  const totalCount = usesPhraseMatch(materialType) ? 24
    : materialType === "vocabulary" ? exampleCount : materialType === "chunk" ? 1 : 3;
  const batchSize = usesPhraseMatch(materialType) ? 6 : totalCount;
  const batchCount = Math.ceil(totalCount / batchSize);
  const batchIndex = Number.isInteger(requestedBatchIndex)
    ? Math.min(Math.max(requestedBatchIndex, 0), batchCount - 1)
    : 0;

  return {
    totalCount,
    batchSize,
    batchCount,
    batchIndex,
    offset: batchIndex * batchSize
  };
};

export const POST: APIRoute = async ({ request, locals }) => {
  const config = resolveAiConfig(request, locals);
  if (config instanceof Response) return config;
  const { apiKey, model, apiBaseUrl } = config;

  if (!apiKey) {
    return jsonResponse({ error: "请在顶部 AI 设置中填写配置，或配置服务器 DEEPSEEK_API_KEY。" }, 500);
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

  if (!rioLists.some((list) => list.type === material.type)) {
    return jsonResponse({ error: "Unsupported Quiz material type" }, 400);
  }

  const batch = getBatchConfig(body, material.type);
  const expectedCardCount = batch.batchSize;
  const isPhraseMatchQuiz = usesPhraseMatch(material.type);
  const selectedSceneCount =
    isPhraseMatchQuiz ? 2 : material.type === "sentence_pattern" ? 3 : expectedCardCount;
  const selectedScenes = sample(scenes, selectedSceneCount);
  const isVocabularyQuiz = material.type === "vocabulary";
  const isChunkQuiz = material.type === "chunk";
  const useDeepSeekFastQuiz = (isVocabularyQuiz || isChunkQuiz) &&
    /^https:\/\/api\.deepseek\.com(?:\/v1)?$/i.test(apiBaseUrl) &&
    /^(?:deepseek-v4-(?:pro|flash)|deepseek-chat|deepseek-flash)$/i.test(model);
  const isAdverbQuiz = material.type === "adverb";
  let systemPrompt: string;

  if (isChunkQuiz) {
    systemPrompt = `Make one English chunk flashcard for a Chinese learner. Return only a JSON object:
{"chunk":"...","forms":[{"expression":"...","note":"..."}],"alternatives":[{"expression":"...","note":"..."}],"example":"...","translation":"..."}
chunk: Keep the entry as the heading, fixing clear errors only. If ambiguous, choose one common reading.
forms: Give 1–2 distinct standard constructions for that reading. Show required subjects, objects, or complements with A/B, sth or sb where useful. Explain each construction's meaning and roles briefly in Simplified Chinese.
alternatives: Compare 2–3 common related expressions for the same situation. For each, give the English expression and one short Chinese note contrasting its register, nuance or grammar with the target. Show changed word order or sentence structure when needed; avoid implying literal interchangeability. Prefer everyday options and include a formal one when natural.
example: One short sentence someone might actually say, using a target form. Wrap its actual use in **double asterisks**.
translation: Natural Simplified Chinese for that sentence. Keep all other fields plain text.`;
  } else if (isPhraseMatchQuiz) {
    systemPrompt = `You are an expert IELTS collocation trainer for Chinese learners.

Create a Chunk Match sentence network for one target chunk.

Return only valid JSON. Do not return Markdown, code fences, headings, or extra explanation.

JSON shape:
{
  "cards": [
    {
      "id": "chunk-1",
      "type": "Education / Passive Voice",
      "scene": "Education",
      "sentence_type": "Passive Voice",
      "left": "More attention should be paid to students' mental health.",
      "right": "学校在儿童发展中发挥关键作用。"
    }
  ]
}

Rules:
- Create exactly ${expectedCardCount} matching pairs for batch ${batch.batchIndex + 1} of ${batch.batchCount}.
- Use the provided ${selectedSceneCount} scenes. Create exactly 3 pairs for each scene.
- For each scene, use 3 different sentence types.
- Include a wide sentence-type mix in this batch. Prefer different types across the two scenes:
  Declarative, Yes/No Question, Wh-Question, Negative Sentence, Passive Voice, Conditional, Concession, Cause/Result, Comparative, Emphasis, Inversion, Relative Clause, Noun Clause, There-be Pattern, It-as-Subject, Participle Phrase, Imperative, Rhetorical Question.
- Do not let more than 3 sentences in this batch be plain declarative sentences.
- If sentence-type diversity conflicts with valid JSON or natural English, prioritize valid JSON and natural English.
- Questions must end with a question mark and be natural IELTS-style questions, not awkward grammar drills.
- Inversion must be natural, such as "Not only does...", "Only when...", or "Rarely do...".
- Every left value must be one natural English sentence using the target chunk.
- Each English sentence should be about 8-12 words where possible.
- ${material.type === "idiom" ? "Use the idiom in its conventional sense and usual register. Translate its intended meaning into natural Chinese." : "Sentences should be B1-C1, IELTS-writing friendly, and academically useful."}
- Vary subjects, objects, and sentence frames. Avoid repetitive templates.
- Every right value must be a concise, natural Simplified Chinese translation.
- Chinese answers in the same round should be distinguishable, so avoid near-duplicate translations.
- The scene field must be the English scene name, such as "Education", "Technology", or "Environment".
- The sentence_type field must be one English sentence-type label from the list above.
- The type field must combine scene and sentence_type, for example "Education / Passive Voice".
- Do not include notes, explanations, Markdown, or fields outside id, type, scene, sentence_type, left, and right.`;
  } else if (isVocabularyQuiz) {
    systemPrompt = `Write a five-example IELTS Reading word-sense matching game for a Chinese learner.
Return one JSON object with exactly these two fields:
{"meanings":["v. 产生","n. 产量"],"examples":[{"meaning":0,"sentence":"Their observations **yielded** insights into how the colony survived."}]}
This example illustrates the format. Use the requested word and produce exactly five distinct sentences.
- Estimate the word's common parts of speech and senses in IELTS-style reading. Pick 2–4 distinct, non-overlapping meanings. For a word with only one useful sense, use just that one. Never invent a sense.
- Give 3–4 examples to the common uses, repeating the dominant sense across different contexts. If appropriate, mix in 1–2 examples of less frequent but useful senses. Use all five for the core usage if no secondary sense fits.
- Each label is a short part of speech plus a clear Simplified Chinese gloss. Merge synonyms of the same sense. Use every listed meaning.
- Each sentence should read like an excerpt from an IELTS Reading passage, typically 12–22 words. Include a contextual clue that makes exactly one meaning fit. Vary topics and constructions.
- In each sentence, put exactly one pair of double asterisks around the target word or its inflected form as it occurs. Use the zero-based index of the correct meaning as an integer. No explanations or additional fields.`;
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
    systemPrompt = batch.batchIndex === 0
      ? `You are an expert IELTS reading trainer for Chinese learners.

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
- Create exactly 3 recognition cards. Use the same target sentence pattern in every English sentence.
- Use the provided scenes in order, one scene per card.
- Each recognition sentence should be 25-45 words, natural, academic, and suitable for IELTS reading practice.
- Every card must have exactly 4 Chinese translation options: A, B, C, D.
- Exactly one option must be the accurate translation.
- The other three options must be plausible but wrong. Make them wrong through common reading mistakes: reversed subject/object, wrong logical relation, wrong scope of modifier, missed negation, missed emphasis, or confused concession/cause/contrast.
- Keep all explanations out of the JSON.`
      : `You are an expert IELTS sentence-pattern trainer for Chinese learners.

Create one semantic-block sentence-building card.

Return only valid JSON. Do not return Markdown, code fences, headings, or extra explanation.

JSON shape:
{
  "cards": [
    {
      "index": 4,
      "scene": "Pattern Builder",
      "question_type": "Pattern Builder",
      "english_sentence": "Build three sentences with the target pattern.",
      "builder_sentences": [
        {
          "scene": "Education",
          "answer_chunks": ["meaningful block 1", "meaningful block 2", "meaningful block 3", "meaningful block 4", "meaningful block 5"],
          "hint": "A short Chinese structure hint.",
          "feedback": "A short Chinese explanation."
        }
      ],
      "options": [],
      "correct_label": "A"
    }
  ]
}

Rules:
- Create exactly 1 card with question_type "Pattern Builder" and exactly 3 builder_sentences.
- Each builder sentence must naturally and clearly use the target sentence pattern.
- Make the three builder sentences progressively harder: about 15-20, 20-30, and 30-45 words.
- Split each sentence into 5-8 meaningful semantic blocks in correct order under answer_chunks.
- Never split into individual words. Keep articles, prepositions, auxiliaries, and their phrases together.
- Do not return a shuffled chunks field; the application will shuffle answer_chunks.
- Give every builder sentence a distinct IELTS topic scene, a concise Chinese hint, and a concise Chinese feedback note.
- The card must use an empty options array and correct_label "A".
- Keep all explanations out of the JSON.`;
  }

  const materialLabel = isPhraseMatchQuiz
    ? `Target ${material.type}`
    : isVocabularyQuiz
      ? "Target vocabulary"
    : isAdverbQuiz
      ? "Target adverb"
      : "Target sentence pattern";
  const userPrompt = isChunkQuiz ? material.text : `${materialLabel}:
${material.text}

Scenes:
${selectedScenes.map((scene, index) => `${index + 1}. ${scene}`).join("\n")}`;
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
            content: systemPrompt
          },
          {
            role: "user",
            content: userPrompt
          }
        ],
        response_format: { type: "json_object" },
        ...(useDeepSeekFastQuiz ? { thinking: { type: "disabled" } } : {}),
        max_tokens: isPhraseMatchQuiz
          ? 1600
          : isVocabularyQuiz || isChunkQuiz
            ? 4096
            : isAdverbQuiz || batch.batchIndex === 0
              ? 1800
              : 1400,
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

  if (isVocabularyQuiz && data?.choices?.[0]?.finish_reason === "length") {
    return jsonResponse({ error: "AI 已达到输出长度上限，未能生成完整的五个例句。请重新生成或调整模型配置。" }, 502);
  }
  if (!outputText.trim()) {
    if (isVocabularyQuiz) return jsonResponse({ error: "AI 返回了空答案，请重新生成；如果持续出现，请检查所选模型。" }, 502);
    return jsonResponse({ error: "AI returned empty output" }, 502);
  }

  try {
    const parsed = JSON.parse(outputText);
    if (isChunkQuiz) {
      const card = readChunkCard(parsed);
      return card ? jsonResponse(card) : jsonResponse({ error: "词组卡内容不完整，请重新生成。" }, 502);
    }
    const rawCards: unknown[] = Array.isArray(parsed.cards) ? parsed.cards : [];

    if (isPhraseMatchQuiz) {
      const cards = rawCards
        .slice(0, expectedCardCount)
        .map((item, index) => normalizeChunkMatchItem(item, batch.offset + index, material.type));
      const isValid =
        cards.length === expectedCardCount &&
        cards.every((item) => item.id && item.type && item.left && item.right);

      if (!isValid) {
        return jsonResponse({ error: "AI returned invalid Chunk Match pairs" }, 502);
      }

      return jsonResponse({
        material,
        cards,
        batch: { ...batch, hasMore: batch.batchIndex < batch.batchCount - 1 }
      });
    }

    if (isVocabularyQuiz) {
      const round = readVocabularyRound(parsed);
      if (!round) return jsonResponse({ error: "这组例句的格式不完整，请重新生成。" }, 502);
      const meanings = sample(round.meanings, round.meanings.length);
      const examples = sample(round.examples, exampleCount).map(({ sentence, meaning }) => ({
        sentence, meaning: meanings.indexOf(round.meanings[meaning])
      }));
      return jsonResponse({ meanings, examples });
    }

    const cards = Array.from({ length: expectedCardCount }, (_, index) =>
      normalizeCard(
        rawCards[index],
        batch.offset + index + 1,
        selectedScenes[index] ?? "Pattern Builder"
      )
    );
    const isValid = cards.every(
      (card) =>
        card.english_sentence &&
        (!isPhraseMatchQuiz ||
          card.question_type === "Sentence Builder" ||
          (card.options.length === 4 && ["A", "B", "C", "D"].includes(card.correct_label))) &&
        (!isPhraseMatchQuiz ||
          card.question_type !== "Sentence Builder" ||
          (Array.isArray(card.chunks) &&
            Array.isArray(card.answer_chunks) &&
            card.chunks.length >= 4 &&
            card.chunks.length === card.answer_chunks.length)) &&
        (card.question_type === "Pattern Builder"
          ? Array.isArray(card.builder_sentences) &&
            card.builder_sentences.length === 3 &&
            card.builder_sentences.every(
              (sentence) =>
                sentence.answer_chunks.length >= 5 &&
                sentence.answer_chunks.length <= 8 &&
                sentence.chunks.length === sentence.answer_chunks.length
            )
          : card.question_type === "Sentence Builder" ||
          (card.options.length === 4 &&
            card.options.every((option) => option.label && option.text) &&
            ["A", "B", "C", "D"].includes(card.correct_label)))
    );

    if (!isValid) {
      return jsonResponse({ error: "AI returned invalid Quiz cards" }, 502);
    }

    return jsonResponse({
      material,
      pattern: material.type === "sentence_pattern" ? material.text : undefined,
      cards,
      batch: { ...batch, hasMore: false }
    });
  } catch {
    return jsonResponse({ error: "AI returned invalid Quiz JSON" }, 502);
  }
};
