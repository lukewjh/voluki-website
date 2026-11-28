import { aiRequestHeaders } from "./aiClient";
import { AI_SETTINGS_HEADER } from "./aiSettings";
import { formatRioDay, type RioDictationWord } from "./rioLibrary";
import type { initRioPronunciation } from "./rioPronunciation";
import { readVocabularyMeanings } from "./rioVocabulary";

const groupSize = 10;
const correctFeedbackMs = 350;
const arrivalMs = 150;
const hiddenHint = "显示词性与释义";
const normalize = (word: string) => word.normalize("NFKC").trim().toLowerCase().replace(/’/g, "'").replace(/\s+/g, " ");

export function initRioDictation(
  getWords: () => RioDictationWord[],
  speech: ReturnType<typeof initRioPronunciation>,
  shuffle: (words: string[]) => string[]
) {
  const trigger = document.querySelector<HTMLButtonElement>("[data-rio-dictation]")!;
  const dialog = document.querySelector<HTMLDialogElement>("#rio-dictation")!;
  const groupsPage = dialog.querySelector<HTMLElement>("[data-dictation-groups]")!;
  const groupList = dialog.querySelector<HTMLElement>("[data-dictation-group-list]")!;
  const dayTemplate = dialog.querySelector<HTMLTemplateElement>("[data-dictation-day-template]")!;
  const groupTemplate = dialog.querySelector<HTMLTemplateElement>("[data-dictation-group-template]")!;
  const questionForm = dialog.querySelector<HTMLFormElement>("[data-dictation-question]")!;
  const card = questionForm.querySelector<HTMLElement>("[data-dictation-card]")!;
  const slide = card.querySelector<HTMLElement>("[data-dictation-slide]")!;
  const progress = dialog.querySelector<HTMLElement>("[data-dictation-progress]")!;
  const input = dialog.querySelector<HTMLInputElement>("[data-dictation-input]")!;
  const feedback = dialog.querySelector<HTMLElement>("[data-dictation-feedback]")!;
  const audioStatus = dialog.querySelector<HTMLElement>("[data-dictation-audio-status]")!;
  const speaker = dialog.querySelector<HTMLButtonElement>("[data-dictation-replay]")!;
  const hint = dialog.querySelector<HTMLButtonElement>("[data-dictation-hint]")!;
  const meaning = dialog.querySelector<HTMLElement>("[data-dictation-meaning]")!;
  const submit = dialog.querySelector<HTMLButtonElement>("[data-dictation-submit]")!;
  const resultPage = dialog.querySelector<HTMLElement>("[data-dictation-result]")!;
  const summary = dialog.querySelector<HTMLElement>("[data-dictation-summary]")!;
  const score = summary.querySelector<HTMLElement>("[data-dictation-score]")!;
  const retry = dialog.querySelector<HTMLButtonElement>("[data-dictation-retry]")!;
  const nextGroup = dialog.querySelector<HTMLButtonElement>("[data-dictation-next-group]")!;

  const completed = new Set<number>();
  let pool: RioDictationWord[] = [];
  let groups: string[][] = [];
  let timeline: { day: string; groupIndexes: number[] }[] = [];
  let run: { group: number; words: string[]; index: number; attempts: ("correct" | "missed" | undefined)[] } | undefined;
  let question: { word: string } | undefined;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let correctTimer: number | undefined;
  let arrival: { animation: Animation; timer: number } | undefined;
  const meanings = new Map<string, Promise<string[]>>();
  let configuration: string | undefined;

  async function getMeaning(word: string) {
    const headers = aiRequestHeaders();
    if (headers[AI_SETTINGS_HEADER] !== configuration) {
      configuration = headers[AI_SETTINGS_HEADER];
      meanings.clear();
    }
    const cached = meanings.get(word);
    if (cached) return cached;

    const pending = fetch("/api/rio/dictation-meaning", { method: "POST", headers, body: JSON.stringify({ text: word }) })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error || "暂时无法获取释义，请重试。");
        const labels = readVocabularyMeanings(body?.meanings);
        if (!labels) throw new Error("释义返回不完整，请重试。");
        return labels;
      });
    meanings.set(word, pending);
    if (meanings.size > 100) meanings.delete(meanings.keys().next().value!);
    void pending.catch(() => { if (meanings.get(word) === pending) meanings.delete(word); });
    return pending;
  }

  function playQuestion() {
    const current = question;
    if (!current || !dialog.open || correctTimer !== undefined) return;
    clearArrival();
    void speech.play(current.word, (message) => {
      if (dialog.open && question === current) audioStatus.textContent = message;
    }, () => dialog.open && question === current);
  }

  function clearArrival() {
    if (!arrival) return;
    window.clearTimeout(arrival.timer);
    arrival.animation.cancel();
    arrival = undefined;
  }

  function clearTransition() {
    window.clearTimeout(correctTimer);
    correctTimer = undefined;
    delete card.dataset.correct;
    clearArrival();
  }

  function showQuestion(animate = false) {
    if (!run) return;
    clearTransition();
    const word = run.words[run.index];
    const upcoming = run.words[run.index + 1];
    question = { word };
    progress.textContent = `第 ${run.group + 1} 组 · ${run.index + 1} / ${run.words.length}`;
    groupsPage.hidden = resultPage.hidden = true;
    questionForm.hidden = false;
    input.value = "";
    input.removeAttribute("aria-invalid");
    feedback.textContent = "";
    hint.setAttribute("aria-expanded", "false");
    meaning.textContent = hiddenHint;
    submit.disabled = true;
    audioStatus.textContent = "";
    if (animate && !reducedMotion.matches && typeof slide.animate === "function") {
      const animation = slide.animate([
        { opacity: 0.65, transform: "translateX(12px)" },
        { opacity: 1, transform: "translateX(0)" }
      ], { duration: arrivalMs, easing: "ease-out" });
      const timer = window.setTimeout(playQuestion, arrivalMs);
      arrival = { animation, timer };
    } else {
      playQuestion();
    }
    void getMeaning(word).catch(() => {});
    if (upcoming) {
      void speech.preload(upcoming).catch(() => {});
      void getMeaning(upcoming).catch(() => {});
    }
    input.focus({ preventScroll: animate });
  }

  function startGroup(group: number, words = groups[group]) {
    if (!words?.length) return;
    run = { group, words: shuffle(words), index: 0, attempts: [] };
    showQuestion();
  }

  function regroup(words: RioDictationWord[]) {
    const byDay = new Map<string, string[]>();
    for (const { text, day } of words) {
      const entries = byDay.get(day);
      if (entries) entries.push(text);
      else byDay.set(day, [text]);
    }
    groups = [];
    timeline = Array.from(byDay.entries()).sort(([a], [b]) => b.localeCompare(a)).map(([day, entries]) => {
      const groupIndexes: number[] = [];
      for (let offset = 0; offset < entries.length; offset += groupSize) {
        groupIndexes.push(groups.length);
        groups.push(entries.slice(offset, offset + groupSize));
      }
      return { day, groupIndexes };
    });
  }

  function showGroups() {
    clearTransition();
    speech.stop();
    question = undefined;
    run = undefined;
    progress.textContent = `${pool.length} 个词 · ${groups.length} 组`;
    questionForm.hidden = resultPage.hidden = true;
    groupsPage.hidden = false;
    const rows = document.createDocumentFragment();
    const today = new Date();
    for (const { day, groupIndexes } of timeline) {
      const section = dayTemplate.content.cloneNode(true) as DocumentFragment;
      section.querySelector("h3")!.textContent = day ? formatRioDay(day, today) : "日期未知";
      const cards = section.querySelector(".dictation-groups")!;
      for (const index of groupIndexes) {
        const button = groupTemplate.content.firstElementChild!.cloneNode(true) as HTMLButtonElement;
        button.firstElementChild!.textContent = `第 ${index + 1} 组`;
        button.lastElementChild!.textContent = `${groups[index].length} 个词${completed.has(index) ? " · 已完成" : ""}`;
        button.addEventListener("click", () => startGroup(index));
        cards.append(button);
      }
      rows.append(section);
    }
    groupList.replaceChildren(rows);
    if (!dialog.open) dialog.showModal();
    const buttons = groupList.querySelectorAll("button");
    (buttons[groups.findIndex((_, index) => !completed.has(index))] ?? buttons[0])?.focus();
  }

  function finishGroup() {
    if (!run) return;
    clearTransition();
    speech.stop();
    question = undefined;
    completed.add(run.group);
    progress.textContent = `第 ${run.group + 1} 组`;
    questionForm.hidden = true;
    resultPage.hidden = false;
    const correct = run.attempts.filter(attempt => attempt === "correct").length;
    score.textContent = `首次拼对 ${correct} / ${run.words.length}`;
    retry.hidden = correct === run.words.length;
    nextGroup.hidden = run.group + 1 >= groups.length;
    summary.focus();
  }

  function turn(step: -1 | 1, animate = false) {
    if (!run || !question || run.index + step < 0) return;
    if (step === 1) run.attempts[run.index] ??= "missed";
    run.index += step;
    if (run.index < run.words.length) showQuestion(animate);
    else finishGroup();
  }

  function showCorrect() {
    const current = question;
    if (!run || !current) return;
    run.attempts[run.index] ??= "correct";
    speech.stop();
    audioStatus.textContent = "";
    card.dataset.correct = "";
    input.value = current.word;
    input.removeAttribute("aria-invalid");
    feedback.textContent = "拼写正确";
    input.focus({ preventScroll: true });
    submit.disabled = true;
    correctTimer = window.setTimeout(() => {
      if (dialog.open && question === current) turn(1, true);
    }, correctFeedbackMs);
  }

  function showAnswer() {
    if (!question || !run) return;
    run.attempts[run.index] ??= "missed";
    const answer = document.createElement("b");
    answer.lang = "en";
    answer.textContent = question.word;
    feedback.replaceChildren("正确拼写 · ", answer);
    input.setAttribute("aria-invalid", "true");
    input.focus();
    input.select();
  }

  trigger.addEventListener("click", () => {
    const words = getWords();
    if (!words.length) return;
    if (words.length !== pool.length || words.some(({ text, day }, index) => text !== pool[index].text || day !== pool[index].day)) {
      completed.clear();
      pool = words;
      regroup(words);
    }
    showGroups();
  });
  dialog.addEventListener("close", () => {
    if (dialog.open) return;
    clearTransition();
    speech.stop();
    question = undefined;
    run = undefined;
  });
  dialog.querySelectorAll("[data-dictation-back]").forEach(button => button.addEventListener("click", showGroups));
  speaker.addEventListener("click", playQuestion);
  retry.addEventListener("click", () => {
    if (!run) return;
    const { group, words, attempts } = run;
    startGroup(group, words.filter((_, index) => attempts[index] !== "correct"));
  });
  nextGroup.addEventListener("click", () => { if (run) startGroup(run.group + 1); });

  hint.addEventListener("click", async () => {
    const current = question;
    if (!current || correctTimer !== undefined) return;
    const expanded = hint.getAttribute("aria-expanded") !== "true";
    hint.setAttribute("aria-expanded", String(expanded));
    if (!expanded) {
      meaning.textContent = hiddenHint;
      return;
    }
    meaning.textContent = "正在获取释义…";
    let text: string;
    try {
      text = (await getMeaning(current.word)).join("\n");
    } catch (error) {
      text = error instanceof Error ? error.message : "暂时无法获取释义，请重试。";
    }
    if (dialog.open && question === current && hint.getAttribute("aria-expanded") === "true") {
      meaning.textContent = text;
    }
  });

  input.addEventListener("beforeinput", (event) => {
    if (correctTimer !== undefined) event.preventDefault();
  });
  input.addEventListener("input", () => {
    if (correctTimer !== undefined && question) {
      input.value = question.word;
      return;
    }
    submit.disabled = !input.value.trim();
    input.removeAttribute("aria-invalid");
    feedback.textContent = "";
  });
  submit.addEventListener("mousedown", (event) => {
    if (document.activeElement === input) event.preventDefault();
  });
  questionForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!question || correctTimer !== undefined || !input.value.trim()) return;
    if (normalize(input.value) === normalize(question.word)) showCorrect();
    else showAnswer();
  });

  dialog.addEventListener("keydown", (event) => {
    if (!dialog.open || event.defaultPrevented || event.isComposing ||
        event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;

    const { key, code } = event;
    if (event.target === summary && !resultPage.hidden) {
      const action = key === "Tab" ? retry : key === "Enter" ? nextGroup : undefined;
      if (action && !action.hidden) {
        event.preventDefault();
        if (!event.repeat) action.click();
      }
      return;
    }
    if (!question) return;
    if (key === "Tab" && event.target === input) {
      event.preventDefault();
      if (!event.repeat) playQuestion();
    } else if (code === "Backquote" || key === "`" || key === "·") {
      event.preventDefault();
      if (!event.repeat) hint.click();
    } else if (key === "ArrowLeft" || key === "ArrowRight") {
      event.preventDefault();
      if (!event.repeat) turn(key === "ArrowLeft" ? -1 : 1);
    }
  });

  let swipeStart: Touch | undefined;
  card.addEventListener("touchstart", (event) => {
    swipeStart = event.touches.length === 1 && event.target !== input ? event.touches[0] : undefined;
  }, { passive: true });
  card.addEventListener("touchcancel", () => { swipeStart = undefined; });
  card.addEventListener("touchend", (event) => {
    const start = swipeStart;
    swipeStart = undefined;
    const end = Array.from(event.changedTouches).find(touch => touch.identifier === start?.identifier);
    if (!start || !end) return;
    const dx = end.clientX - start.clientX;
    const dy = end.clientY - start.clientY;
    if (Math.abs(dx) < 32 || Math.abs(dx) <= 1.3 * Math.abs(dy)) return;
    event.preventDefault();
    turn(dx < 0 ? 1 : -1);
  });
}
