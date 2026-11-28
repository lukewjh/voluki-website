export const vocabularyExampleCounts = { spoken: 3, academic: 5 } as const;
export const vocabularyMeaningRule = "Each label is a short part of speech plus a clear Simplified Chinese gloss. Merge synonyms of the same sense.";
export type VocabularyRound = {
  meanings: string[];
  examples: { meaning: number; sentence: string }[];
};

export function readVocabularyMeanings(meanings: unknown): string[] | null {
  if (!Array.isArray(meanings) || meanings.length < 1 || meanings.length > 4) return null;
  if (!meanings.every((m) => typeof m === "string" && m.trim() && m.length <= 100)) return null;
  const labels = meanings.map((m: string) => m.trim());
  return new Set(labels).size === labels.length ? labels : null;
}

export function readVocabularyRound(value: unknown, expectedCount: number): VocabularyRound | null {
  if (!value || typeof value !== "object") return null;
  const { meanings, examples } = value as Partial<VocabularyRound>;
  const labels = readVocabularyMeanings(meanings);
  if (!labels || !Array.isArray(examples) || examples.length !== expectedCount) return null;

  const seen = new Set<string>();
  const used = new Set<number>();
  for (const item of examples) {
    if (!item || !Number.isInteger(item.meaning) || item.meaning < 0 || item.meaning >= labels.length ||
        typeof item.sentence !== "string" || item.sentence.length > 450) return null;
    const parts = item.sentence.trim().split("**");
    if (parts.length !== 3 || !parts[1].trim() || !(parts[0] + parts[2]).trim() ||
        parts.some((part) => part.includes("*"))) return null;
    seen.add(parts.join("").trim().toLowerCase());
    used.add(item.meaning);
  }
  if (seen.size !== expectedCount || used.size !== labels.length) return null;
  return { meanings: labels, examples: examples.map(({ meaning, sentence }) => ({ meaning, sentence: sentence.trim() })) };
}
