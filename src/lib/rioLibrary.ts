import { rioLists, type RioMaterial, type RioType } from "./rioMaterials";
import { getRioShortcut } from "./rioKeyboard";

type Book = { id: string; name: string };
type Mapping = Record<string, RioType>;
type BookWord = { word: string; addedAt: number | null };
type BookWords = { entries: BookWord[]; page: number; complete: boolean; atLimit: boolean };
type Entry = { material: RioMaterial; searchText: string; addedDays: Set<string> };
type SearchGroup = {
  section: HTMLElement;
  countLabel: HTMLElement;
  entries: Entry[];
  matches: Entry[];
  position: number;
  page: number;
  preferredWord?: string;
};
const endpoint = "/api/rio/eudic";
const listPageSize = 10;
const recentDayCount = 7;
const shortDayFormat = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" });
const fullDayFormat = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric", month: "long", day: "numeric", weekday: "short"
});

function localDay(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function daysAgo(today: Date, offset: number) {
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset, 12);
}

function setWordButton(button: HTMLButtonElement, material: RioMaterial) {
  button.textContent = material.text;
  Object.assign(button.dataset, {
    rioMaterialId: String(material.id), rioMaterialType: material.type, rioMaterialText: material.text
  });
  const speaker = button.parentElement?.querySelector<HTMLButtonElement>("[data-rio-pronounce]");
  if (speaker) {
    speaker.dataset.rioPronounce = material.text;
    speaker.setAttribute("aria-label", `朗读 ${material.text}`);
  }
}

async function request<T>(query = "", options: RequestInit = {}): Promise<T> {
  const response = await fetch(endpoint + query, { ...options, cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "读取失败，请重试。");
  return data;
}

export function initRioLibrary(pronounce: (button: HTMLButtonElement) => Promise<void>) {
  const library = document.querySelector<HTMLDetailsElement>(".rio-library")!;
  const summary = library.querySelector("summary")!;
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
  const dateButton = document.querySelector<HTMLButtonElement>("#rio-search-time")!;
  const dateButtonLabel = dateButton.querySelector<HTMLElement>("[data-rio-date-label]")!;
  const dateDialog = document.querySelector<HTMLDialogElement>("#rio-date-dialog")!;
  const dateList = document.querySelector<HTMLElement>("#rio-date-list")!;
  const dateOptionTemplate = document.querySelector<HTMLTemplateElement>("#rio-date-option")!;
  const clearSearch = document.querySelector<HTMLButtonElement>("#rio-clear-search")!;
  const searchStatus = document.querySelector<HTMLElement>("#rio-search-status")!;
  const speakerTemplate = document.querySelector<HTMLTemplateElement>("#rio-pronunciation-button")!;
  const exitFocusButton = search.querySelector<HTMLButtonElement>("[data-rio-focus-exit]")!;
  const grid = document.querySelector<HTMLElement>("#rio-lists")!;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let focusTransition: Animation | undefined;
  let focus: { group: SearchGroup; scrollY: number; trigger: HTMLButtonElement } | undefined;
  let searchGroups: SearchGroup[] = [];
  let searchQuery = "";
  let searchDay = "";
  let books: Book[] = [];
  let mapping: Mapping = {};
  let scope: string | null = null;
  let active = new AbortController();
  let retryAction: () => Promise<void> = () => connectBooks("GET");
  const cache = new Map<string, BookWords>();
  const requestTimes: number[] = [];
  const storageKey = () => "rio.eudic.mapping." + scope;
  const isFiltering = () => Boolean(searchQuery || searchDay);

  function addSpeaker(wordButton: HTMLButtonElement, type: string | undefined) {
    if (type === "vocabulary" || type === "idiom") {
      wordButton.after(speakerTemplate.content.cloneNode(true));
    }
  }

  function paintListPage(group: SearchGroup) {
    const { section, matches, page } = group;
    const start = page * listPageSize;
    const rows = document.createDocumentFragment();
    for (const { material } of matches.slice(start, start + listPageSize)) {
      const row = wordRow.cloneNode(true) as HTMLTableRowElement;
      const wordButton = row.querySelector<HTMLButtonElement>("[data-rio-quiz-material]")!;
      addSpeaker(wordButton, material.type);
      setWordButton(wordButton, material);
      rows.append(row);
    }
    section.querySelector("tbody")!.replaceChildren(rows);

    const pageCount = Math.ceil(matches.length / listPageSize);
    const pagination = section.querySelector<HTMLElement>(".rio-list-pagination")!;
    pagination.hidden = pageCount <= 1;
    pagination.querySelector("[data-list-page-number]")!.textContent = pageCount ? `${page + 1} / ${pageCount}` : "";
    pagination.querySelector<HTMLButtonElement>('[data-list-page-step="-1"]')!.disabled = page === 0;
    pagination.querySelector<HTMLButtonElement>('[data-list-page-step="1"]')!.disabled = page + 1 >= pageCount;
  }

  function paintGroup(group: SearchGroup) {
    const { section, entries, countLabel, matches, position } = group;
    const filtering = isFiltering();
    const isFocused = focus?.group === group;
    const entry = matches[position];
    const deck = section.querySelector<HTMLElement>(".rio-deck")!;
    const button = deck.querySelector<HTMLButtonElement>(".rio-deck-word")!;
    const focusButton = section.querySelector<HTMLButtonElement>("[data-rio-focus]")!;
    const listToggle = section.querySelector<HTMLButtonElement>(".rio-list-toggle")!;
    const listContent = section.querySelector<HTMLElement>(".rio-list-content")!;
    const empty = section.querySelector<HTMLElement>(".rio-empty")!;
    section.hidden = focus ? !isFocused : filtering && !matches.length;
    listContent.hidden = !isFocused && listToggle.getAttribute("aria-expanded") === "false";
    section.querySelector("table")!.hidden = isFocused || !entries.length;
    deck.hidden = !isFocused || !entry;
    focusButton.hidden = isFocused;
    focusButton.disabled = !matches.length;
    empty.hidden = isFocused ? Boolean(entry) : Boolean(entries.length);
    empty.textContent = isFocused && filtering ? "该分类没有匹配的词条" : "暂无词条";
    if (isFocused && entry) {
      setWordButton(button, entry.material);
      countLabel.textContent = `${position + 1} / ${matches.length}`;
      deck.querySelectorAll<HTMLButtonElement>("[data-step]").forEach(arrow => { arrow.disabled = matches.length <= 1; });
    } else {
      countLabel.textContent = filtering ? `${matches.length} / ${entries.length} 条` : `${entries.length} 条`;
    }
  }

  function paintView() {
    grid.toggleAttribute("data-focused", Boolean(focus));
    library.hidden = Boolean(focus);
    exitFocusButton.hidden = !focus;
    searchGroups.forEach(paintGroup);
    const hasMatches = searchGroups.some(group => group.matches.length);
    searchStatus.textContent = !focus && isFiltering() && !hasMatches && searchGroups.length
      ? "没有找到匹配的词条" : "";
  }

  function animateFocusChange(entering: boolean) {
    focusTransition?.cancel();
    if (reducedMotion.matches || typeof grid.animate !== "function") return;

    const frames = entering
      ? [{ opacity: 0.35, transform: "translateY(8px)" }, { opacity: 1, transform: "translateY(0)" }]
      : [{ opacity: 0.5 }, { opacity: 1 }];
    focusTransition = grid.animate(frames, { duration: entering ? 180 : 140, easing: "ease-out" });
  }

  function filterWords(dateChanged = false) {
    const query = searchInput.value.trim().toLowerCase();
    const resetPage = dateChanged || query !== searchQuery;
    searchQuery = query;
    for (const group of searchGroups) {
      group.matches = group.entries.filter(({ searchText, addedDays }) =>
        searchText.includes(query) && (!searchDay || addedDays.has(searchDay))
      );
      group.position = Math.max(0, group.matches.findIndex(({ material }) => material.text === group.preferredWord));
      if (resetPage) group.page = 0;
      paintListPage(group);
    }
    search.hidden = !searchGroups.length;
    clearSearch.hidden = !searchInput.value;
    paintView();
  }

  function updateDateButton(today = new Date()) {
    let label = "按天";
    if (searchDay) {
      label = searchDay === localDay(today) ? "今天" : searchDay === localDay(daysAgo(today, 1)) ? "昨天"
        : shortDayFormat.format(new Date(`${searchDay}T12:00:00`));
    }
    dateButtonLabel.textContent = label;
    dateButton.setAttribute("aria-label", searchDay ? `${label}，按天筛选` : "按天筛选");
  }

  function openDates() {
    const today = new Date();
    const recentDays = Array.from({ length: recentDayCount }, (_, offset) => localDay(daysAgo(today, offset)));
    const counts = new Map<string, number>(recentDays.map(day => [day, 0]));
    let total = 0;
    for (const { entries } of searchGroups) {
      for (const { searchText, addedDays } of entries) {
        const matchesKeyword = searchText.includes(searchQuery);
        if (matchesKeyword) total++;
        for (const day of addedDays) {
          counts.set(day, (counts.get(day) ?? 0) + Number(matchesKeyword));
        }
      }
    }
    const rows = document.createDocumentFragment();
    for (const day of ["", ...Array.from(counts.keys()).sort().reverse()]) {
      const option = dateOptionTemplate.content.firstElementChild!.cloneNode(true) as HTMLButtonElement;
      const date = day ? new Date(`${day}T12:00:00`) : today;
      const relative = day === recentDays[0] ? "今天" : day === recentDays[1] ? "昨天" : "";
      option.firstElementChild!.textContent = !day ? "全部时间" : relative
        ? `${relative} · ${shortDayFormat.format(date)}` : fullDayFormat.format(date);
      option.lastElementChild!.textContent = `${day ? counts.get(day) : total} 条`;
      option.setAttribute("aria-pressed", String(day === searchDay));
      option.dataset.rioDay = day;
      rows.append(option);
    }
    dateList.replaceChildren(rows);
    updateDateButton(today);
    dateDialog.showModal();
    dateButton.setAttribute("aria-expanded", "true");
    dateList.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
  }

  function render(loading = false) {
    let count = 0;
    focusTransition?.cancel();
    focus = undefined;
    searchGroups = [];
    for (const list of rioLists) {
      const section = document.querySelector<HTMLElement>(`[data-rio-list="${list.type}"]`)!;
      const sources = books.filter((book) => mapping[book.id] === list.type);
      const words = new Map<string, Set<string>>();
      if (!loading) {
        for (const book of sources) {
          for (const { word, addedAt } of cache.get(book.id)?.entries ?? []) {
            const days = words.get(word) ?? new Set<string>();
            if (addedAt !== null) days.add(localDay(new Date(addedAt)));
            words.set(word, days);
          }
        }
      }
      const entries = Array.from(words, ([text, addedDays]) => ({
        material: { id: ++count, type: list.type, text },
        searchText: text.toLowerCase(),
        addedDays
      }));
      section.querySelector("tbody")!.replaceChildren();
      const face = section.querySelector<HTMLButtonElement>(".rio-deck-word")!;
      face.textContent = "";
      delete face.dataset.rioMaterialId;
      delete face.dataset.rioMaterialText;
      delete face.dataset.rioMaterialType;
      section.querySelector<HTMLElement>(".rio-empty")!.hidden = Boolean(words.size);
      section.hidden = loading || !sources.length;
      if (!section.hidden) {
        const countLabel = section.querySelector<HTMLElement>("[data-rio-count]")!;
        searchGroups.push({ section, countLabel, entries, matches: [], position: 0, page: 0 });
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
      library.open = true;
      status.textContent = books.length ? "选好对应列表后，保存映射即可加载词条。" : "这个账号还没有英语生词本。";
      return;
    }
    const limited = [];
    try {
      for (const book of mapped) {
        const entry = cache.get(book.id) ?? { entries: [], page: 0, complete: false, atLimit: false };
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
          const data = await request<{ words: string[]; entries?: BookWord[]; hasMore: boolean; atLimit: boolean }>("?" + params, {
            signal, headers: { "X-RIO-Scope": scope! }
          });
          if (signal.aborted) return;
          entry.entries.push(...(data.entries ?? data.words.map(word => ({ word, addedAt: null }))));
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
      library.open = true;
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
      if (scope !== (data.scope ?? null)) {
        searchInput.value = "";
        searchDay = "";
        updateDateButton();
      }
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
        library.open = true;
        status.textContent = "输入欧路 API Key，连接你的英语生词本。";
      }
    } catch (error) {
      showChoices();
      library.open = true;
      status.textContent = errorMessage(error);
      retryAction = () => connectBooks(method);
      if (method === "GET") disconnect.hidden = false;
      retry.hidden = false;
    } finally {
      controls.forEach((control) => { control.disabled = false; });
    }
  }

  exitFocusButton.addEventListener("click", () => {
    if (!focus) return;
    const { group, scrollY, trigger } = focus;
    focus = undefined;
    paintView();
    (group.section.hidden ? searchInput : trigger).focus({ preventScroll: true });
    window.scrollTo({ top: scrollY, behavior: "instant" });
    animateFocusChange(false);
  });

  for (const deck of grid.querySelectorAll<HTMLElement>(".rio-deck")) {
    const section = deck.closest<HTMLElement>("[data-rio-list]")!;
    const face = deck.querySelector<HTMLButtonElement>(".rio-deck-word")!;
    addSpeaker(face, section.dataset.rioList);
    const focusButton = section.querySelector<HTMLButtonElement>("[data-rio-focus]")!;
    const listToggle = section.querySelector<HTMLButtonElement>(".rio-list-toggle")!;
    const pageButtons = section.querySelectorAll<HTMLButtonElement>("[data-list-page-step]");
    pageButtons.forEach(button => button.addEventListener("click", () => {
      const group = searchGroups.find(item => item.section === section);
      if (focus || !group || button.disabled) return;
      group.page += Number(button.dataset.listPageStep);
      paintListPage(group);
      if (button.disabled) {
        Array.from(pageButtons).find(control => !control.disabled)?.focus({ preventScroll: true });
      }
    }));
    listToggle.addEventListener("click", () => {
      const group = searchGroups.find(item => item.section === section);
      if (!group) return;
      const expanded = listToggle.getAttribute("aria-expanded") === "true";
      listToggle.setAttribute("aria-expanded", String(!expanded));
      paintGroup(group);
    });
    focusButton.addEventListener("click", () => {
      const group = searchGroups.find(item => item.section === section);
      if (!group?.matches.length) return;
      focus = { group, scrollY: window.scrollY, trigger: focusButton };
      paintView();
      face.focus({ preventScroll: true });
      search.scrollIntoView({ block: "start", behavior: "instant" });
      animateFocusChange(true);
    });
    function turn(step: number) {
      const group = focus?.group;
      if (group?.section !== section || group.matches.length < 2) return;
      group.position = (group.position + step + group.matches.length) % group.matches.length;
      group.preferredWord = group.matches[group.position].material.text;
      paintGroup(group);
    }
    deck.querySelectorAll<HTMLButtonElement>("[data-step]").forEach(arrow =>
      arrow.addEventListener("click", () => turn(Number(arrow.dataset.step))));
    let start: { id: number; x: number; y: number; moved: boolean } | undefined;
    let suppressClick = false;
    face.addEventListener("pointerdown", event => {
      if (!event.isPrimary || event.button !== 0) return;
      suppressClick = false;
      start = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
      face.setPointerCapture(event.pointerId);
    });
    face.addEventListener("pointermove", event => {
      if (start?.id !== event.pointerId) return;
      if (Math.max(Math.abs(event.clientX - start.x), Math.abs(event.clientY - start.y)) > 10) {
        start.moved = true;
      }
    });
    face.addEventListener("pointerup", event => {
      if (start?.id !== event.pointerId) return;
      const dx = event.clientX - start.x, dy = event.clientY - start.y;
      const moved = start.moved || Math.max(Math.abs(dx), Math.abs(dy)) > 10;
      start = undefined;
      // Handle touch taps here because the browser can suppress a click after a swipe.
      suppressClick = moved || event.pointerType === "touch";
      if (Math.abs(dx) >= 32 && Math.abs(dx) > 1.3 * Math.abs(dy)) turn(dx < 0 ? 1 : -1);
      else if (event.pointerType === "touch" && !moved) face.click();
    });
    face.addEventListener("pointercancel", () => { start = undefined; suppressClick = true; });
    face.addEventListener("click", event => {
      if (suppressClick && event.detail !== 0) {
        event.preventDefault();
        event.stopPropagation();
      }
    });
  }
  document.addEventListener("keydown", (event) => {
    const shortcut = getRioShortcut(event);
    if (!shortcut || !focus || document.querySelector("dialog[open], [data-rio-modal]:not([hidden])")) return;
    const deck = focus.group.section.querySelector<HTMLElement>(".rio-deck:not([hidden])");
    if (!deck) return;
    const control = event.target instanceof Element && event.target.closest("button, a[href], summary");
    if (shortcut === "activate" && control && !deck.contains(control)) return;

    event.preventDefault();
    if (shortcut === "previous" || shortcut === "next") {
      deck.querySelector<HTMLButtonElement>(`[data-step="${shortcut === "previous" ? -1 : 1}"]`)?.click();
    } else if (!event.repeat) {
      const face = deck.querySelector<HTMLButtonElement>(".rio-deck-word")!;
      if (shortcut === "pronounce") void pronounce(face);
      else face.click();
    }
  });
  searchInput.addEventListener("input", () => filterWords());
  dateButton.addEventListener("click", openDates);
  dateList.addEventListener("click", event => {
    const option = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-rio-day]") : null;
    if (!option) return;
    const day = option.dataset.rioDay!;
    const changed = day !== searchDay;
    searchDay = day;
    updateDateButton();
    dateDialog.close();
    if (changed) filterWords(true);
  });
  dateDialog.addEventListener("click", event => {
    if (event.target === dateDialog) dateDialog.close();
  });
  dateDialog.addEventListener("close", () => {
    dateButton.setAttribute("aria-expanded", "false");
    dateButton.focus({ preventScroll: true });
  });
  library.addEventListener("toggle", () => {
    if (library.open) retry.before(status);
    else summary.append(status);
  });
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
  return (type = "") => searchGroups.flatMap(group =>
    !type || group.section.dataset.rioList === type ? group.matches.map(({ material }) => material) : []
  );
}
