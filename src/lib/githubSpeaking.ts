import { z } from "zod";
import { contentEdgeCache, createBlogCache } from "./blogCache";
import { getEnv } from "./env";
import { githubBlogConfig } from "./githubBlog";
import { limitedBody, requestGithubContent, type GithubContentConfig } from "./githubContent";
import type { SpeakingQuestion, SpeakingTopic } from "./speakingBank";

type Answers = SpeakingQuestion["answers"];

const topicFile = z.object({
  id: z.string(),
  part: z.string(),
  sections: z.array(z.object({
    questions: z.array(z.object({
      id: z.string(),
      answers: z.object({
        basic: z.string().refine((answer) => answer.trim().length > 0),
        upgraded: z.string().nullish()
      })
    }))
  }))
});

function readAnswers(source: string, topic: SpeakingTopic) {
  const file = topicFile.parse(JSON.parse(source));
  const expected = new Set(topic.sections.flatMap(({ questions }) => questions.map(({ id }) => id)));
  const answers = new Map<string, Answers>();
  if (file.id !== topic.id || file.part !== topic.part) throw new Error("Unexpected speaking topic.");

  for (const { questions } of file.sections) {
    for (const { id, answers: edited } of questions) {
      if (!expected.delete(id)) throw new Error("Unexpected or duplicate speaking question.");
      answers.set(id, {
        basic: edited.basic.replace(/\r\n?/g, "\n"),
        upgraded: edited.upgraded?.trim() ? edited.upgraded.replace(/\r\n?/g, "\n") : null
      });
    }
  }
  if (expected.size) throw new Error("Speaking topic is missing questions.");
  return Object.fromEntries(answers);
}

export function createGithubSpeakingClient(
  fetcher: typeof fetch = fetch,
  cache = createBlogCache(Date.now, "IELTS-Speaking")
) {
  return {
    async topic(config: GithubContentConfig, origin: string, base: SpeakingTopic, edge?: Cache) {
      const cacheKey = new URL(
        "/__voluki-speaking-cache/v1/" +
        [config.repo, config.branch, base.sourcePath].map(encodeURIComponent).join("/"),
        origin
      ).href;
      const result = await cache.get(cacheKey, async () => {
        const path = base.sourcePath.split("/").map(encodeURIComponent).join("/");
        const response = await requestGithubContent(
          fetcher, config, "contents/" + path + "?ref=" + encodeURIComponent(config.branch),
          AbortSignal.timeout(10000), { raw: true, userAgent: "Voluki-IELTS-Speaking" }
        );
        const bytes = await limitedBody(response, 256 * 1024);
        return Response.json(readAnswers(new TextDecoder().decode(bytes), base));
      }, edge);

      const answers = await result.response.json() as Record<string, Answers>;
      const sections = base.sections.map((section) => ({
        ...section,
        questions: section.questions.map((question) => {
          const edited = answers[question.id];
          if (!edited) throw new Error("Speaking cache is missing a question.");
          return { ...question, answers: edited };
        })
      }));
      return { topic: { ...base, sections }, stale: result.stale };
    }
  };
}

const github = createGithubSpeakingClient();

export async function getSpeakingTopicAnswers(context: { locals: unknown; url: URL }, topic: SpeakingTopic) {
  if (import.meta.env.DEV && getEnv(context.locals, "SPEAKING_SOURCE") !== "github") {
    return { topic };
  }

  try {
    const result = await github.topic(githubBlogConfig(context.locals), context.url.origin, topic, contentEdgeCache());
    return {
      topic: result.topic,
      notice: result.stale ? "暂时无法同步，正在显示上次同步的答案。" : undefined
    };
  } catch (error) {
    console.warn("IELTS-Speaking is temporarily unavailable:", error instanceof Error ? error.message : "Unknown error");
    return { topic, notice: "暂时无法同步，正在显示部署时的答案。" };
  }
}
