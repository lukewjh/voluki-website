import { SpeakingMindMap, type SpeakingMapNode } from "./speakingMindMap";

type Mode = "cards" | "map";

interface Selection {
  id: string;
  href: string;
  open: boolean;
}

const modeKey = "ielts-speaking:view";
const selectionKey = "ielts-speaking:question";

function readMode(): Mode {
  try {
    return localStorage.getItem(modeKey) === "map" ? "map" : "cards";
  } catch {
    return "cards";
  }
}

function readSelection(): Selection | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(selectionKey) ?? "null") as Selection | null;
    if (value && /^p[123]-[a-z0-9-]+$/.test(value.id) &&
        /^\/ielts-speaking\/part-[a-z0-9-]+\/$/.test(value.href) && typeof value.open === "boolean") {
      return value;
    }
  } catch {
    // The view still works when storage is unavailable.
  }
}

export function mountSpeakingView(root: HTMLElement) {
  const toolbar = root.querySelector<HTMLElement>("[data-view-toolbar]")!;
  const buttons = [...root.querySelectorAll<HTMLButtonElement>("[data-view-mode]")];
  const cards = root.querySelector<HTMLElement>("[data-speaking-cards]")!;
  const panel = root.querySelector<HTMLElement>("[data-map-panel]")!;
  const viewport = panel.querySelector<HTMLElement>("[data-map-viewport]")!;
  const status = panel.querySelector<HTMLElement>("[data-map-status]")!;
  const retry = panel.querySelector<HTMLButtonElement>("[data-map-retry]")!;
  const resume = panel.querySelector<HTMLButtonElement>("[data-map-resume]")!;
  const reader = root.querySelector<HTMLDialogElement>("[data-map-reader]")!;
  const readerContent = reader.querySelector<HTMLElement>("[data-reader-content]")!;
  const readerSwitch = reader.querySelector<HTMLButtonElement>("[data-reader-switch]")!;
  const localCards = new Map([...cards.querySelectorAll<HTMLElement>("[data-speaking-question]")]
    .map((card) => [card.id, card]));
  const path = window.location.pathname.replace(/\/?$/, "/");
  const hashCard = localCards.get(window.location.hash.slice(1));
  const topic = root.dataset.speakingTopic;

  let mode = readMode();
  let selection = readSelection();
  if (topic && selection?.href !== path) selection = undefined;
  let map: SpeakingMindMap | undefined;
  let mapData: Promise<SpeakingMapNode> | undefined;
  let loadVersion = 0;
  let cardRequest: AbortController | undefined;

  function remember(next: Selection) {
    selection = next;
    resume.disabled = false;
    map?.select(next.id);
    try {
      sessionStorage.setItem(selectionKey, JSON.stringify(next));
    } catch {
      // Keep the selection in memory.
    }
  }

  function rememberLocal(card: HTMLElement) {
    remember({ id: card.id, href: path, open: card.querySelector("details")!.open });
  }

  function renderMode() {
    root.dataset.mode = mode;
    cards.hidden = mode === "map";
    panel.hidden = mode !== "map";
    for (const button of buttons) {
      button.setAttribute("aria-pressed", String(button.dataset.viewMode === mode));
    }
  }

  function applyMode(next: Mode) {
    mode = next;
    loadVersion += 1;
    try {
      localStorage.setItem(modeKey, mode);
    } catch {
      // Keep the view preference in memory.
    }
    renderMode();
  }

  function visibleCard() {
    const top = toolbar.getBoundingClientRect().bottom;
    const readingLine = Math.max(top + 1, window.innerHeight * 0.32);
    const selected = selection?.href === path ? localCards.get(selection.id) : undefined;
    if (selected?.querySelector("details")?.open) {
      const rect = selected.getBoundingClientRect();
      if (rect.bottom > top && rect.top < window.innerHeight) return selected;
    }
    let firstVisible: HTMLElement | undefined;
    for (const card of localCards.values()) {
      const rect = card.getBoundingClientRect();
      if (rect.top <= readingLine && rect.bottom > readingLine) return card;
      if (!firstVisible && rect.bottom > top && rect.top < window.innerHeight) firstVisible = card;
    }
    return firstVisible ?? selected ?? localCards.values().next().value;
  }

  function showLocalCard(card: HTMLElement, open: boolean, focus: boolean) {
    card.querySelector("details")!.open = open;
    requestAnimationFrame(() => {
      if (mode !== "cards") return;
      card.scrollIntoView({ block: "start" });
      if (focus) {
        const prompt = card.querySelector<HTMLElement>(".question-prompt")!;
        prompt.tabIndex = -1;
        prompt.focus({ preventScroll: true });
      }
    });
  }

  function returnToCards() {
    const detail = readerContent.querySelector("details");
    if (reader.open && detail && selection) remember({ ...selection, open: detail.open });
    applyMode("cards");
    if (reader.open) reader.close();
    if (!selection) return;
    const local = selection.href === path && localCards.get(selection.id);
    if (local) {
      const url = new URL(window.location.href);
      url.hash = selection.id;
      history.replaceState(history.state, "", url);
      showLocalCard(local, selection.open, true);
    } else {
      window.location.assign(selection.href + "#" + selection.id);
    }
  }

  async function openQuestion(node: SpeakingMapNode) {
    if (!node.href || mode !== "map") return;
    const local = node.href === path && localCards.get(node.id);
    const open = local ? local.querySelector("details")!.open : selection?.id === node.id && selection.open;
    remember({ id: node.id, href: node.href, open: Boolean(open) });

    cardRequest?.abort();
    const request = new AbortController();
    cardRequest = request;
    readerContent.textContent = "正在打开题卡…";
    readerContent.setAttribute("aria-busy", "true");
    if (!reader.open) reader.showModal();

    try {
      let source = local || undefined;
      let notice = local ? document.querySelector("[data-speaking-sync-notice]") : null;
      if (!source) {
        const response = await fetch(node.href, { signal: request.signal });
        if (!response.ok) throw new Error("Question page is unavailable");
        const document = new DOMParser().parseFromString(await response.text(), "text/html");
        source = document.getElementById(node.id) ?? undefined;
        notice = document.querySelector("[data-speaking-sync-notice]");
      }
      if (request.signal.aborted) return;
      if (!source?.matches("[data-speaking-question]")) throw new Error("Question card is missing");
      const card = source.cloneNode(true) as HTMLElement;
      card.removeAttribute("id");
      card.querySelector("details")!.open = Boolean(open);
      readerContent.replaceChildren(...(notice ? [notice.cloneNode(true), card] : [card]));
      readerContent.scrollTop = 0;
    } catch {
      if (request.signal.aborted) return;
      readerContent.textContent = "无法打开题卡。";
      const link = document.createElement("a");
      link.href = node.href + "#" + node.id;
      link.textContent = "前往话题页";
      readerContent.append(" ", link);
    } finally {
      if (!request.signal.aborted) readerContent.removeAttribute("aria-busy");
    }
  }

  async function showMap(openSelected = false) {
    const version = ++loadVersion;
    status.textContent = map ? "" : "正在载入导图…";
    retry.hidden = true;
    try {
      if (!map) {
        mapData ??= fetch("/ielts-speaking/map.json").then((response) => {
          if (!response.ok) throw new Error("Mind map is unavailable");
          return response.json() as Promise<SpeakingMapNode>;
        });
        const data = await mapData;
        if (mode !== "map" || version !== loadVersion) return;
        map = new SpeakingMindMap(viewport, data, (node) => void openQuestion(node));
      }
      status.textContent = "";
      const current = selection && (!topic || selection.href === path) ? selection : undefined;
      const part = new URLSearchParams(window.location.search).get("part");
      if (current) map.locate(current.id);
      else if (topic) map.locate(topic);
      else if (part === "2-3") map.locate("map-part-2-3");
      if (current && openSelected) {
        const node = map.getNode(current.id);
        if (node) void openQuestion(node);
      }
    } catch {
      mapData = undefined;
      if (mode !== "map" || version !== loadVersion) return;
      status.textContent = "导图暂时无法载入。";
      retry.hidden = false;
    }
  }

  cards.addEventListener("toggle", (event) => {
    const detail = event.target;
    if (mode !== "cards" || !(detail instanceof HTMLDetailsElement)) return;
    const card = detail.closest<HTMLElement>("[data-speaking-question]");
    if (card) rememberLocal(card);
  }, true);
  reader.addEventListener("toggle", (event) => {
    const detail = event.target;
    if (!(detail instanceof HTMLDetailsElement) || !reader.open || !selection) return;
    const local = selection.href === path && localCards.get(selection.id);
    if (local) local.querySelector("details")!.open = detail.open;
    remember({ ...selection, open: detail.open });
  }, true);
  reader.addEventListener("close", () => {
    if (reader.open) return;
    cardRequest?.abort();
    readerContent.removeAttribute("aria-busy");
    if (mode === "map") map?.focusSelected();
  });
  reader.querySelector("[data-reader-close]")!.addEventListener("click", () => reader.close());
  readerSwitch.addEventListener("click", returnToCards);

  for (const button of buttons) {
    button.addEventListener("click", () => {
      const next = button.dataset.viewMode as Mode;
      if (next === mode) return;
      if (next === "cards") {
        returnToCards();
      } else {
        const card = visibleCard();
        if (card) rememberLocal(card);
        applyMode("map");
        panel.scrollIntoView({ block: "nearest" });
        void showMap(Boolean(card && selection?.open));
      }
    });
  }
  retry.addEventListener("click", () => void showMap());
  resume.addEventListener("click", () => {
    if (selection) map?.locate(selection.id);
  });
  panel.querySelector("[data-map-reset]")!.addEventListener("click", () => map?.reset());
  panel.querySelector("[data-map-zoom-in]")!.addEventListener("click", () => map?.zoom(1.2));
  panel.querySelector("[data-map-zoom-out]")!.addEventListener("click", () => map?.zoom(1 / 1.2));

  if (hashCard) {
    const savedOpen = selection?.id === hashCard.id && selection.open;
    hashCard.querySelector("details")!.open = Boolean(savedOpen);
    rememberLocal(hashCard);
  }
  resume.disabled = !selection;
  toolbar.hidden = false;
  renderMode();
  if (mode === "map") void showMap(Boolean(hashCard));
  else if (hashCard) showLocalCard(hashCard, Boolean(selection?.open), false);
}
