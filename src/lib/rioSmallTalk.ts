import { aiRequestHeaders } from "./aiClient";

type Action = "open" | "hint" | "reply";
type Turn = { role: "assistant" | "user"; content: string };

// Keep incomplete events and UTF-8 characters across network reads.
async function readReply(body: ReadableStream<Uint8Array>, append: (text: string) => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let complete = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (done) buffer += "\n\n";
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop()!;
      for (const event of events) {
        const data = event.split(/\r?\n/).filter(line => line.startsWith("data:"))
          .map(line => line.slice(5).trimStart()).join("\n");
        if (!data) continue;
        if (data === "[DONE]") return;
        const packet = JSON.parse(data);
        if (packet.error) throw new Error("AI 回复中断，请重试。");
        const choice = packet.choices?.[0];
        if (typeof choice?.delta?.content === "string") append(choice.delta.content);
        if (choice?.finish_reason === "stop") complete = true;
        else if (choice?.finish_reason) throw new Error("AI 未能完成回复，请重试。");
      }
      if (done) break;
    }
    if (!complete) throw new Error("连接已中断，请重试。");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function openSmallTalk(idiom: string) {
  const dialog = document.querySelector<HTMLDialogElement>("#rio-talk")!;
  if (dialog.open) return;
  const log = dialog.querySelector<HTMLElement>(".messages")!;
  const form = dialog.querySelector("form")!;
  const input = form.querySelector("input")!;
  const send = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
  const hint = form.querySelector<HTMLButtonElement>("[data-hint]")!;
  const retry = form.querySelector<HTMLButtonElement>("[data-retry]")!;
  const status = form.querySelector<HTMLElement>('[role="status"]')!;
  const session = new AbortController();
  const { signal } = session;
  const history: Turn[] = [];
  let busy = false;
  let failed: Action | undefined;
  let follow = true;

  function controls() {
    const waiting = busy || !history.length || failed === "reply";
    hint.disabled = waiting;
    send.disabled = waiting || !input.value.trim();
    retry.hidden = !failed;
  }

  function scrollToLatest() {
    if (follow) log.scrollTop = log.scrollHeight;
  }
  function sizeToKeyboard() {
    const viewport = window.visualViewport;
    if (viewport) {
      dialog.style.setProperty("--talk-height", viewport.height + "px");
      dialog.style.setProperty("--talk-top", viewport.offsetTop + "px");
    }
    scrollToLatest();
  }
  function bubble(role: Turn["role"] | "hint", text: string) {
    const message = document.createElement("p");
    message.dataset.role = role;
    message.lang = "en";
    message.textContent = text;
    log.append(message);
    scrollToLatest();
    return message;
  }

  async function respond(action: Action) {
    if (busy) return;
    busy = true;
    failed = undefined;
    controls();
    status.textContent = action === "hint" ? "正在想提示…" : "AI 正在回复…";
    let message: HTMLElement | undefined;
    let answer = "";
    try {
      const response = await fetch("/api/rio/small-talk", {
        method: "POST", signal, headers: { ...aiRequestHeaders(), Accept: "text/event-stream" },
        body: JSON.stringify({ idiom, action, history: history.slice(-16) })
      });
      if (!response.ok || !response.body) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || `对话请求失败（HTTP ${response.status}）。`);
      }
      await readReply(response.body, text => {
        if (signal.aborted || !text) return;
        if (!message) message = bubble(action === "hint" ? "hint" : "assistant", action === "hint" ? "提示 · " : "");
        message.append(text);
        answer += text;
        scrollToLatest();
      });
      if (signal.aborted) return;
      if (!answer.trim()) throw new Error("AI 返回了空回复，请重试。");
      if (action !== "hint") history.push({ role: "assistant", content: answer.trim() });
      status.textContent = "";
    } catch (error) {
      if (signal.aborted) return;
      message?.remove();
      failed = action;
      status.textContent = error instanceof Error ? error.message : "连接失败，请重试。";
    } finally {
      if (!signal.aborted) {
        busy = false;
        controls();
      }
    }
  }

  log.replaceChildren();
  input.value = "";
  dialog.querySelector(".idiom")!.textContent = idiom;
  dialog.showModal();
  sizeToKeyboard();
  window.visualViewport?.addEventListener("resize", sizeToKeyboard, { signal });
  window.visualViewport?.addEventListener("scroll", sizeToKeyboard, { signal });
  log.addEventListener("scroll", () => {
    follow = log.scrollHeight - log.scrollTop - log.clientHeight < 20;
  }, { signal });
  dialog.querySelector("[data-close]")!.addEventListener("click", () => dialog.close(), { signal });
  dialog.addEventListener("close", () => session.abort(), { once: true });
  input.addEventListener("input", controls, { signal });
  hint.addEventListener("click", () => { follow = true; void respond("hint"); }, { signal });
  retry.addEventListener("click", () => { if (failed) void respond(failed); }, { signal });
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (send.disabled) return;
    const content = input.value.trim();
    input.value = "";
    history.push({ role: "user", content });
    follow = true;
    bubble("user", content);
    void respond("reply");
  }, { signal });
  void respond("open");
}
