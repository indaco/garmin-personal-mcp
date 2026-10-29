import { byId } from "./dom";

/** Phone menu: the button opens the section links; a link, Escape or the button closes them. */
export function menu(): void {
  const button = byId("menu");
  const nav = byId("site-nav");
  const set = (open: boolean) => {
    nav.classList.toggle("open", open);
    button.setAttribute("aria-expanded", String(open));
    button.setAttribute("aria-label", open ? "Close menu" : "Menu");
  };
  button.addEventListener("click", () => set(!nav.classList.contains("open")));
  nav.addEventListener("click", (e) => {
    if ((e.target as Element).closest("a")) set(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && nav.classList.contains("open")) {
      set(false);
      button.focus();
    }
  });
}
