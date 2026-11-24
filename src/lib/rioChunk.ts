type Usage = { expression: string; note: string };
export type ChunkCard = {
  chunk: string;
  forms: Usage[];
  alternatives: Usage[];
  example: string;
  translation: string;
};

function readUsages(value: unknown, min: number, max: number): Usage[] | null {
  if (!Array.isArray(value)) return null;
  const usages: Usage[] = [];
  for (const item of value) {
    if (typeof item?.expression !== "string" || typeof item?.note !== "string") continue;
    const expression = item.expression.trim();
    const note = item.note.trim();
    if (expression && note && !usages.some(row => row.expression === expression)) {
      usages.push({ expression, note });
      if (usages.length === max) break;
    }
  }
  return usages.length >= min ? usages : null;
}

export function readChunkCard(value: unknown): ChunkCard | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ChunkCard>;
  const { chunk, example, translation } = raw;
  if (typeof chunk !== "string" || !chunk.trim() ||
      typeof example !== "string" || !example.trim() ||
      typeof translation !== "string" || !translation.trim()) return null;

  const forms = readUsages(raw.forms, 1, 2);
  const alternatives = readUsages(raw.alternatives, 2, 3);
  if (!forms || !alternatives) return null;
  return { chunk: chunk.trim(), forms, alternatives, example: example.trim(), translation: translation.trim() };
}
