import type { APIRoute } from "astro";
import { resolveAiConfig } from "../../../lib/aiConfig";

export const prerender = false;

const miniMaxHosts = new Set(["api.minimax.cn", "api.minimax.io", "api.minimaxi.com", "api-bj.minimaxi.com"]);
const cacheHeaders = { "Cache-Control": "private, no-store" };
const fail = (error: string, status: number) => Response.json({ error }, { status, headers: cacheHeaders });

function getSpeechEndpoint(baseUrl: string) {
  try {
    const url = new URL(baseUrl);
    if (url.protocol === "https:" && !url.port && !url.username && !url.password && miniMaxHosts.has(url.hostname)) {
      return `${url.origin}/v1/t2a_v2`;
    }
  } catch { /* An invalid default URL also needs to be updated in AI settings. */ }
}

export const POST: APIRoute = async ({ request, locals }) => {
  const config = resolveAiConfig(request, locals);
  if (config instanceof Response) return config;
  const endpoint = getSpeechEndpoint(config.apiBaseUrl);
  if (!endpoint || !config.apiKey) {
    return fail("发音需要 MiniMax。请在顶部「AI 请求设置」中使用 MiniMax 官方 API 地址和 Key。", 400);
  }

  const body = await request.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text || text.length > 500) return fail("请输入不超过 500 个字符的词条。", 400);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        model: "speech-2.8-turbo",
        text,
        stream: false,
        language_boost: "English",
        output_format: "hex",
        voice_setting: { voice_id: "English_expressive_narrator", speed: 1 },
        audio_setting: { format: "mp3", sample_rate: 32000, bitrate: 128000, channel: 1 }
      })
    });

    const result = response.ok ? await response.json() : undefined;
    if (!response.ok) await response.body?.cancel();
    const code = result?.base_resp?.status_code;
    if (response.status === 429 || code === 1002 || code === 1039) {
      return fail("MiniMax 语音暂时限流，请稍后重试。", 429);
    }
    if (response.status === 401 || response.status === 403 || code === 1004) {
      return fail("MiniMax 未授权本次发音，请检查 AI 设置中的 Key 是否支持语音合成。", 403);
    }
    if (response.status === 402 || code === 1008) return fail("MiniMax 余额不足，请检查语音额度。", 402);

    const hex = result?.data?.audio;
    if (code !== 0 || result?.data?.status !== 2 || typeof hex !== "string" || hex.length < 8 ||
        hex.length > 4_000_000 || hex.length % 2 || !/^[0-9a-f]+$/i.test(hex)) {
      return fail("MiniMax 未返回可播放的音频，请稍后重试。", 502);
    }
    const audio = new Uint8Array(hex.length / 2);
    for (let i = 0; i < audio.length; i++) audio[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    const hasId3 = audio[0] === 0x49 && audio[1] === 0x44 && audio[2] === 0x33;
    if (!hasId3 && !(audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0)) {
      return fail("MiniMax 返回的音频格式有误，请重试。", 502);
    }
    return new Response(audio, { headers: { ...cacheHeaders, "Content-Type": "audio/mpeg" } });
  } catch {
    return fail("暂时无法连接 MiniMax 语音服务，请重试。", 502);
  }
};
