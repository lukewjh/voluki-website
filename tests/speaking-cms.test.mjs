import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";
import { parse as parseYaml } from "yaml";

async function load(entry) {
  const result = await build({
    entryPoints: [entry], bundle: true, write: false, platform: "browser", format: "esm",
    define: { "import.meta.env": "{}" }, logLevel: "silent"
  });
  return import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64"));
}

const { createBlogCache } = await load("src/lib/blogCache.ts");
const { createGithubSpeakingClient } = await load("src/lib/githubSpeaking.ts");
const config = { repo: "lukewjh/voluki-website", branch: "main", token: "test-read-only-token" };
const origin = "https://voluki.test";
const slug = "part-2-3-important-decision-happy-result";
const sourcePath = "tiku-answer/2026-sep-dec/" + slug + ".json";
const file = JSON.parse(await readFile(sourcePath, "utf8"));
const base = { ...file, slug, sourcePath };

test("the CMS lists topics by title and exposes both versions as multiline answer fields", async () => {
  const settings = parseYaml(await readFile(".pages.yml", "utf8"));
  const collection = settings.content.find(({ name }) => name === "ielts-speaking");
  assert.equal(collection.path, "tiku-answer/2026-sep-dec");
  assert.equal(collection.format, "json");
  assert.deepEqual(collection.view.search, ["title"]);
  const sections = collection.fields.find(({ name }) => name === "sections");
  const questions = sections.fields.find(({ name }) => name === "questions");
  const prompt = questions.fields.find(({ name }) => name === "prompt");
  const answers = questions.fields.find(({ name }) => name === "answers");
  assert.equal(prompt.readonly, true);
  assert.deepEqual(answers.fields.map(({ name, type }) => [name, type]), [["basic", "text"], ["upgraded", "text"]]);
});

test("a CMS save becomes visible after the 60-second cache window and preserves card IDs and order", async () => {
  let now = 100000;
  let reads = 0;
  const live = structuredClone(file);
  const client = createGithubSpeakingClient(async (url, init) => {
    assert.equal(url, "https://api.github.com/repos/" + config.repo + "/contents/" + sourcePath + "?ref=main");
    assert.equal(init.headers.Accept, "application/vnd.github.raw+json");
    assert.equal(init.headers.Authorization, "Bearer " + config.token);
    assert.equal(init.redirect, "manual");
    reads += 1;
    return Response.json(live);
  }, createBlogCache(() => now, "IELTS-Speaking"));

  const results = await Promise.all([client.topic(config, origin, base), client.topic(config, origin, base)]);
  assert.equal(reads, 1);
  assert.deepEqual(results[0].topic, base);
  const edited = live.sections[1].questions[2];
  edited.answers.basic = "Latest answer.\r\n\r\nSecond paragraph.";
  edited.answers.upgraded = "  ";
  live.sections[1].questions.reverse();
  now += 59999;
  assert.deepEqual((await client.topic(config, origin, base)).topic, base);
  now += 1;
  const latest = await client.topic(config, origin, base);
  assert.equal(reads, 2);
  assert.equal(latest.stale, false);
  assert.equal(latest.topic.sections[1].questions[2].id, edited.id);
  assert.deepEqual(latest.topic.sections[1].questions[2].answers, {
    basic: "Latest answer.\n\nSecond paragraph.", upgraded: null
  });
  assert.deepEqual(latest.topic.sections[0], base.sections[0]);
});

test("a partial or invalid CMS save retains the last valid set of answers", async () => {
  let now = 100000;
  const live = structuredClone(file);
  const client = createGithubSpeakingClient(async () => Response.json(live), createBlogCache(() => now, "IELTS-Speaking"));
  const first = await client.topic(config, origin, base);
  live.sections[1].questions.pop();
  now += 60001;
  const result = await client.topic(config, origin, base);
  assert.equal(result.stale, true);
  assert.deepEqual(result.topic, first.topic);
});
