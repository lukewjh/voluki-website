import type { VocabularyRound } from "./rioVocabulary";
import "../styles/rio-vocabulary.css";

function highlightedSentence(sentence: string) {
  const [before, target, after] = sentence.split("**");
  const mark = document.createElement("mark");
  mark.textContent = target;
  const fragment = document.createDocumentFragment();
  fragment.append(before, mark, after);
  return fragment;
}

export function startVocabularyGame(
  stage: HTMLElement,
  round: VocabularyRound,
  signal: AbortSignal,
  playTone: (tone: "correct" | "wrong" | "complete") => void,
  finish: (review: HTMLElement | null) => void
) {
  stage.innerHTML = `<section class="sense-game" aria-label="词义撞撞消">
    <div class="sense-score"><strong>词义撞撞消</strong><span class="sense-combo"></span><span class="sense-count"></span></div>
    <div class="sense-meter" aria-hidden="true"></div>
    <p class="sense-status" role="status"></p>
    <div class="sense-board">
      <div class="sense-examples" role="group" aria-label="英文例句"></div>
      <div class="sense-meanings" role="group" aria-label="中文词义"></div>
    </div>
  </section>`;
  const game = stage.querySelector<HTMLElement>(".sense-game")!;
  const examplesBox = game.querySelector<HTMLElement>(".sense-examples")!;
  const meaningsBox = game.querySelector<HTMLElement>(".sense-meanings")!;
  const meter = game.querySelector<HTMLElement>(".sense-meter")!;
  const count = game.querySelector<HTMLElement>(".sense-count")!;
  const combo = game.querySelector<HTMLElement>(".sense-combo")!;
  const status = game.querySelector<HTMLElement>(".sense-status")!;
  const mobile = matchMedia("(max-width: 680px)");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const remaining = round.examples.map((_, i) => i);
  const mistakes = new Set<number>();
  const total = remaining.length;
  let selectedExample: number | null = null;
  let selectedMeaning: number | null = null;
  let streak = 0;
  let resolving = false;
  let timer = 0;
  signal.addEventListener("abort", () => window.clearTimeout(timer), { once: true });

  function card(parent: HTMLElement, content: string | DocumentFragment, onClick: () => void) {
    const button = document.createElement("button");
    button.type = "button";
    button.append(content);
    button.addEventListener("click", onClick, { signal });
    parent.append(button);
    return button;
  }

  const examples = round.examples.map(({ sentence }, index) => {
    meter.append(document.createElement("i"));
    return card(examplesBox, highlightedSentence(sentence), () => {
      if (mobile.matches || resolving) return;
      selectedExample = selectedExample === index ? null : index;
      checkPair();
    });
  });
  const meanings = round.meanings.map((text, index) => card(meaningsBox, text, () => {
    if (resolving) return;
    selectedMeaning = selectedMeaning === index ? null : index;
    checkPair();
  }));

  function updateBoard(feedback?: string) {
    const visible = remaining.slice(0, mobile.matches ? 1 : 3);
    if (mobile.matches) selectedExample = visible[0] ?? null;
    else if (selectedExample !== null && !visible.includes(selectedExample)) selectedExample = null;
    examples.forEach((button, i) => {
      button.hidden = !visible.includes(i);
      button.tabIndex = mobile.matches ? -1 : 0;
      button.setAttribute("aria-pressed", String(i === selectedExample));
    });
    meanings.forEach((button, i) => button.setAttribute("aria-pressed", String(i === selectedMeaning)));
    const completed = total - remaining.length;
    Array.from(meter.children).forEach((pip, i) => pip.classList.toggle("filled", i < completed));
    count.textContent = `${completed} / ${total}`;
    combo.textContent = streak > 1 ? `连对 ×${streak}` : "";
    status.textContent = feedback ?? (mobile.matches || selectedExample !== null ? "选出高亮词在句中的意思。"
      : selectedMeaning !== null ? "点一句与这个词义匹配的例句。" : "将例句里的高亮词与中文词义配对。");
  }

  function reviewMistakes() {
    if (!mistakes.size) return null;
    const section = document.createElement("section");
    section.className = "sense-review";
    const title = document.createElement("h4");
    title.textContent = `错题回顾 · ${mistakes.size} 句`;
    section.append(title);
    for (const i of mistakes) {
      const { sentence, meaning } = round.examples[i];
      const line = document.createElement("p");
      const gloss = document.createElement("strong");
      gloss.textContent = round.meanings[meaning];
      line.append(highlightedSentence(sentence), gloss);
      section.append(line);
    }
    return section;
  }

  function checkPair() {
    updateBoard();
    if (selectedExample === null || selectedMeaning === null) return;
    const index = selectedExample;
    const example = examples[index];
    const meaning = meanings[selectedMeaning];
    const correct = round.examples[index].meaning === selectedMeaning;
    if (!correct) {
      mistakes.add(index);
      streak = 0;
      selectedMeaning = null;
      playTone("wrong");
      updateBoard("再试一次，留意高亮词前后的线索。");
      if (!reducedMotion.matches) {
        for (const button of [example, meaning]) button.animate(
          [{ transform: "translateX(-3px)" }, { transform: "translateX(3px)" }, { transform: "none" }],
          { duration: 160 }
        );
      }
      return;
    }

    resolving = true;
    streak++;
    combo.textContent = streak > 1 ? `连对 ×${streak}` : "";
    status.textContent = "配对成功";
    playTone(remaining.length === 1 ? "complete" : "correct");
    example.classList.add("matched");
    meaning.classList.add("matched");
    const duration = reducedMotion.matches ? 0 : 190;
    if (duration) {
      const delta = meaning.getBoundingClientRect().left - example.getBoundingClientRect().left;
      example.animate([{ opacity: 1 }, {
        transform: mobile.matches ? "translateY(-12px)" : `translateX(${delta * 0.24}px) scale(.96)`,
        opacity: 0
      }], { duration, easing: "ease-in", fill: "forwards" });
    }
    timer = window.setTimeout(() => {
      remaining.splice(remaining.indexOf(index), 1);
      resolving = false;
      meaning.classList.remove("matched");
      selectedExample = null;
      selectedMeaning = null;
      if (!remaining.length) {
        finish(reviewMistakes());
        return;
      }
      updateBoard();
      if (document.activeElement === example) {
        (mobile.matches ? meanings[0] : examples[remaining[0]]).focus({ preventScroll: true });
      }
    }, duration);
  }
  mobile.addEventListener("change", () => {
    selectedMeaning = null;
    selectedExample = null;
    updateBoard();
  }, { signal });
  updateBoard();
}
