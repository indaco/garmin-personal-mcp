const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
const AT = {
  left: "translateX(-101%)",
  right: "translateX(101%)",
  bottom: "translateY(101%)",
  top: "translateY(-101%)",
  diagIn: "rotate(-45deg) translateX(-100%)",
  diagOut: "rotate(-45deg) translateX(100%)",
};
type Side = keyof typeof AT;
/** Where the flood comes in and goes out, by sport: the way the sport moves. Others: left to right. */
const PATH: Record<string, [Side, Side]> = {
  strength: ["bottom", "top"],
  padel: ["diagIn", "diagOut"],
};
const full = (from: Side) => (from.startsWith("diag") ? "rotate(-45deg) translateX(0)" : "none");

/** Hover flood: each field floods the way its sport moves and leaves through the far side. */
export function flood(): void {
  const calm = matchMedia("(prefers-reduced-motion: reduce)");
  const sweep = (el: HTMLElement, frames: string[], ms: number) => {
    el.getAnimations().forEach((a) => a.cancel());
    // reduced motion: the colour still changes, without the sweep
    const options = calm.matches ? { duration: 0 } : { duration: ms, easing: EASE };
    el.animate(
      frames.map((transform) => ({ transform })),
      { ...options, fill: "forwards" },
    );
  };
  document.querySelectorAll<HTMLElement>(".wall .cell").forEach((cell) => {
    const fx = cell.querySelector<HTMLElement>(".fx");
    if (!fx) return;
    const [from, to] = PATH[cell.dataset.sport ?? ""] ?? ["left", "right"];
    fx.style.transform = AT[from];
    const enter = () => sweep(fx, [AT[from], full(from)], 450);
    const leave = () => sweep(fx, [full(from), AT[to]], 380);
    cell.addEventListener("pointerenter", enter);
    cell.addEventListener("focus", enter);
    cell.addEventListener("pointerleave", leave);
    cell.addEventListener("blur", leave);
  });
}
