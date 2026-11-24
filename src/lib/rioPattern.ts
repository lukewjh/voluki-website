type PatternExample = { en: string; zh: string; highlight: string };
export type PatternCard = {
  formula: string;
  usage_tag: string;
  grammar_tip: string;
  examples: PatternExample[];
  quick_prompt: string;
};

const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";

export function readPatternCard(value: unknown): PatternCard | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<PatternCard>;
  const formula = clean(raw.formula);
  const usage_tag = clean(raw.usage_tag);
  const grammar_tip = clean(raw.grammar_tip);
  const quick_prompt = clean(raw.quick_prompt);
  if (!formula || !usage_tag || !grammar_tip || !quick_prompt ||
      !Array.isArray(raw.examples) || raw.examples.length !== 2) return null;

  const examples = raw.examples.map(item => ({
    en: clean(item?.en), zh: clean(item?.zh), highlight: clean(item?.highlight)
  }));
  if (examples.some(({ en, zh, highlight }) => !zh || !highlight || !en.includes(highlight)) ||
      examples[0].en === examples[1].en) return null;
  return { formula, usage_tag, grammar_tip, examples, quick_prompt };
}
