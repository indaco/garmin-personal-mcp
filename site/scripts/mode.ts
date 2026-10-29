import { byId } from "./dom";

type Mode = "light" | "dark";

/** Saves the choice, or forgets it with null. */
function store(value: Mode | null): void {
  try {
    if (value) localStorage.setItem("mode", value);
    else localStorage.removeItem("mode");
  } catch {
    // storage blocked: the choice lasts for this visit only
  }
}

/**
 * Light or dark follows the system. The toggle saves a choice only while it differs from the
 * system, so toggling back, or a system change to the same mode, returns to following the system.
 */
export function mode(): void {
  const root = document.documentElement;
  const button = byId("mode");
  const systemDark = matchMedia("(prefers-color-scheme: dark)");
  const system = (): Mode => (systemDark.matches ? "dark" : "light");
  const show = () => {
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : systemDark.matches;
    root.dataset.mode = dark ? "dark" : "light";
    button.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
  };
  const set = (value: Mode) => {
    if (value === system()) {
      delete root.dataset.theme;
      store(null);
    } else {
      root.dataset.theme = value;
      store(value);
    }
    show();
  };
  let saved: string | null = null;
  try {
    saved = localStorage.getItem("mode");
  } catch {
    // storage blocked: follow the system
  }
  if (saved === "light" || saved === "dark") set(saved);
  else show();
  // a saved choice that now matches the system is dropped; without one the page just follows
  systemDark.addEventListener("change", () => {
    const forced = root.dataset.theme;
    if (forced === "light" || forced === "dark") set(forced);
    else show();
  });
  button.addEventListener("click", () => set(root.dataset.mode === "dark" ? "light" : "dark"));
}
