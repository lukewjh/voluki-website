import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

// Bundle the real helpers/routes in memory without loading local .env secrets.
async function load(entry) {
  const result = await build({ entryPoints: [entry], bundle: true, write: false, platform: "node", format: "esm", define: { "import.meta.env": "{}" }, logLevel: "silent" });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}
const { resolveAiConfig } = await load("src/lib/aiConfig.ts");
const client = await load("src/lib/aiClient.ts");
const settings = { apiKey: "test-user-key", model: "test-model", baseUrl: "https://api.openai.com/v1/" };
const locals = { runtime: { env: { DEEPSEEK_API_KEY: "test-server-secret", OPENAI_MODEL: "server-model", AI_BASE_URL: "https://api.deepseek.com/" } } };
const request = (config) => new Request("https://voluki.test/api/ielts/split", { method: "POST", headers: config === undefined ? {} : { "X-Voluki-AI-Settings": encodeURIComponent(JSON.stringify(config)) } });

test("default configuration stays on the server and normalizes trailing slashes", () => {
  assert.deepEqual(resolveAiConfig(request(), locals), { apiKey: "test-server-secret", model: "server-model", apiBaseUrl: "https://api.deepseek.com" });
});

test("custom configuration overrides all three fields and never inherits the server key", () => {
  assert.deepEqual(resolveAiConfig(request(settings), locals), { apiKey: settings.apiKey, model: settings.model, apiBaseUrl: "https://api.openai.com/v1" });
  for (const apiKey of ["", undefined, "key\nInjected", "密钥"]) {
    assert.equal(resolveAiConfig(request({ ...settings, apiKey }), locals).status, 400);
  }
});

test("invalid or unsafe endpoints are rejected before an upstream request", () => {
  for (const baseUrl of ["http://api.openai.com", "https://localhost", "https://127.0.0.1", "https://[::1]", "https://service.internal", "https://user:password@api.openai.com", "https://api.openai.com?key=x", "https://api.openai.com:8443", "not-a-url"]) {
    assert.equal(resolveAiConfig(request({ ...settings, baseUrl }), locals).status, 400, baseUrl);
  }
  const malformed = new Request("https://voluki.test", { headers: { "X-Voluki-AI-Settings": "%" } });
  assert.equal(resolveAiConfig(malformed, locals).status, 400);
});

test("session settings are read anew for each request and can be reset", () => {
  const store = new Map();
  globalThis.sessionStorage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: (key) => store.delete(key) };
  assert.deepEqual(client.aiRequestHeaders(), { "Content-Type": "application/json" });
  client.saveAiSettings(settings);
  assert.equal(resolveAiConfig(new Request("https://voluki.test", { headers: client.aiRequestHeaders() }), locals).model, settings.model);
  client.saveAiSettings({ ...settings, model: "changed-model" });
  assert.equal(resolveAiConfig(new Request("https://voluki.test", { headers: client.aiRequestHeaders() }), locals).model, "changed-model");
  client.saveAiSettings(null);
  assert.deepEqual(client.aiRequestHeaders(), { "Content-Type": "application/json" });
  globalThis.sessionStorage = { getItem() { throw new Error("blocked"); } };
  assert.throws(() => client.aiRequestHeaders(), /无法读取 AI 配置/);
});

test("split API sends the configured key, model and endpoint to the AI provider", async () => {
  const { POST } = await load("src/pages/api/ielts/split.ts");
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async (url, options) => {
    called = true;
    assert.equal(url, "https://api.openai.com/v1/chat/completions");
    assert.equal(options.headers.Authorization, "Bearer test-user-key");
    assert.equal(JSON.parse(options.body).model, "test-model");
    assert.equal(options.redirect, "manual");
    return Response.json({ choices: [{ message: { content: JSON.stringify({ sentences: [{ sequence: 1, english_text: "Hello.", chinese_text: "你好。" }] }) } }] });
  };
  try {
    const response = await POST({ request: new Request(request(settings), { body: JSON.stringify({ text: "Hello." }) }), locals });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).sentences[0].english_text, "Hello.");
    assert.equal(called, true);
  } finally { globalThis.fetch = originalFetch; }
});

test("essay generation includes a user request for both random and selected categories", async () => {
  const { POST } = await load("src/pages/api/ielts/generate-essay.ts");
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    requests.push(payload);
    // Reproduce providers that reject a conversation containing only system instructions.
    if (!payload.messages.some((message) => message.role === "user" && message.content?.trim())) {
      return Response.json({ error: { message: "invalid params, chat content is empty (2013)" } }, { status: 400 });
    }
    return Response.json({ choices: [{ message: { content: JSON.stringify({ category: "Education", question: "Test question", essay: "Test essay" }) } }] });
  };
  try {
    for (const body of [{}, { category: "Education" }]) {
      const response = await POST({ request: new Request(request(settings), { body: JSON.stringify(body) }), locals });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).essay, "Test essay");
    }
    assert.match(requests[0].messages.find((message) => message.role === "user").content, /随机/);
    assert.match(requests[1].messages.find((message) => message.role === "user").content, /Education/);
  } finally { globalThis.fetch = originalFetch; }
});
