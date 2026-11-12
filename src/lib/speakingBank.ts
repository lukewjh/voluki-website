import data from "../../tiku-answer/ielts-speaking-2026-sep-dec.json";

export const speakingCategories = [
  { id: "new", label: "新题" },
  { id: "retained", label: "保留题" },
  { id: "evergreen", label: "万年老题" }
] as const;

type Category = (typeof speakingCategories)[number]["id"];
type Variant = "student" | "work";

export interface SpeakingQuestion {
  id: string;
  prompt: string;
  cuePoints?: string[];
  variant?: Variant;
  answers: { basic: string; upgraded: string | null };
}

interface Topic {
  id: string;
  title: string;
  category: Category;
}

interface Section {
  id: string;
  label?: string;
  questions: SpeakingQuestion[];
}

interface Collection extends Topic {
  slug: string;
  sections: Section[];
}

export interface SpeakingGroup {
  id: "1" | "2-3";
  label: string;
  topics: Collection[];
}

const bank = data as {
  title: string;
  part1: (Topic & { questions: SpeakingQuestion[] })[];
  part2And3: (Topic & { part2: SpeakingQuestion; part3: SpeakingQuestion[] })[];
};

const variants = [
  { id: "student", label: "学生版" },
  { id: "work", label: "工作版" }
] as const;

export const bankTitle = bank.title;

export const speakingGroups: SpeakingGroup[] = [
  {
    id: "1",
    label: "Part 1",
    topics: bank.part1.map(({ questions, ...topic }) => ({
      ...topic,
      slug: `part-1-${topic.id}`,
      sections: questions.some((question) => question.variant)
        ? variants.map(({ id, label }) => ({
            id,
            label,
            questions: questions.filter((question) => question.variant === id)
          }))
        : [{ id: "part-1", questions }]
    }))
  },
  {
    id: "2-3",
    label: "Part 2 与 Part 3",
    topics: bank.part2And3.map(({ part2, part3, ...topic }) => ({
      ...topic,
      slug: `part-2-3-${topic.id}`,
      sections: [
        { id: "part-2", label: "Part 2", questions: [part2] },
        { id: "part-3", label: "Part 3", questions: part3 }
      ]
    }))
  }
];
