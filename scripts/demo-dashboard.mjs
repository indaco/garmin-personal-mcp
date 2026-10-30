// Writes made-up dashboard data in the getDashboardData format, for a public demo page: a year of a
// runner's training (a marathon block, races, strength, padel, rides, swims, hikes), HRV and recovery.
// Seeded: the same seed and end date give the same data. With a page path it also fills the page
// template (`pnpm build` first) and puts a sample-data note at the top. Without paths it writes the
// demo of the website: dist-site/demo/demo-data.json and dist-site/demo/index.html.
// `node scripts/demo-dashboard.mjs [--weeks 52] [--end yyyy-MM-dd] [--seed 7] [data.json [page.html]]`
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { asServer, fillPage } from "./fill-dashboard-fixture.mjs";

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: { weeks: { type: "string" }, end: { type: "string" }, seed: { type: "string" } },
});
const [outJson, outHtml] =
  positionals.length > 0
    ? positionals
    : ["dist-site/demo/demo-data.json", "dist-site/demo/index.html"];
const WEEKS = Math.min(Math.max(Number(opt.weeks ?? 52), 1), 52);
const now = new Date();
const END =
  opt.end ?? new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(END)) throw new Error(`--end must be yyyy-MM-dd: ${END}`);

// mulberry32
let seed = Number(opt.seed ?? 7) >>> 0;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const r = (a, b) => a + (b - a) * rnd();
const ri = (a, b) => Math.floor(r(a, b + 1));
const chance = (p) => rnd() < p;
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const round = (v, d = 0) => Math.round(v * 10 ** d) / 10 ** d;
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

// the same formats as src/fit.ts hms and src/dates.ts addDays
const pad = (n) => String(n).padStart(2, "0");
const hms = (sec) => {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
};
const addDays = (day, n) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekday = (day) => new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 Sunday
const month = (day) => Number(day.slice(5, 7));

const START = addDays(END, -7 * WEEKS);
const PREV_START = addDays(START, -7 * (WEEKS + 1));
const DAYS = Math.round((Date.parse(END) - Date.parse(PREV_START)) / 86_400_000) + 1;

// the athlete
const REST_HR = 52;
const MAX_HR = 188;
const KG = 74;
const FLOORS = [94, 113, 132, 150, 169];
// races by the number of days before the end; the marathon is the season goal
const RACES = new Map([
  [24, ["Lakeside Marathon", 42.2]],
  [129, ["City 10K", 10]],
  [199, ["Spring Half Marathon", 21.1]],
  [283, ["Park 5K", 5]],
  [388, ["Autumn Half Marathon", 21.1]],
  [493, ["New Year 10K", 10]],
]);
const MARATHON = addDays(END, -24);
const ILLNESS = [addDays(END, -240), addDays(END, -234)]; // a week with a cold
const HOLIDAY = [addDays(END, -80), addDays(END, -67)]; // two weeks in the mountains
const inRange = (day, [a, b]) => day >= a && day <= b;

/** 0 a year before the window, 1 at the end: easy pace improves with it. */
const fitness = (i) => clamp(i / DAYS, 0, 1);
const easyPace = (i) => 392 - 42 * fitness(i); // 6:32/km to 5:50/km
const zoneOf = (hr) => FLOORS.filter((f) => hr >= f).length - 1;

/** The seconds in each HR zone: most in the lap's zone, some in the ones next to it. */
function addZones(zones, sec, hr) {
  const z = clamp(zoneOf(hr), 0, 4);
  zones[z] += sec * 0.7;
  zones[Math.max(z - 1, 0)] += sec * 0.2;
  zones[Math.min(z + 1, 4)] += sec * 0.1;
}

/** Training impulse from the heart rate reserve: about Garmin's load for the same session. */
const trimp = (minutes, hr) => {
  const hrr = clamp((hr - REST_HR) / (MAX_HR - REST_HR), 0, 1);
  return minutes * hrr * 0.64 * Math.exp(1.92 * hrr);
};

/** The fields that every summary has, from its zones and load. */
function effort(a, zones, load, moving, anaerobic, label) {
  a.trainingLoad = round(load, 1);
  a.aerobicTE = round(clamp(0.8 + 4.1 * (1 - Math.exp(-load / 105)) + r(-0.2, 0.2), 0, 5), 1);
  a.anaerobicTE = round(clamp(anaerobic + r(-0.2, 0.2), 0, 5), 1);
  a.teLabel = label;
  a.hrZonesSec = zones.map(Math.round);
  a.moderateMinutes = Math.round((zones[1] + zones[2]) / 60);
  a.vigorousMinutes = Math.round((zones[3] + zones[4]) / 60);
  a.bodyBatteryDelta = -Math.round(load / 6 + moving / 900);
}

// ------------------------------------------------------------------ runs

/** A run of `km` at about `pace` s/km; `kind` shapes its laps. */
function run(i, name, km, pace, kind, race = false) {
  const hilly = r(4, 9);
  const easy = easyPace(i);
  const hrAt = (p) => clamp(140 + (easy - p) * 0.4, 100, MAX_HR - 2);
  const laps = [];
  const plan = [];
  if (kind === "intervals") {
    const reps = ri(5, 7);
    plan.push([2, easy + 10, "warmup"]);
    for (let n = 0; n < reps; n++) {
      plan.push([0.8, easy - 95, "interval"], [0.4, easy + 40, "recovery"]);
    }
    plan.push([km - 2 - reps * 1.2, easy + 15, "cooldown"]);
  } else if (kind === "tempo") {
    plan.push([2, easy + 5, "warmup"], [km - 3, easy - 62, "active"], [1, easy + 15, "cooldown"]);
  } else {
    plan.push([km, pace, "active"]);
  }
  let total = 0;
  let lapNo = 0;
  for (const [segKm, segPace, intensity] of plan) {
    // 1 km laps inside a segment, the rest as a last short lap
    for (let left = round(segKm, 2); left > 0.005; left = round(left - 1, 2)) {
      const lapKm = round(Math.min(1, left), 2);
      const drift = kind === "long" || race ? (laps.length / Math.max(km, 1)) * 8 : 0;
      const p = segPace + r(-7, 7) + (race ? -drift * 0.6 : drift * 0.4);
      const time = p * lapKm;
      const hr = Math.round(hrAt(p) + drift + r(-3, 3));
      const up = Math.round(lapKm * hilly * r(0.3, 1.7));
      laps.push({
        lap: ++lapNo,
        km: lapKm,
        time: hms(time),
        pace: `${hms(p)}/km`,
        avgHR: hr,
        maxHR: Math.min(hr + ri(4, 12), MAX_HR),
        cadenceSpm: Math.round(162 + (easy - p) * 0.18 + r(-3, 3)),
        ascentM: up,
        descentM: Math.round(lapKm * hilly * r(0.3, 1.7)),
        avgPowerW: Math.round((84 * 1000) / p + r(-8, 8)),
        intensity,
        trigger: "distance",
        sec: time,
      });
      total += time;
    }
  }
  laps.at(-1).trigger = "session_end";
  const zones = [0, 0, 0, 0, 0];
  let load = 0;
  for (const l of laps) {
    addZones(zones, l.sec, l.avgHR);
    load += trimp(l.sec / 60, l.avgHR);
  }
  const avgPace = total / km;
  const avgHR = Math.round(laps.reduce((s, l) => s + l.avgHR * l.sec, 0) / total);
  const cadence = Math.round(laps.reduce((s, l) => s + l.cadenceSpm * l.sec, 0) / total);
  const ascent = laps.reduce((s, l) => s + l.ascentM, 0);
  const speed = 1000 / avgPace;
  const strideCm = round(((speed * 60) / cadence) * 100, 1);
  const vertOsc = round(r(7.8, 9) - fitness(i) * 0.4, 1);
  // the running form of each lap, from its pace: no random numbers, so the other data stays the same
  for (const l of laps) {
    const p = l.sec / l.km;
    const stride = round(((1000 / p) * 60 * 100) / l.cadenceSpm, 1);
    l.gctMs = Math.round(258 - (easy - p) * 0.35 - fitness(i) * 10);
    l.vertOscCm = vertOsc;
    l.strideCm = stride;
    l.vertRatioPct = round((vertOsc / stride) * 100, 1);
  }
  const a = {
    name,
    type: "running",
    sport: "running",
    km: round(km, 2),
    duration: hms(total),
    pace: `${hms(avgPace)}/km`,
    avgHR,
    maxHR: Math.max(...laps.map((l) => l.maxHR)),
    cadenceSpm: cadence,
    ascentM: ascent,
    ...(race ? { race: true } : {}),
  };
  const label = race
    ? km > 30
      ? "aerobic_base"
      : km > 15
        ? "tempo"
        : "vo2max"
    : { intervals: "vo2max", tempo: "threshold", long: "aerobic_base", easy: "recovery" }[kind];
  const anaerobic = kind === "intervals" ? r(2, 3.2) : race && km < 15 ? r(1.6, 2.4) : r(0, 0.6);
  effort(a, zones, load, total, anaerobic, label);
  Object.assign(a, {
    calories: Math.round(KG * km * 1.02),
    steps: Math.round((cadence * total) / 60),
    avgPowerW: Math.round((84 * 1000) / avgPace),
    normPowerW: Math.round((84 * 1000) / avgPace + (kind === "intervals" ? 18 : 6)),
    strideCm,
    gctMs: Math.round(258 - (easy - avgPace) * 0.35 - fitness(i) * 10 + r(-4, 4)),
    vertOscCm: vertOsc,
    vertRatioPct: round((vertOsc / strideCm) * 100, 1),
    gap: `${hms(avgPace - (ascent / km) * 0.35)}/km`,
  });
  const fastestKm = Math.min(...laps.filter((l) => l.km === 1).map((l) => l.sec));
  const best = {};
  for (const [split, d] of [
    ["1k", 1],
    ["mile", 1.609],
    ["5k", 5],
    ["10k", 10],
    ["half", 21.0975],
    ["marathon", 42.195],
  ]) {
    if (km + 0.05 >= d) best[split] = hms(d <= 1.61 ? fastestKm * d : avgPace * 0.99 * d);
  }
  a.best = best;
  // some long runs with the Run Walk Run method
  if (kind === "long" && chance(0.25)) {
    const walkSec = km * r(18, 25);
    a.runWalk = {
      runPace: `${hms(avgPace - 12)}/km`,
      runKm: round(km * 0.92, 2),
      walkTime: hms(walkSec),
    };
  }
  for (const l of laps) delete l.sec;
  a.laps = laps;
  return a;
}

// ------------------------------------------------------------------ other sports

function steady(i, sec, hr, label) {
  const zones = [0, 0, 0, 0, 0];
  addZones(zones, sec, hr);
  return { zones, load: trimp(sec / 60, hr) * r(0.9, 1.1), label };
}

function ride(i, km) {
  const speed = r(24, 28.5) + fitness(i) * 1.5;
  const sec = (km / speed) * 3600;
  const hr = Math.round(r(124, 136));
  const { zones, load } = steady(i, sec, hr);
  const power = Math.round(r(165, 195) + fitness(i) * 15);
  const a = {
    name: pick(["Weekend Ride", "Hill Loop", "Coffee Ride", "Lake Ride"]),
    type: pick(["cycling", "road_biking"]),
    sport: "cycling",
    km: round(km, 2),
    duration: hms(sec),
    pace: `${hms(sec / km)}/km`,
    avgHR: hr,
    maxHR: hr + ri(14, 26),
    ascentM: Math.round(km * r(7, 16)),
  };
  effort(a, zones, load, sec, r(0.1, 0.8), "aerobic_base");
  return Object.assign(a, {
    calories: Math.round((power * sec) / 1000 / 0.24 / 4.184),
    avgPowerW: power,
    normPowerW: power + ri(10, 25),
  });
}

function swim(i) {
  const km = round(pick([1.5, 1.75, 2, 2.25, 2.5]), 2);
  const per100 = r(118, 130) - fitness(i) * 8;
  const sec = per100 * km * 10;
  const rests = r(240, 480);
  const hr = Math.round(r(128, 142));
  const { zones, load } = steady(i, sec, hr);
  const lengths = km * 40;
  const strokesPerLength = r(15, 18);
  const a = {
    name: pick(["Pool Swim", "Lap Swimming", "Morning Swim"]),
    type: "lap_swimming",
    sport: "swimming",
    km,
    duration: hms(sec),
    pace: `${hms(sec / km)}/km`,
    avgHR: hr,
    maxHR: hr + ri(10, 20),
    elapsed: hms(sec + rests),
  };
  effort(a, zones, load, sec, r(0.3, 1.2), "aerobic_base");
  return Object.assign(a, {
    calories: Math.round((sec / 60) * 9.5),
    swolf: Math.round(per100 / 4 + strokesPerLength),
    poolLengthM: 25,
    lengths,
    strokes: Math.round(lengths * strokesPerLength),
  });
}

function hike(i, km) {
  const pace = r(780, 960);
  const sec = km * pace;
  const hr = Math.round(r(108, 122));
  const { zones, load } = steady(i, sec, hr);
  const a = {
    name: pick(["Mountain Hike", "Ridge Walk", "Valley Trail", "Lake Trail"]),
    type: "hiking",
    sport: "hiking",
    km: round(km, 2),
    duration: hms(sec),
    pace: `${hms(pace)}/km`,
    avgHR: hr,
    maxHR: hr + ri(20, 34),
    cadenceSpm: ri(98, 108),
    ascentM: Math.round(km * r(45, 95)),
    elapsed: hms(sec + r(1200, 3600)),
  };
  effort(a, zones, load, sec, 0, "aerobic_base");
  return Object.assign(a, {
    calories: Math.round((sec / 60) * 7.5),
    steps: Math.round(km * 1450),
    strideCm: round(r(66, 74), 1),
  });
}

function walk(i) {
  const km = r(3, 7);
  const pace = r(560, 640);
  const sec = km * pace;
  const hr = Math.round(r(92, 104));
  const { zones, load } = steady(i, sec, hr);
  const a = {
    name: pick(["Evening Walk", "Morning Walk", "Lunch Walk"]),
    type: "walking",
    sport: "walking",
    km: round(km, 2),
    duration: hms(sec),
    pace: `${hms(pace)}/km`,
    avgHR: hr,
    maxHR: hr + ri(8, 18),
    cadenceSpm: ri(104, 114),
    ascentM: Math.round(km * r(3, 9)),
  };
  effort(a, zones, load, sec, 0, "recovery");
  return Object.assign(a, {
    calories: Math.round((sec / 60) * 5),
    steps: Math.round(km * 1300),
    strideCm: round(r(72, 79), 1),
  });
}

function padel() {
  const elapsed = r(3600, 5400);
  const moving = elapsed * r(0.38, 0.48);
  const hr = Math.round(r(128, 142));
  const zones = [0, 0, 0, 0, 0];
  for (const [sec, h] of [
    [elapsed * 0.5, hr - 15],
    [elapsed * 0.35, hr + 5],
    [elapsed * 0.15, hr + 22],
  ]) {
    addZones(zones, sec, h);
  }
  const a = {
    name: "Padel",
    type: "paddelball",
    sport: "racket",
    duration: hms(moving),
    avgHR: hr,
    maxHR: Math.min(hr + ri(20, 35), MAX_HR),
    elapsed: hms(elapsed),
  };
  effort(a, zones, trimp(elapsed / 60, hr) * 0.75, moving, r(1, 2), "anaerobic_capacity");
  return Object.assign(a, {
    calories: Math.round((elapsed / 60) * 9.5),
    steps: Math.round((elapsed / 60) * r(85, 105)),
    strideCm: round(r(64, 72), 1),
  });
}

// [name, category, primary, secondary, start kg, kg step]; no kg: body weight
const EXERCISES = {
  "Barbell Back Squat": ["Squat", ["Quads"], ["Glutes", "Hamstrings"], 55, 2.5],
  "Barbell Bench Press": ["Bench Press", ["Chest"], ["Triceps", "Shoulders"], 47.5, 2.5],
  "Bent Over Row": ["Row", ["Lats"], ["Biceps", "Traps"], 42.5, 2.5],
  "Romanian Deadlift": ["Deadlift", ["Hamstrings"], ["Glutes", "Lower Back"], 52.5, 2.5],
  "Dumbbell Shoulder Press": ["Shoulder Press", ["Shoulders"], ["Triceps", "Traps"], 12, 1],
  "Lat Pulldown": ["Pull Up", ["Lats"], ["Biceps", "Shoulders"], 42.5, 2.5],
  "Dumbbell Biceps Curl": ["Curl", ["Biceps"], ["Forearm", "Shoulders"], 9, 1],
  "Dumbbell Lunge": ["Lunge", ["Quads"], ["Glutes", "Hamstrings"], 10, 1],
  "Push Up": ["Push Up", ["Chest"], ["Triceps", "Shoulders"]],
  Plank: ["Plank", ["Abs"], ["Shoulders", "Obliques"]],
};
const SESSIONS = {
  "Strength A": ["Barbell Back Squat", "Barbell Bench Press", "Bent Over Row", "Push Up", "Plank"],
  "Strength B": [
    "Romanian Deadlift",
    "Dumbbell Shoulder Press",
    "Lat Pulldown",
    "Dumbbell Biceps Curl",
    "Dumbbell Lunge",
    "Plank",
  ],
};

function strength(i, name, light) {
  const exercises = [];
  let work = 0;
  for (const ex of SESSIONS[name]) {
    const [category, primaryMuscles, secondaryMuscles, startKg, step] = EXERCISES[ex];
    const sets = [];
    for (let n = ri(3, 4); n > 0; n--) {
      const restSec = ri(80, 125);
      if (ex === "Plank") {
        sets.push({ reps: 1, seconds: Math.round(45 + fitness(i) * 30 + r(-5, 5)), restSec });
      } else if (!startKg) {
        const reps = Math.round(14 + fitness(i) * 8 + r(-3, 2));
        sets.push({ reps, seconds: Math.round(reps * 2.2), restSec });
      } else {
        // progressive overload over the year, a lighter session in a deload week
        const kg =
          Math.round((startKg * (1 + 0.22 * fitness(i)) * (light ? 0.85 : 1)) / step) * step;
        const reps = pick([8, 8, 10, 10, 12]);
        sets.push({ reps, seconds: Math.round(reps * r(3, 4.2)), restSec, kg });
      }
      work += sets.at(-1).seconds;
    }
    exercises.push({ exercise: ex, category, primaryMuscles, secondaryMuscles, sets });
  }
  const elapsed = r(2900, 3500);
  const hr = Math.round(r(102, 114));
  const { zones } = steady(i, elapsed, hr);
  const a = {
    name,
    type: "strength_training",
    sport: "fitnessEquipment",
    duration: hms(work + r(200, 400)),
    avgHR: hr,
    maxHR: hr + ri(14, 24),
    elapsed: hms(elapsed),
  };
  effort(a, zones, trimp(elapsed / 60, hr) * 1.2, work, r(0.6, 1.3), "recovery");
  return Object.assign(a, {
    calories: Math.round((elapsed / 60) * 6.5),
    steps: ri(600, 1200),
    exercises,
  });
}

// ------------------------------------------------------------------ the year

/** The long run in km for a day `toRace` days before the marathon (negative: after it). */
function longRun(i, toRace) {
  if (toRace > 0 && toRace <= 126) {
    if (toRace <= 8) return 0; // race week: no long run before the race
    if (toRace <= 15) return 18;
    return round(32 - ((toRace - 22) / 104) * 16, 1);
  }
  if (toRace <= 0 && toRace > -10) return 0;
  return round(12 + fitness(i) * 5 + r(-1, 1), 1);
}

const at = (day, hh, mm) => `${day} ${pad(hh)}:${pad(mm)}:00`;
const activities = [];
const hrv = [];
const daily = [];
let lastLoad = 0;
for (let i = 0; i < DAYS; i++) {
  const day = addDays(PREV_START, i);
  const dow = weekday(day);
  const daysToEnd = DAYS - 1 - i;
  const toRace = Math.round((Date.parse(MARATHON) - Date.parse(day)) / 86_400_000);
  const weekNo = Math.floor(i / 7);
  const deload = weekNo % 4 === 3;
  const scale = deload ? 0.75 : 1;
  const sick = inRange(day, ILLNESS);
  const holiday = inRange(day, HOLIDAY);
  const recovering = toRace < 0 && toRace > -10;
  const easy = easyPace(i);
  const today = [];
  const add = (a, hh, mm) => today.push(Object.assign(a, { start: at(day, hh, mm + ri(0, 25)) }));

  if (RACES.has(daysToEnd)) {
    const [name, km] = RACES.get(daysToEnd);
    // Riegel from a 5K at about 82% of easy pace
    const fiveK = easy * 0.82 * 5;
    const pace = (fiveK * (km / 5) ** 1.06) / km;
    add(run(i, name, km, pace, "race", true), 8, 30);
  } else if (!sick) {
    const skip = () => chance(holiday ? 0.15 : 0.08);
    if (dow === 2 && !recovering && !holiday && !skip()) {
      add(run(i, "Track Intervals", round(r(9, 11) * scale, 1), easy, "intervals"), 18, 30);
    }
    if (dow === 4 && !recovering && !skip()) {
      const tempo = !holiday && toRace !== 3;
      add(
        tempo
          ? run(i, "Tempo Run", round(r(10, 13) * scale, 1), easy, "tempo")
          : run(i, "Easy Run", round(r(7, 9), 1), easy + r(0, 10), "easy"),
        7,
        0,
      );
    }
    if (dow === 6) {
      const km = longRun(i, toRace) * scale;
      if (km > 0 && !skip()) add(run(i, "Long Run", km, easy + r(-5, 10), "long"), 7, 15);
    }
    if ((dow === 1 || dow === 5) && !recovering && !holiday && chance(0.5) && !skip()) {
      add(run(i, "Easy Run", round(r(6, 9) * scale, 1), easy + r(0, 12), "easy"), 7, 0);
    }
    if ((dow === 0 || dow === 3) && recovering && toRace < -4) {
      add(run(i, "Easy Run", round(r(5, 7), 1), easy + 20, "easy"), 8, 0);
    }
    if (!holiday && (dow === 3 || dow === 5) && (toRace > 8 || toRace < -7) && !skip()) {
      add(strength(i, dow === 3 ? "Strength A" : "Strength B", deload), 18, 30);
    }
    if (dow === 5 && !holiday && chance(0.6)) add(padel(), 20, 30);
    if (dow === 0 && !holiday && month(day) >= 4 && month(day) <= 10 && chance(0.9)) {
      add(ride(i, r(35, 75) * scale), 9, 0);
    }
    const swimSeason = month(day) >= 11 || month(day) <= 3;
    if (dow === 1 && (swimSeason ? chance(0.8) : chance(0.25))) add(swim(i), 12, 30);
    if (holiday && dow !== 6 && chance(0.85)) add(hike(i, r(8, 18)), 9, 0);
    if (chance(holiday ? 0.3 : 0.35)) add(walk(i), 19, 15);
  } else if (chance(0.4)) {
    add(walk(i), 17, 0);
  }

  const load = today.reduce((s, a) => s + (a.trainingLoad ?? 0), 0);
  activities.push(...today.toSorted((a, b) => (a.start < b.start ? -1 : 1)));

  // HRV drops after a hard day and while sick, and rises slowly with fitness
  if (day >= START && chance(0.97)) {
    const base = 62 + fitness(i) * 7;
    const value = Math.round(base - lastLoad / 30 - (sick ? 14 : 0) + r(-6, 6));
    hrv.push({ date: day, hrv: value });
  }
  daily.push({ day, load, steps: today.reduce((s, a) => s + (a.steps ?? 0), 0) });
  lastLoad = load;
}

// ids in time order, like Garmin's
activities.forEach((a, n) => (a.id = 30500000000 + n * 7919 + ri(0, 7000)));
const withId = activities.map(({ id, ...a }) => ({ id, ...a }));
const dayOf = (a) => a.start.slice(0, 10);
const current = withId.filter((a) => dayOf(a) >= START).toReversed();
// only the details that getDashboardData attaches, for a page with the workout comparison that has
// updated for months: every repeated run has its .FIT file saved
asServer(current, true, true);
const previous = withId
  .filter((a) => dayOf(a) < START)
  .toReversed()
  .map((a) => {
    const o = {};
    for (const f of ["id", "start", "type", "km", "duration", "elapsed", "trainingLoad", "sport"]) {
      if (a[f] !== undefined) o[f] = a[f];
    }
    return o;
  });

const LOW = 58;
const HIGH = 80;
hrv.forEach((h, n) => {
  const week = hrv.slice(Math.max(n - 6, 0), n + 1);
  h.weeklyAvg = Math.round(week.reduce((s, x) => s + x.hrv, 0) / week.length);
  h.status =
    h.weeklyAvg < LOW - 6
      ? "LOW"
      : h.weeklyAvg < LOW || h.weeklyAvg > HIGH
        ? "UNBALANCED"
        : "BALANCED";
  h.low = LOW;
  h.high = HIGH;
});

const recovery = daily.slice(-14).map(({ day, load, steps }, n, rows) => {
  const hard = (rows[n - 1]?.load ?? 0) > 120;
  const sleepH = round(clamp(r(6.4, 8.4) - (weekday(day) === 0 ? 0 : r(0, 0.4)), 5.5, 9), 2);
  const awake = round(r(0.1, 0.4), 2);
  const deep = round((sleepH - awake) * r(0.18, 0.23), 2);
  const rem = round((sleepH - awake) * r(0.2, 0.25), 2);
  const bedMin = Math.round(r(1340, 1470)) % 1440;
  return {
    date: day,
    sleepH,
    sleepScore: Math.round(clamp(55 + (sleepH - 6) * 14 + r(-6, 6) - (hard ? 5 : 0), 40, 98)),
    needH: hard ? 8.5 : 8,
    bedMin,
    deep,
    light: round(sleepH - awake - deep - rem, 2),
    rem,
    awake,
    rhr: Math.round(REST_HR - 2 + (hard ? 3 : 0) + r(-1.5, 1.5)),
    bbHigh: Math.round(clamp(60 + (sleepH - 6) * 14 + r(-6, 6), 30, 100)),
    bbLow: Math.round(clamp(40 - load / 8 + r(-8, 4), 5, 45)),
    stress: Math.round(r(22, 38)),
    steps: Math.round(steps + r(4500, 8500)),
    stepGoal: 10000,
    floors: ri(3, 16),
  };
});

const data = {
  generated: END,
  weeks: WEEKS,
  start: START,
  end: END,
  prevStart: PREV_START,
  prevEnd: addDays(START, -1),
  zones: [
    {
      trainingMethod: "HR_MAX_BASED",
      restingHeartRateUsed: REST_HR,
      lactateThresholdHeartRateUsed: null,
      zone1Floor: FLOORS[0],
      zone2Floor: FLOORS[1],
      zone3Floor: FLOORS[2],
      zone4Floor: FLOORS[3],
      zone5Floor: FLOORS[4],
      maxHeartRateUsed: MAX_HR,
      restingHrAutoUpdateUsed: false,
      sport: "DEFAULT",
      changeState: "UNCHANGED",
    },
  ],
  fitnessAge: {
    chronologicalAge: 41,
    fitnessAge: 34.2,
    achievableFitnessAge: 31.2,
    previousFitnessAge: 35.6,
    components: {
      bodyFat: {
        value: 16.8,
        targetValue: 15,
        improvementValue: 1.8,
        potentialAge: 32.9,
        priority: 2,
        stale: false,
        lastMeasurementDate: addDays(END, -18),
      },
      vigorousDaysAvg: {
        value: 3.6,
        targetValue: 4,
        potentialAge: 33.6,
        priority: 1,
        stale: false,
        numOfWeeksForIm: 4,
      },
      rhr: { value: REST_HR - 2, stale: false },
      vigorousMinutesAvg: { value: 156, stale: false, numOfWeeksForIm: 4 },
    },
    lastUpdated: END,
  },
  activities: current,
  previousActivities: previous,
  hrv,
  recovery,
  sync: {
    garminCalls: 5,
    newActivities: current.filter((a) => dayOf(a) >= addDays(END, -1)).length,
    failedDays: 0,
    failedDates: [],
    failedSections: [],
    cachedActivities: withId.length,
  },
};

mkdirSync(dirname(outJson), { recursive: true });
writeFileSync(outJson, `${JSON.stringify(data)}\n`);
const counts = Object.entries(Object.groupBy(current, (a) => a.type)).map(
  ([t, xs]) => `${t} ${xs.length}`,
);
console.log(
  `${outJson} written: ${START} to ${END}, ${current.length} activities (${counts.join(", ")}), ${previous.length} before, ${hrv.length} HRV days`,
);
// a note above the page, outside #app so the page script never redraws it; the theme colours apply.
// The page saves an edited layout in the browser (LAYOUT_KEY in src/page/app.ts): the demo drops it on
// each load, before the page script reads it, so every visit starts from the preset layout.
const LAYOUT_KEY = "garmin-layout:";
const NOTE = `<style>.demo-note{max-width:1440px;margin:12px auto 0;padding:0 16px}.demo-note p{margin:0;padding:8px 12px;border:1px solid var(--warn);border-radius:8px;background:var(--panel);color:var(--text)}.demo-note strong{color:var(--warn)}</style>
    <script>try{localStorage.removeItem("${LAYOUT_KEY}"+location.pathname)}catch(e){}</script>
    <div class="demo-note" role="note"><p><strong>Sample data.</strong> A demo of garmin-personal-mcp with made-up activities, not a real Garmin account. Not affiliated with or endorsed by Garmin. It shows a page that has updated for a year, so Workout trend has the laps of every session. Try Edit layout in the settings menu: your changes last until you reload the page.</p></div>
    <div id="app"></div>`;

if (outHtml) {
  const page = fillPage(readFileSync("dist/dashboard.html", "utf8"), data, null, {
    workouts: true,
  });
  if (!page.includes('<div id="app"></div>')) throw new Error("dist/dashboard.html has no #app");
  if (!page.includes(LAYOUT_KEY)) throw new Error(`dist/dashboard.html has no ${LAYOUT_KEY} key`);
  mkdirSync(dirname(outHtml), { recursive: true });
  writeFileSync(
    outHtml,
    page.replace('<div id="app"></div>', () => NOTE),
  );
  console.log(`${outHtml} written`);
}
