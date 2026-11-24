export const rioLists = [
  { type: "vocabulary", title: "单词 · Vocabulary", limit: 2 },
  { type: "chunk", title: "词组 · Chunks", limit: 3 },
  { type: "idiom", title: "习语 · Idioms", limit: 1 },
  { type: "sentence_pattern", title: "句型 · Sentence Patterns", limit: 1 },
  { type: "adverb", title: "副词 · Adverbs", limit: 1 }
] as const;

export type RioType = (typeof rioLists)[number]["type"];
export type RioMaterial = { id: number; type: RioType; text: string };

export const usesPhraseMatch = (type: string | undefined) => type === "chunk" || type === "idiom";
