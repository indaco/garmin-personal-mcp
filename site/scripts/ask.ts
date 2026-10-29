import { label, note, QUESTIONS } from "../questions";
import { byId } from "./dom";
import { arrowKeys, selectTab } from "./tabs";

/** "Ask in your own words": a tab per sport; a sport cell of the hero wall selects its tab too. */
export function ask(): void {
  const picker = document.querySelector<HTMLElement>(".picker");
  if (!picker) return;
  const field = byId("sportfield");
  const stack = byId("qs");

  // every set of questions sits in the same grid cell, so the section is as tall as the tallest set
  // whichever sport is selected; only the selected set is visible and in the accessibility tree
  for (const [sport, list] of Object.entries(QUESTIONS)) {
    const set = document.createElement("div");
    set.className = "qs-set";
    set.dataset.sport = sport;
    const ol = document.createElement("ol");
    ol.className = "qs";
    for (const [question, tools] of list) {
      const li = document.createElement("li");
      const q = document.createElement("q");
      q.textContent = question;
      const via = document.createElement("span");
      via.className = "via";
      via.textContent = tools;
      li.append(q, via);
      ol.append(li);
    }
    set.append(ol);
    const text = note(sport);
    if (text) {
      const p = document.createElement("p");
      p.className = "qs-note";
      p.textContent = text;
      set.append(p);
    }
    stack.append(set);
  }

  const select = (sport: string) => {
    for (const b of picker.querySelectorAll<HTMLElement>('[role="tab"]'))
      selectTab(b, b.dataset.sport === sport);
    byId("ask-panel").setAttribute("aria-labelledby", `tab-${sport}`);
    field.className = `sportfield f-${sport}`;
    byId("sportname").textContent = label(sport);
    byId("sportpicto").setAttribute("href", `#p-${sport}`);
    for (const set of stack.querySelectorAll<HTMLElement>(".qs-set"))
      set.classList.toggle("on", set.dataset.sport === sport);
  };

  for (const sport of Object.keys(QUESTIONS)) {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "tab");
    b.id = `tab-${sport}`;
    b.className = `tab f-${sport}`;
    b.dataset.sport = sport;
    b.setAttribute("aria-controls", "ask-panel");
    b.setAttribute("aria-label", label(sport));
    b.innerHTML = `<svg aria-hidden="true"><use href="#p-${sport}"/></svg><span>${label(sport)}</span>`;
    b.addEventListener("click", () => select(sport));
    picker.appendChild(b);
  }
  select("running");
  arrowKeys(picker, (t) => select(t.dataset.sport ?? "running"));
  document
    .querySelectorAll<HTMLElement>(".wall .cell")
    .forEach((a) => a.addEventListener("click", () => select(a.dataset.sport ?? "running")));
}
