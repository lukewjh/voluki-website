import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, unlink } from "node:fs/promises";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

const season = "2026-sep-dec";
const bankDir = new URL(`../tiku-answer/${season}/`, import.meta.url);
const audioDir = new URL(`../audio/${season}/`, import.meta.url);
const manifestPath = new URL("manifest.json", audioDir);
const lockPath = new URL(".generation.lock", audioDir);
const partPrefixes = { "part-1": "p1-", student: "p1-", work: "p1-", "part-3": "p3-" };
const modelDefault = "speech-2.8-turbo";
const voiceDefault = "English_expressive_narrator";
const allowedHosts = new Set(["api.minimax.cn", "api.minimax.io", "api.minimaxi.com"]);

async function readOptional(path) {
  try {
    return await readFile(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return undefined;
  }
}

async function readQuestions() {
  const questions = new Map();
  const files = (await readdir(bankDir)).filter((name) => name.endsWith(".json")).sort();
  for (const name of files) {
    const topic = JSON.parse(await readFile(new URL(name, bankDir), "utf8"));
    for (const section of topic.sections) {
      if (section.id === "part-2") continue;
      const prefix = partPrefixes[section.id];
      for (const { id, prompt } of section.questions) {
        if (!prefix || typeof id !== "string" || !id.startsWith(prefix) ||
            !/^p[13]-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || questions.has(id)) {
          throw new Error(`Invalid or duplicate question ID in ${name}.`);
        }
        const text = typeof prompt === "string" ? prompt.trim() : "";
        if (!text || [...text].length >= 10000) throw new Error(`Invalid prompt for ${id}.`);
        questions.set(id, text);
      }
    }
  }
  if (!questions.size) throw new Error("No eligible speaking questions found.");
  return questions;
}

function readConfig() {
  const endpoint = new URL(process.env.MINIMAX_API_URL?.trim() || "https://api.minimax.cn/v1/t2a_v2");
  if (endpoint.protocol !== "https:" || !allowedHosts.has(endpoint.hostname) || endpoint.port ||
      endpoint.pathname !== "/v1/t2a_v2" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error("Set MINIMAX_API_URL to an official MiniMax /v1/t2a_v2 HTTPS endpoint.");
  }
  const speed = Number(process.env.MINIMAX_SPEED?.trim() || "1");
  if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) throw new Error("MINIMAX_SPEED must be between 0.5 and 2.");
  return {
    endpoint,
    settings: {
      model: process.env.MINIMAX_MODEL?.trim() || modelDefault,
      stream: false,
      language_boost: "English",
      output_format: "hex",
      voice_setting: { voice_id: process.env.MINIMAX_VOICE_ID?.trim() || voiceDefault, speed },
      audio_setting: { format: "mp3", sample_rate: 32000, bitrate: 128000, channel: 1 }
    }
  };
}

const hash = (data) => createHash("sha256").update(data).digest("hex");

async function atomicWrite(path, data) {
  const temporary = new URL(`.${randomUUID()}.tmp`, audioDir);
  const file = await open(temporary, "wx");
  try {
    try {
      await file.writeFile(data);
    } finally {
      await file.close();
    }
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary);
    throw error;
  }
}

async function synthesize(endpoint, apiKey, payload, signal) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // A dropped connection may have been billed. Leave that item pending for a manual rerun.
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: payload,
      redirect: "error",
      signal: AbortSignal.timeout(45_000)
    });
    const result = response.ok ? await response.json() : undefined;
    const code = result?.base_resp?.status_code;
    if (response.status === 429 || code === 1002 || code === 1039) {
      if (!response.ok) await response.body?.cancel();
      const retryAfter = response.headers.get("Retry-After");
      const seconds = retryAfter ? Number(retryAfter) : NaN;
      const wait = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
      if (attempt === 2 || wait > 60_000) throw new Error("MiniMax rate limit reached. Rerun after the quota window clears.");
      await delay(Math.max(2_000 * (attempt + 1), Number.isFinite(wait) ? wait : 0), undefined, { signal });
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`MiniMax HTTP ${response.status}. Check the key and endpoint in .env.audio.`);
    }
    if (code !== 0) throw new Error(`MiniMax status ${Number.isInteger(code) ? code : "unknown"}. Check the key, voice, model and quota in the console.`);

    const hex = result?.data?.audio;
    if (result?.data?.status !== 2 || typeof hex !== "string" || hex.length % 2 || !/^[0-9a-f]+$/i.test(hex)) {
      throw new Error("MiniMax did not return completed audio as hexadecimal data.");
    }
    const audio = Buffer.from(hex, "hex");
    if (audio.length < 4 || !(audio.toString("ascii", 0, 3) === "ID3" ||
        (audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0))) {
      throw new Error("MiniMax response is missing an MP3 header.");
    }
    return { audio, usage: result.extra_info?.usage_characters };
  }
}

async function makePlan(selected, endpoint, settings) {
  const saved = await readOptional(manifestPath);
  const manifest = saved ? JSON.parse(saved.toString("utf8")) : { version: 1, questions: {} };
  if (manifest?.version !== 1 || !manifest.questions || typeof manifest.questions !== "object" || Array.isArray(manifest.questions)) {
    throw new Error("Invalid audio manifest.");
  }

  const pending = [];
  for (const [id, text] of selected) {
    const payload = JSON.stringify({ ...settings, text });
    const signature = hash(endpoint.href + "\n" + payload);
    const file = new URL(`${id}.mp3`, audioDir);
    const entry = manifest.questions[id];
    const existing = entry?.signature === signature ? await readOptional(file) : undefined;
    if (!existing?.length || hash(existing) !== entry.audioHash) {
      pending.push({ id, file, text, payload, signature });
    }
  }
  return { pending, manifest };
}

async function main() {
  const { values: flags } = parseArgs({ options: {
    help: { type: "boolean", short: "h" },
    "dry-run": { type: "boolean" },
    sample: { type: "boolean" },
    id: { type: "string", multiple: true },
    all: { type: "boolean" }
  } });
  if (flags.help) {
    console.log("node scripts/generate-speaking-audio.mjs [--sample | --id QUESTION_ID ... | --all] [--dry-run]");
    console.log("No selection flags previews the full bank. --sample generates one Part 1 and one Part 3 prompt.");
    return;
  }
  const scopes = [flags.sample, flags.id?.length, flags.all].filter(Boolean).length;
  if (scopes > 1) throw new Error("Use only one of --sample, --id, or --all.");

  try {
    process.loadEnvFile(new URL("../.env.audio", import.meta.url));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const { endpoint, settings } = readConfig();
  const questions = await readQuestions();
  let selected = [...questions];
  if (flags.sample) {
    selected = ["p1-work-or-studies-work-01", "p3-important-decision-happy-result-01"]
      .map((id) => [id, questions.get(id)]);
  } else if (flags.id) {
    selected = [...new Set(flags.id)].map((id) => [id, questions.get(id)]);
  }
  const missing = selected.filter(([, text]) => !text).map(([id]) => id);
  if (missing.length) throw new Error(`Unknown or unsupported question IDs: ${missing.join(", ")}`);

  const generate = scopes > 0 && !flags["dry-run"];
  const apiKey = process.env.MINIMAX_API_KEY?.trim();
  if (generate && !apiKey) throw new Error("Add MINIMAX_API_KEY to .env.audio before generating.");
  let lock;
  if (generate) {
    await mkdir(audioDir, { recursive: true });
    try {
      lock = await open(lockPath, "wx");
    } catch (error) {
      if (error.code === "EEXIST") throw new Error(`Generation is already locked. If no run is active, remove audio/${season}/.generation.lock and retry.`);
      throw error;
    }
  }

  const stop = new AbortController();
  const interrupt = () => stop.abort();
  if (generate) process.on("SIGINT", interrupt);
  try {
    const { pending, manifest } = await makePlan(selected, endpoint, settings);
    const characters = pending.reduce((sum, { text }) => sum + [...text].length, 0);
    console.log(`${selected.length} selected, ${selected.length - pending.length} up to date, ${pending.length} pending (${characters} input characters).`);
    console.log(`Model: ${settings.model} | Voice: ${settings.voice_setting.voice_id} | Speed: ${settings.voice_setting.speed}`);
    if (!generate) {
      for (const { id, text } of pending.slice(0, 10)) console.log(`${id}  ${text}`);
      console.log("Preview only. No MiniMax requests sent.");
      return;
    }

    let generated = 0;
    let billedCharacters = 0;
    let usageReported = 0;
    for (const { id, file, payload, signature } of pending) {
      if (stop.signal.aborted) break;
      try {
        const { audio, usage } = await synthesize(endpoint, apiKey, payload, stop.signal);
        await atomicWrite(file, audio);
        manifest.questions[id] = { signature, audioHash: hash(audio) };
        await atomicWrite(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
        generated += 1;
        if (Number.isFinite(usage)) {
          billedCharacters += usage;
          usageReported += 1;
        }
        console.log(`[${generated}/${pending.length}] audio/${season}/${id}.mp3`);
      } catch (error) {
        if (!stop.signal.aborted) throw new Error(`${id}: ${error.message} Rerun the same command to resume.`);
      }
      if (generated < pending.length && !stop.signal.aborted) {
        await delay(500, undefined, { signal: stop.signal }).catch((error) => {
          if (error.name !== "AbortError") throw error;
        });
      }
    }
    console.log(`Saved ${generated} MP3 file(s).${usageReported ? ` MiniMax reported ${billedCharacters} billable characters for ${usageReported} file(s).` : ""}`);
    if (stop.signal.aborted) {
      console.log("Stopped. Rerun the same command to resume.");
      process.exitCode = 130;
    }
  } finally {
    process.off("SIGINT", interrupt);
    if (lock) {
      await lock.close();
      await unlink(lockPath);
    }
  }
}

main().catch((error) => {
  const secret = process.env.MINIMAX_API_KEY?.trim();
  const message = error instanceof Error ? error.message : String(error);
  console.error(secret ? message.replaceAll(secret, "[redacted]") : message);
  process.exitCode = 1;
});
