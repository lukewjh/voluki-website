import { rioLists, type RioType } from "./rioMaterials";

type Book = { id: string; name: string };
type Mapping = Record<string, RioType>;
type BookWords = { words: string[]; page: number; complete: boolean; atLimit: boolean };
type SearchGroup = {
  section: HTMLElement;
  countLabel: HTMLElement;
  entries: { row: HTMLTableRowElement; text: string }[];
};
const endpoint = "/api/rio/eudic";

async function request<T>(query = "", options: RequestInit = {}): Promise<T> {
  const response = await fetch(endpoint + query, { ...options, cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "读取失败，请重试。");
  return data;
}

export function initRioLibrary() {
  const connect = document.querySelector<HTMLFormElement>("#rio-connect")!;
  const key = document.querySelector<HTMLInputElement>("#rio-eudic-key")!;
  const disconnect = document.querySelector<HTMLButtonElement>("#rio-disconnect")!;
  const mappingForm = document.querySelector<HTMLFormElement>("#rio-mapping")!;
  const choices = document.querySelector<HTMLElement>("#rio-book-choices")!;
  const status = document.querySelector<HTMLElement>("#rio-sync-status")!;
  const retry = document.querySelector<HTMLButtonElement>("#rio-sync-retry")!;
  const choiceTemplate = document.querySelector<HTMLTemplateElement>("#rio-book-choice")!;
  const rowTemplate = document.querySelector<HTMLTemplateElement>("#rio-word-row")!;
  const wordRow = rowTemplate.content.querySelector("tr")!;
  const search = document.querySelector<HTMLElement>("#rio-library-search")!;
  const searchInput = document.querySelector<HTMLInputElement>("#rio-search-input")!;
  const clearSearch = document.querySelector<HTMLButtonElement>("#rio-clear-search")!;
  const searchStatus = document.querySelector<HTMLElement>("#rio-search-status")!;
  let searchGroups: SearchGroup[] = [];
  let books: Book[] = [];
  let mapping: Mapping = {};
  let scope: string | null = null;
  let active = new AbortController();
  let retryAction: () => Promise<void> = () => connectBooks("GET");
  const cache = new Map<string, BookWords>();
  const requestTimes: number[] = [];
  const storageKey = () => "rio.eudic.mapping." + scope;

  function filterWords() {
    const query = searchInput.value.trim().toLowerCase();
    let totalMatches = 0;
    for (const { section, countLabel, entries } of searchGroups) {
      let matches = 0;
      for (const { row, text } of entries) {
        const hidden = !text.includes(query);
        if (row.hidden !== hidden) row.hidden = hidden;
        if (!hidden) matches++;
      }
      section.hidden = Boolean(query) && matches === 0;
      countLabel.textContent = query ? `${matches} / ${entries.length} 条` : `${entries.length} 条`;
      totalMatches += matches;
    }
    search.hidden = !searchGroups.length;
    clearSearch.hidden = !searchInput.value;
    searchStatus.textContent = !search.hidden && query && !totalMatches ? "没有找到匹配的词条" : "";
  }

  function render(loading = false) {
    let count = 0;
    searchGroups = [];
    for (const list of rioLists) {
      const section = document.querySelector<HTMLElement>(`[data-rio-list="${list.type}"]`)!;
      const sources = books.filter((book) => mapping[book.id] === list.type);
      const rows = document.createDocumentFragment();
      const entries: SearchGroup["entries"] = [];
      const words = new Set(loading ? [] : sources.flatMap((book) => cache.get(book.id)?.words ?? []));
      for (const word of words) {
        const row = wordRow.cloneNode(true) as HTMLTableRowElement;
        const quiz = row.querySelector<HTMLButtonElement>("[data-rio-quiz-material]")!;
        const id = String(++count);
        Object.assign(quiz.dataset, { rioMaterialId: id, rioMaterialType: list.type, rioMaterialText: word });
        quiz.textContent = word;
        entries.push({ row, text: word.toLowerCase() });
        rows.append(row);
      }
      section.querySelector("tbody")!.replaceChildren(rows);
      section.querySelector("table")!.hidden = !words.size;
      section.querySelector<HTMLElement>(".rio-empty")!.hidden = Boolean(words.size);
      section.hidden = loading || !sources.length;
      if (!section.hidden) {
        const countLabel = section.querySelector<HTMLElement>("[data-rio-count]")!;
        searchGroups.push({ section, countLabel, entries });
      }
    }
    filterWords();
    return count;
  }

  function showChoices() {
    choices.replaceChildren();
    for (const book of books) {
      const row = choiceTemplate.content.cloneNode(true) as DocumentFragment;
      row.querySelector("span")!.textContent = book.name;
      const select = row.querySelector("select")!;
      select.dataset.book = book.id;
      select.value = mapping[book.id] ?? "";
      choices.append(row);
    }
    mappingForm.hidden = !books.length;
  }

  function cancelLoad() {
    active.abort();
    active = new AbortController();
    retry.hidden = true;
    return active.signal;
  }

  async function loadWords() {
    const signal = cancelLoad();
    const mapped = books.filter((book) => mapping[book.id]);
    render(true);
    if (!mapped.length) {
      status.textContent = books.length ? "选好对应列表后，保存映射即可加载词条。" : "这个账号还没有英语生词本。";
      return;
    }
    const limited = [];
    try {
      for (const book of mapped) {
        const entry = cache.get(book.id) ?? { words: [], page: 0, complete: false, atLimit: false };
        cache.set(book.id, entry);
        while (!entry.complete) {
          status.textContent = `正在读取「${book.name}」第 ${entry.page + 1} 页…`;
          // Leave room under Eudic’s 30 requests/minute limit for catalog reads.
          while (requestTimes.length && Date.now() - requestTimes[0] >= 60_000) requestTimes.shift();
          if (requestTimes.length >= 25) {
            status.textContent = "正在等待欧路请求额度，稍后会自动继续…";
            await new Promise((resolve) => setTimeout(resolve, 60_010 - (Date.now() - requestTimes[0])));
            if (signal.aborted) return;
            continue;
          }
          requestTimes.push(Date.now());
          const params = new URLSearchParams({ book: book.id, page: String(entry.page) });
          const data = await request<{ words: string[]; hasMore: boolean; atLimit: boolean }>("?" + params, {
            signal, headers: { "X-RIO-Scope": scope! }
          });
          if (signal.aborted) return;
          entry.words.push(...data.words);
          entry.page++;
          entry.complete = !data.hasMore;
          entry.atLimit = data.atLimit;
        }
        if (entry.atLimit) limited.push(book.name);
      }
      const count = render();
      status.textContent = `已加载 ${mapped.length} 个生词本，共 ${count} 条。` +
        (limited.length ? `「${limited.join("、")}」已达到欧路分页上限，仅显示最近 5100 条。` : "");
    } catch (error) {
      if (signal.aborted) return;
      const count = render();
      status.textContent = `已加载 ${count} 条。` + errorMessage(error);
      retryAction = loadWords;
      retry.hidden = false;
    }
  }

  function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : "暂时无法读取生词本，请重试。";
  }

  async function connectBooks(method: "GET" | "POST" | "DELETE") {
    cancelLoad();
    const controls = connect.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button, input");
    controls.forEach((control) => { control.disabled = true; });
    mappingForm.hidden = true;
    status.textContent = method === "DELETE" ? "正在断开连接…" : "正在获取生词本列表…";
    try {
      const data = await request<{ books?: Book[]; scope?: string }>("", {
        method,
        ...(method === "POST" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: key.value }) } : {})
      });
      if (scope !== (data.scope ?? null)) searchInput.value = "";
      scope = data.scope ?? null;
      books = data.books ?? [];
      mapping = {};
      cache.clear();
      key.value = "";
      disconnect.hidden = !scope;
      if (scope) {
        try {
          const saved = JSON.parse(localStorage.getItem(storageKey()) ?? "{}");
          mapping = Object.fromEntries(books.filter((book) => rioLists.some((list) => list.type === saved?.[book.id]))
            .map((book) => [book.id, saved[book.id]]));
        } catch { /* A fresh mapping can replace unreadable local settings. */ }
      }
      showChoices();
      if (scope) void loadWords();
      else {
        render();
        status.textContent = "输入欧路 API Key，连接你的英语生词本。";
      }
    } catch (error) {
      showChoices();
      status.textContent = errorMessage(error);
      retryAction = () => connectBooks(method);
      if (method === "GET") disconnect.hidden = false;
      retry.hidden = false;
    } finally {
      controls.forEach((control) => { control.disabled = false; });
    }
  }

  searchInput.addEventListener("input", filterWords);
  clearSearch.addEventListener("click", () => {
    searchInput.value = "";
    filterWords();
    searchInput.focus();
  });
  connect.addEventListener("submit", (event) => { event.preventDefault(); void connectBooks("POST"); });
  disconnect.addEventListener("click", () => void connectBooks("DELETE"));
  retry.addEventListener("click", () => void retryAction());
  mappingForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const next: Mapping = {};
    for (const select of choices.querySelectorAll("select")) {
      const list = rioLists.find((item) => item.type === select.value);
      if (list) next[select.dataset.book!] = list.type;
    }
    try {
      localStorage.setItem(storageKey(), JSON.stringify(next));
      mapping = next;
      void loadWords();
    } catch {
      status.textContent = "无法保存映射，请允许此站点使用浏览器存储。";
    }
  });
  void connectBooks("GET");
}
