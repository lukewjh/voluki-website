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

interface TopicFile extends Topic {
  part: "1" | "2-3";
  order: number;
  sections: Section[];
}

export interface SpeakingTopic extends TopicFile {
  slug: string;
  sourcePath: string;
}

export interface SpeakingGroup {
  id: "1" | "2-3";
  label: string;
  topics: SpeakingTopic[];
}

const files = import.meta.glob<TopicFile>("/tiku-answer/2026-sep-dec/*.json", {
  eager: true,
  import: "default"
});

const topics: SpeakingTopic[] = Object.entries(files).map(([path, topic]) => ({
  ...topic,
  slug: path.slice(path.lastIndexOf("/") + 1, -".json".length),
  sourcePath: path.slice(1)
})).sort((a, b) => a.order - b.order);

export const bankTitle = "2026 年 9-12 月雅思口语题库";

export const speakingGroups: SpeakingGroup[] = [
  {
    id: "1",
    label: "Part 1",
    topics: topics.filter((topic) => topic.part === "1")
  },
  {
    id: "2-3",
    label: "Part 2 与 Part 3",
    topics: topics.filter((topic) => topic.part === "2-3")
  }
];
