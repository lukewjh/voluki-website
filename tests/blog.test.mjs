import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";
import { parse as parseYaml } from "yaml";

async function load(entry, plugins = []) {
  const result = await build({
    entryPoints: [entry], bundle: true, write: false, platform: "browser", format: "esm",
    define: { "import.meta.env": "{}" }, logLevel: "silent", plugins
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const { parseBlogPost, renderBlogMarkdown, publicBlogPosts } = await load("src/lib/blogMarkdown.ts");
const { createBlogCache } = await load("src/lib/blogCache.ts");
const { createGithubBlogClient, isBlogMediaPath } = await load("src/lib/githubBlog.ts");
const config = { repo: "lukewjh/voluki-website", branch: "main", token: "test-read-only-token" };
const origin = "https://voluki.test";
const sha = (number) => number.toString(16).padStart(40, "0");
const entry = (name, number, mode = "100644") => ({ path: `src/content/blog/${name}.md`, sha: sha(number), type: "blob", mode });
const source = (title, extra = "") => `---\ntitle: "${title}"\ndescription: "Test description"\ndate: "2026-11-06"\n${extra}---\n\n## Hello\n\nTest body.`;
function edgeCache() {
  const store = new Map();
  return { match: async (key) => store.get(key)?.clone(), put: async (key, response) => { store.set(key, response.clone()); } };
}

test("existing article URLs, HTML images and Markdown formatting are preserved", async () => {
  for (const [file, expected] of [["TIL-introduce", "til-introduce"], ["edu-Gap-a-year", "edu-gap-a-year"], ["optical-illusion", "optical-illusion"]]) {
    const post = parseBlogPost(`src/content/blog/${file}.md`, await readFile(`src/content/blog/${file}.md`, "utf8"));
    assert.equal(post.slug, expected);
    assert.ok(post.html.length > 0);
    if (file === "optical-illusion") {
      assert.match(post.html, /src="\/blog-media\/optical-illusion.png"/);
      assert.match(post.html, /width:70%/);
      assert.match(post.html, /<pre><code/);
    }
  }
  const html = renderBlogMarkdown("## Heading\n\n## Heading\n\n```js\nconst hello = 1;\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |");
  assert.match(html, /id="heading"/);
  assert.match(html, /id="heading-1"/);
  assert.match(html, /hljs-keyword/);
  assert.match(html, /<table>/);
});

test("runtime rendering removes executable HTML, dangerous URLs and CSS", () => {
  const html = renderBlogMarkdown('<script>alert(1)</script><img src="/content_imgs/test.png" onerror="alert(1)" style="position:fixed;width:70%;background:url(https://evil.test/a)"><a href="javascript:alert(1)" onclick="alert(1)">link</a><iframe src="https://evil.test"></iframe>');
  assert.doesNotMatch(html, /script|onerror|onclick|javascript:|position:|background:|iframe/);
  assert.match(html, /src="\/blog-media\/test.png"/);
  assert.match(html, /width:70%/);
});

test("CMS blank optional fields are accepted and malformed draft/date fields fail closed", () => {
  const post = parseBlogPost("post.md", source("Test", 'updated: ""\nimage: ""\nimageAlt: null\ncategory: ""\ntags: []\n'));
  assert.equal(post.data.updated, undefined);
  assert.equal(post.data.image, undefined);
  for (const field of ['draft: "false"\n', "date: null\n", "date: not-a-date\n"]) {
    const invalid = field.startsWith("date:") ? source("Test").replace('date: "2026-11-06"\n', field) : source("Test", field);
    assert.throws(() => parseBlogPost("post.md", invalid));
  }
  assert.equal(publicBlogPosts([parseBlogPost("draft.md", source("Draft", "draft: true\n"))]).length, 0);
});

test("CMS configuration maps the existing fields and routes uploads through live media", async () => {
  const cms = parseYaml(await readFile(".pages.yml", "utf8"));
  assert.equal(cms.media.input, "public/content_imgs");
  assert.equal(cms.media.output, "/blog-media");
  assert.equal(cms.content[0].path, "src/content/blog");
  assert.equal(cms.content[0].subfolders, false);
  assert.equal(cms.content[0].operations.rename, false);
  const fields = new Map(cms.content[0].fields.map((field) => [field.name, field]));
  assert.equal(fields.get("draft").default, true);
  assert.equal(fields.get("body").options.format, "markdown");
  for (const name of ["title", "description", "date", "body"]) assert.equal(fields.get(name).required, true);
});

test("new posts, withdrawals and images become visible after the cache expires without a build", async () => {
  let clock = 100000;
  let version = 1;
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push(url);
    assert.equal(options.headers.Authorization, "Bearer test-read-only-token");
    assert.equal(options.redirect, "manual");
    if (url.includes("/git/trees/")) return Response.json({ sha: sha(version), tree: version === 1 ? [entry("old", 10), entry("hidden", 11), entry("symlink", 12, "120000")] : [entry("new", 20), { path: "public/content_imgs/new.png", sha: sha(21), type: "blob", mode: "100644" }] });
    if (url.endsWith(sha(10))) return new Response(source("Old"));
    if (url.endsWith(sha(11))) return new Response(source("Hidden", "draft: true\n"));
    if (url.endsWith(sha(20))) return new Response(source("New"));
    throw new Error("Unexpected blob");
  };
  const client = createGithubBlogClient(fetcher, createBlogCache(() => clock));
  assert.deepEqual((await client.snapshot(config, origin)).posts.map((post) => post.slug), ["old"]);
  version = 2;
  clock += 59000;
  assert.deepEqual((await client.snapshot(config, origin)).posts.map((post) => post.slug), ["old"]);
  assert.equal(calls.filter((url) => url.includes("/git/trees/")).length, 1);
  clock += 1001;
  const updated = await client.snapshot(config, origin);
  assert.deepEqual(updated.posts.map((post) => post.slug), ["new"]);
  assert.equal(updated.media["new.png"], sha(21));
  assert.ok(updated.posts[0].data.date instanceof Date);
  assert.ok(!calls.some((url) => url.endsWith(sha(12))));
});

test("unchanged blobs are reused and a valid empty repository snapshot removes all posts", async () => {
  let clock = 100000;
  let empty = false;
  let blobs = 0;
  const client = createGithubBlogClient(async (url) => {
    if (url.includes("/git/trees/")) return Response.json({ sha: sha(1), tree: empty ? [] : [entry("post", 1)] });
    blobs++;
    return new Response(source("Post"));
  }, createBlogCache(() => clock));
  await client.snapshot(config, origin);
  clock += 60001;
  await client.snapshot(config, origin);
  assert.equal(blobs, 1);
  empty = true;
  clock += 60001;
  assert.deepEqual((await client.snapshot(config, origin)).posts, []);
});

test("concurrent requests share one refresh and a cold process reuses the edge cache", async () => {
  let clock = 100000;
  let reads = 0;
  const edge = edgeCache();
  const loader = async () => { reads++; await new Promise((resolve) => setTimeout(resolve, 5)); return Response.json({ value: reads }); };
  const cache = createBlogCache(() => clock);
  const values = await Promise.all(Array.from({ length: 8 }, () => cache.get(`${origin}/key`, loader, edge)));
  assert.equal(reads, 1);
  assert.deepEqual(await values[3].response.json(), { value: 1 });
  const cold = createBlogCache(() => clock);
  assert.equal((await cold.get(`${origin}/key`, loader, edge)).stale, false);
  assert.equal(reads, 1);
  clock += 60001;
  await cold.get(`${origin}/key`, loader, edge);
  assert.equal(reads, 2);
});

test("an outage serves the last successful snapshot briefly, then fails instead of resurrecting bundled posts", async () => {
  let clock = 100000;
  const cache = createBlogCache(() => clock);
  const key = `${origin}/outage`;
  await cache.get(key, async () => new Response("published"));
  clock += 60001;
  const offline = async () => { throw new Error("offline"); };
  const fallback = await cache.get(key, offline);
  assert.equal(fallback.stale, true);
  assert.equal(await fallback.response.text(), "published");
  clock += 86400000;
  await assert.rejects(cache.get(key, offline), /offline/);
  await assert.rejects(createBlogCache().get(key, offline), /offline/);
});

test("truncated repository trees preserve the previous snapshot rather than hiding arbitrary posts", async () => {
  let clock = 100000;
  let truncated = false;
  const client = createGithubBlogClient(async (url) => url.includes("/git/trees/")
    ? Response.json({ sha: sha(1), tree: [entry("post", 1)], truncated })
    : new Response(source("Post")), createBlogCache(() => clock));
  await client.snapshot(config, origin);
  truncated = true;
  clock += 60001;
  const result = await client.snapshot(config, origin);
  assert.equal(result.stale, true);
  assert.equal(result.posts[0].slug, "post");
});

test("GitHub redirects are rejected without following the redirect destination", async () => {
  let calls = 0;
  const client = createGithubBlogClient(async (_url, options) => {
    calls++;
    assert.equal(options.redirect, "manual");
    return new Response(null, { status: 302, headers: { Location: "https://other.example/" } });
  });
  await assert.rejects(client.snapshot(config, origin), /302/);
  assert.equal(calls, 1);
});

test("media only exposes allowed image paths and caches immutable blob bytes", async () => {
  for (const path of ["../.env", "test.svg", "test.__proto__", "test.constructor", "a/../../test.png", "a\\test.png", "https://evil.test/a.png", "%2e%2e/test.png", "a//b.png"]) assert.equal(isBlogMediaPath(path), false, path);
  assert.equal(isBlogMediaPath("中文/test image.png"), true);
  let calls = 0;
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const client = createGithubBlogClient(async (url) => { calls++; assert.ok(url.endsWith(sha(21))); return new Response(bytes); });
  const result = await client.image(config, origin, "new.png", sha(21));
  assert.equal(result.headers.get("Content-Type"), "image/png");
  assert.deepEqual(new Uint8Array(await result.arrayBuffer()), bytes);
  await client.image(config, origin, "new.png", sha(21));
  assert.equal(calls, 1);
});

test("media HTTP route returns new image bytes, conditional 304s and uncacheable missing/error responses", async () => {
  const { GET } = await load("src/pages/blog-media/[...path].ts", [{
    name: "blog-route-context",
    setup(builder) {
      builder.onResolve({ filter: /^\.\.\/\.\.\/lib\/blog$/ }, () => ({ path: "blog", namespace: "test" }));
      builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: `
        export const useLocalBlog = () => false;
        export const getBlog = () => globalThis.__blogRoute.snapshot();
        export const getBlogImage = () => new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/png" } });
      `, loader: "js" }));
    }
  }]);
  globalThis.__blogRoute = { snapshot: async () => ({ media: { "new.png": sha(21) } }) };
  const context = (path, headers = {}) => ({ params: { path }, locals: {}, url: new URL(origin), request: new Request(origin, { headers }) });
  try {
    const image = await GET(context("new.png"));
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(image.headers.get("Cache-Control"), "public, max-age=0, must-revalidate");
    assert.deepEqual(new Uint8Array(await image.arrayBuffer()), new Uint8Array([1, 2, 3]));
    assert.equal((await GET(context("new.png", { "If-None-Match": `"${sha(21)}"` }))).status, 304);
    const missing = await GET(context("missing.png"));
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get("Cache-Control"), "no-store");
    globalThis.__blogRoute.snapshot = async () => { throw new Error("offline"); };
    assert.equal((await GET(context("new.png"))).status, 503);
    assert.equal((await GET(context("../.env"))).status, 404);
  } finally { delete globalThis.__blogRoute; }
});
