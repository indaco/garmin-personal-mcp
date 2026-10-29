import { AUTHORED, label, QUESTIONS } from "../questions";
import { byId } from "./dom";
import { arrowKeys, selectTab } from "./tabs";

/** "Ask in your own words": a tab per sport; a sport cell of the hero wall selects its tab too. */
export function ask(): void {
  const picker = document.querySelector<HTMLElement>(".picker");
  if (!picker) return;
  const field = byId("sportfield");
  const list = byId("qs");

  const select = (sport: string) => {
    for (const b of picker.querySelectorAll<HTMLElement>('[role="tab"]'))
      selectTab(b, b.dataset.sport === sport);
    byId("ask-panel").setAttribute("aria-labelledby", `tab-${sport}`);
    field.className = `sportfield f-${sport}`;
    byId("sportname").textContent = label(sport);
    byId("sportpicto").setAttribute("href", `#p-${sport}`);
    byId("authored").hidden = !AUTHORED.has(sport);
    byId("every-note").hidden = sport !== "every";
    list.replaceChildren(
      ...(QUESTIONS[sport] ?? []).map(([question, tools]) => {
        const li = document.createElement("li");
        const q = document.createElement("q");
        q.textContent = question;
        const via = document.createElement("span");
        via.className = "via";
        via.textContent = tools;
        li.append(q, via);
        return li;
      }),
    );
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
