/** Decorative type icons, inline SVG. */
const ICONS: Record<string, string> = {
  all: "M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z",
  recovery:
    "M8 13.5S2.5 10 2.5 6.25A2.75 2.75 0 0 1 8 5a2.75 2.75 0 0 1 5.5 1.25C13.5 10 8 13.5 8 13.5z",
  running: "M10 2.5a1.5 1.5 0 1 1 0 .1M7 5l3 1 1 3 2 1M8 6l-2 4-3 1M9 9l-1 3 2 2",
  strengthTraining: "M1 7h2v2H1zM13 7h2v2h-2zM3 5h2v6H3zM11 5h2v6h-2zM5 7.25h6v1.5H5z",
  walking: "M8 2.5a1.5 1.5 0 1 1 0 .1M8 5v5l-2 4M8 10l2 4M8 6l-3 2M8 6l3 2",
  hiking: "M1 14l5-8 3 4 2-3 4 7z",
  cycling: "M4 11a2.5 2.5 0 1 0 .1 0M12 11a2.5 2.5 0 1 0 .1 0M4 11l3-5h4l1 5M7 6l2 5",
  swimming: "M1 11c2 0 2-1.5 3.5-1.5S6 11 8 11s2-1.5 3.5-1.5S13 11 15 11M5 8l3-3 3 2",
  racket: "M6 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8M8.5 9.5l5 5M13 4a1 1 0 1 1 0 .1",
  generic: "M8 2v12M2 8h12",
  user: "M8 2.5a2.75 2.75 0 1 1 0 5.5 2.75 2.75 0 0 1 0-5.5M2.75 14c.5-2.75 2.6-4.25 5.25-4.25s4.75 1.5 5.25 4.25",
};

export function icon(name: string): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", `icon icon-${name}`);
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", ICONS[name] ?? ICONS.generic);
  svg.append(path);
  return svg;
}
