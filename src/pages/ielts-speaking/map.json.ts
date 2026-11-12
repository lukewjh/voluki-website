import type { APIRoute } from "astro";
import { speakingCategories, speakingGroups } from "../../lib/speakingBank";
import type { SpeakingMapNode } from "../../lib/speakingMindMap";

export const prerender = true;

export const GET: APIRoute = () => {
  const root: SpeakingMapNode = {
    id: "bank",
    label: "IELTS-Speaking",
    children: speakingGroups.map((group) => ({
      id: "map-part-" + group.id,
      label: group.label,
      children: speakingCategories.flatMap(({ id, label }) => {
        const topics = group.topics.filter((topic) => topic.category === id);
        return topics.length ? [{
          id: group.id + "-" + id,
          label,
          children: topics.map((topic) => ({
            id: topic.slug,
            label: topic.title,
            children: topic.sections.flatMap<SpeakingMapNode>((section) => {
              const questions = section.questions.map(({ id, prompt }) => ({
                id,
                label: prompt,
                href: "/ielts-speaking/" + topic.slug + "/"
              }));
              return section.label ? [{
                id: topic.slug + "-" + section.id,
                label: section.label,
                children: questions
              }] : questions;
            })
          }))
        }] : [];
      })
    }))
  };

  return new Response(JSON.stringify(root), {
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
};
