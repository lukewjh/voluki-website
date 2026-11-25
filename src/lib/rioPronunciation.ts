import { aiRequestHeaders } from "./aiClient";
import { AI_SETTINGS_HEADER } from "./aiSettings";

async function fetchPronunciation(context: AudioContext, text: string, headers: Record<string, string>) {
  const response = await fetch("/api/rio/pronounce", {
    method: "POST", headers, body: JSON.stringify({ text })
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || "生成发音失败，请重试。");
  }
  return context.decodeAudioData(await response.arrayBuffer());
}

export function initRioPronunciation(grid: Element, getAudioContext: () => AudioContext | null) {
  const status = document.querySelector<HTMLElement>("#rio-pronunciation-status")!;
  const cache = new Map<string, Promise<AudioBuffer>>();
  let configuration: string | undefined;
  let playing: AudioBufferSourceNode | undefined;
  let latest = 0;

  async function pronounce(button: HTMLButtonElement) {
    const readText = () => button.dataset.rioPronounce ?? button.dataset.rioMaterialText;
    const text = readText();
    if (!text) return;

    const request = ++latest;
    const cell = button.closest("td");
    if (cell) cell.append(status);
    else button.closest(".rio-deck")?.after(status);
    const stillVisible = () => button.isConnected && readText() === text && !button.closest("[hidden]");

    try {
      playing?.stop();
      playing = undefined;
      const headers = aiRequestHeaders();
      if (headers[AI_SETTINGS_HEADER] !== configuration) {
        configuration = headers[AI_SETTINGS_HEADER];
        cache.clear();
      }
      const context = getAudioContext();
      if (!context) throw new Error("当前浏览器无法播放词条发音。");
      // Resume during the click, before waiting for the network response.
      const ready = context.state === "running" ? Promise.resolve() : context.resume();
      let audio = cache.get(text);
      status.textContent = audio ? "" : "正在获取发音…";
      if (!audio) {
        const pending = fetchPronunciation(context, text, headers);
        cache.set(text, pending);
        if (cache.size > 100) cache.delete(cache.keys().next().value!);
        void pending.catch(() => { if (cache.get(text) === pending) cache.delete(text); });
        audio = pending;
      }

      const [buffer] = await Promise.all([audio, ready]);
      if (request !== latest) return;
      status.textContent = "";
      if (!stillVisible()) return;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = () => {
        source.disconnect();
        if (playing === source) playing = undefined;
      };
      source.start();
      playing = source;
    } catch (error) {
      if (request !== latest) return;
      status.textContent = stillVisible() && error instanceof Error ? error.message : "";
    }
  }

  grid.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>("[data-rio-pronounce]");
    if (button) void pronounce(button);
  });
  return pronounce;
}
