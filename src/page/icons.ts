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
  // the families of the other SDK sports, see FAMILY
  fight:
    "M4 7V4.5A2.5 2.5 0 0 1 6.5 2h3A3.5 3.5 0 0 1 13 5.5V9a3 3 0 0 1-3 3H6a2 2 0 0 1-2-2zM4 7h4M5 12v2h6v-2",
  hiit: "M9 1.5 3.5 9H8l-1 5.5L12.5 7H8z",
  ball: "M8 2a6 6 0 1 1 0 12 6 6 0 0 1 0-12M2 8h12M8 2c-2 2-2 10 0 12M8 2c2 2 2 10 0 12",
  golf: "M5 14V2l7 3-7 3M3 14h6",
  snow: "M8 1.5v13M2.4 4.75l11.2 6.5M2.4 11.25l11.2-6.5M6.5 2.5 8 4l1.5-1.5M6.5 13.5 8 12l1.5 1.5",
  water:
    "M1 6c2 0 2-1.5 3.5-1.5S6 6 8 6s2-1.5 3.5-1.5S13 6 15 6M1 11c2 0 2-1.5 3.5-1.5S6 11 8 11s2-1.5 3.5-1.5S13 11 15 11",
  air: "M14.5 1.5 1.5 7l5 2 2 5zM6.5 9l8-7.5",
  target:
    "M8 2a6 6 0 1 1 0 12 6 6 0 0 1 0-12M8 5a3 3 0 1 1 0 6 3 3 0 0 1 0-6M8 1v3M8 12v3M1 8h3M12 8h3",
  mind: "M8 2.5a1.5 1.5 0 1 1 0 .1M8 5.5v4M4.5 8 8 6.5l3.5 1.5M2.5 12.5c2-1.5 9-1.5 11 0",
  dance: "M4 10.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4M6 12.5V3l7-1.5V11M11 9a2 2 0 1 0 0 4 2 2 0 0 0 0-4",
  motor:
    "M8 2a6 6 0 1 1 0 12 6 6 0 0 1 0-12M8 6.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3M2 8h4.5M9.5 8H14M8 9.5V14",
  eye: "M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4",
  settings: "M2 4h6M12 4h2M2 8h2M8 8h6M2 12h8M14 12h0M10 2.5v3M6 6.5v3M12 10.5v3",
  expand: "M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4",
  collapse: "M6 2v4H2M14 6h-4V2M10 14v-4h4M2 10h4v4",
};

/** The icon of each other SDK sport: a family, or a board that looks alike. Other sports get `generic`. */
const FAMILY = new Map(
  Object.entries({
    fight: ["boxing", "mixedMartialArts"],
    hiit: ["hiit", "jumpRope"],
    strengthTraining: ["training", "fitnessEquipment"],
    ball: [
      "soccer",
      "basketball",
      "americanFootball",
      "baseball",
      "volleyball",
      "rugby",
      "cricket",
      "hockey",
      "lacrosse",
      "teamSport",
    ],
    racket: ["tennis"],
    golf: ["golf", "discGolf"],
    snow: [
      "alpineSkiing",
      "crossCountrySkiing",
      "snowboarding",
      "snowshoeing",
      "snowmobiling",
      "winterSport",
      "iceSkating",
    ],
    water: [
      "rowing",
      "paddling",
      "kayaking",
      "canoeing",
      "rafting",
      "standUpPaddleboarding",
      "sailing",
      "windsurfing",
      "kitesurfing",
      "surfing",
      "wakeboarding",
      "waterSkiing",
      "wakesurfing",
      "waterTubing",
      "waterSport",
      "boating",
      "diving",
      "snorkeling",
      "poolApnea",
      "fishing",
    ],
    hiking: ["mountaineering", "rockClimbing", "floorClimbing"],
    cycling: ["eBiking"],
    running: ["wheelchairPushRun"],
    walking: ["wheelchairPushWalk"],
    air: ["flying", "hangGliding", "skyDiving", "jumpmaster"],
    target: ["shooting", "archery", "hunting", "tactical"],
    mind: ["meditation", "mobility"],
    dance: ["dance"],
    motor: ["motorcycling", "driving", "motorSports"],
  }).flatMap(([family, sports]) => sports.map((sport) => [sport, family] as const)),
);

export function icon(name: string): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", `icon icon-${name}`);
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  // own keys only: a sport named like an Object property ("constructor") is not a path
  const key = Object.hasOwn(ICONS, name) ? name : (FAMILY.get(name) ?? "generic");
  path.setAttribute("d", ICONS[key]);
  svg.append(path);
  return svg;
}

/** The logo, inline so that its colours follow the theme; assets/logo.svg is the same mark on a tile. */
export function logo(): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 32 32");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "logo");
  svg.innerHTML =
    '<circle class="logo-track" cx="16" cy="16" r="10"/><path class="logo-arc" d="M16 6a10 10 0 1 1-10 10"/><circle class="logo-dot" cx="16" cy="16" r="3.4"/>';
  return svg;
}
