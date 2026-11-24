export const exampleCount = 5;
export type VocabularyRound = {
  meanings: string[];
  examples: { meaning: number; sentence: string }[];
};

export function readVocabularyRound(value: unknown): VocabularyRound | null {
  if (!value || typeof value !== "object") return null;
  const { meanings, examples } = value as Partial<VocabularyRound>;
  if (!Array.isArray(meanings) || meanings.length < 1 || meanings.length > 4 ||
      !Array.isArray(examples) || examples.length !== exampleCount) return null;
  if (!meanings.every((m) => typeof m === "string" && m.trim() && m.length <= 100)) return null;
  const labels = meanings.map((m) => m.trim());
  if (new Set(labels).size !== labels.length) return null;

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
  if (seen.size !== exampleCount || used.size !== labels.length) return null;
  return { meanings: labels, examples: examples.map(({ meaning, sentence }) => ({ meaning, sentence: sentence.trim() })) };
}
