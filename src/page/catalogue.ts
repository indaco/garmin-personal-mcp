import { GROUPS, type Group } from "./calc";
import type { Key } from "./i18n/en";
import type { Span } from "./layout";

/**
 * The built-in widgets: id, title, the types they can show (none for a widget without a type) and width.
 * Pure data, so the server and the generated docs read the same list as the page. `about` is in English,
 * for Claude and the docs.
 */
export interface CatalogueEntry {
  id: string;
  title: Key;
  types?: readonly ("all" | Group)[];
  span: Span;
  about: string;
}

export const CATALOGUE: readonly CatalogueEntry[] = [
  {
    id: "kpis",
    title: "w.kpis",
    types: ["all", ...GROUPS],
    span: 3,
    about:
      "Window totals; the last 7 days against the 4-week average for distance and time; the 7:28 load ratio; last night's HRV against its 7-day average.",
  },
  {
    id: "readiness",
    title: "w.readiness",
    span: 2,
    about:
      "Today's verdict (go easy, normal, ready to push) from HRV status, sleep score, resting HR and the load ratio. The dashboard's own rule.",
  },
  {
    id: "fitnessAge",
    title: "w.fitnessAge",
    span: 1,
    about:
      "Garmin fitness age against actual age, the achievable age, and its components with Garmin's targets.",
  },
  {
    id: "periodComparison",
    title: "w.periodComparison",
    types: ["all", ...GROUPS],
    span: 3,
    about:
      "Sessions, distance, time and load of the window against the same number of weeks before it, per type and in total.",
  },
  {
    id: "records",
    title: "w.records",
    types: ["all", ...GROUPS],
    span: 3,
    about:
      "Best efforts, longest run and ride, heaviest set and the best estimated 1RM of each exercise in the window.",
  },
  {
    id: "weeklyVolume",
    title: "w.weeklyVolume",
    types: ["all", ...GROUPS],
    span: 2,
    about:
      "Time, distance, sessions or load of each week, stacked by type, with a 4-week average line.",
  },
  {
    id: "intensityMinutes",
    title: "w.intensityMinutes",
    types: ["all", ...GROUPS],
    span: 1,
    about: "Moderate + 2 x vigorous minutes of the activities each week, against 150 minutes.",
  },
  {
    id: "loadSafety",
    title: "w.loadSafety",
    span: 3,
    about:
      "Weekly load with its change against the week before (flagged above +10%), and 7-day monotony and strain (Foster).",
  },
  {
    id: "calendar",
    title: "w.calendar",
    types: ["all", ...GROUPS],
    span: 3,
    about:
      "A heatmap of the training minutes of each day; a day shows its activities on hover or touch.",
  },
  {
    id: "loadVsRecovery",
    title: "w.loadVsRecovery",
    types: ["all", ...GROUPS],
    span: 3,
    about: "Daily load by type (bars) with nightly HRV (line).",
  },
  {
    id: "hrv",
    title: "w.hrv",
    span: 1,
    about: "Nightly HRV of the last 14 days with its 7-day average and the balanced range.",
  },
  { id: "restingHr", title: "w.restingHr", span: 1, about: "Resting HR of the last 14 days." },
  {
    id: "sleep",
    title: "w.sleep",
    span: 1,
    about: "Sleep stages and sleep score of the last 14 nights.",
  },
  {
    id: "sleepNeed",
    title: "w.sleepNeed",
    span: 1,
    about: "Sleep against the sleep need of the last 14 nights, with the average gap.",
  },
  {
    id: "bedtime",
    title: "w.bedtime",
    span: 1,
    about: "Bedtimes of the last 14 nights and their spread.",
  },
  {
    id: "bodyBattery",
    title: "w.bodyBattery",
    span: 1,
    about: "Body battery high and low of the last 14 days.",
  },
  {
    id: "activities",
    title: "w.activities",
    types: ["all", ...GROUPS],
    span: 3,
    about: "The activities of the window, 15 rows first; activities with laps open to show them.",
  },
  {
    id: "coachNotes",
    title: "w.coachNotes",
    span: 3,
    about: "The coach notes that Claude writes for the data.",
  },
  {
    id: "typeKpis",
    title: "w.typeKpis",
    types: ["all", ...GROUPS],
    span: 3,
    about:
      "Sessions, time, distance with pace or speed, HR, Garmin load and its share, and the last 7 days against the 4-week average.",
  },
  {
    id: "typeWeekly",
    title: "w.typeWeekly",
    types: ["all", ...GROUPS],
    span: 2,
    about: "Time, distance or sessions of each week.",
  },
  {
    id: "hrZones",
    title: "w.hrZones",
    types: ["all", ...GROUPS],
    span: 1,
    about: "Minutes in HR zones 1-5 each week.",
  },
  {
    id: "bestEfforts",
    title: "w.bestEfforts",
    types: ["run"],
    span: 1,
    about: "The fastest 1 km, mile, 5 km, 10 km, half marathon and marathon in the window.",
  },
  {
    id: "races",
    title: "w.races",
    types: ["run"],
    span: 2,
    about: "Each race with its time, pace, HR, power and aerobic training effect.",
  },
  {
    id: "aerobicFitness",
    title: "w.aerobicFitness",
    types: ["run"],
    span: 2,
    about:
      "Pace against HR of each run (older runs paler), and weekly pace and efficiency (metres per heartbeat).",
  },
  {
    id: "intensityShare",
    title: "w.intensityShare",
    types: ["run"],
    span: 1,
    about: "The share of running time in Z1-2 (easy) and Z4-5 (hard) each week.",
  },
  {
    id: "runningForm",
    title: "w.runningForm",
    types: ["run"],
    span: 3,
    about:
      "Weekly cadence, stride, ground contact, vertical oscillation and ratio, and power, one small chart for each.",
  },
  {
    id: "runWalk",
    title: "w.runWalk",
    types: ["run"],
    span: 1,
    about:
      "Run Walk Run sessions: the pace of the run segments, the overall pace and the walk time.",
  },
  {
    id: "trainingEffect",
    title: "w.trainingEffect",
    types: ["run"],
    span: 2,
    about:
      "Aerobic and anaerobic training effect of each run, and the training effect labels of each week.",
  },
  {
    id: "racePredictor",
    title: "w.racePredictor",
    types: ["run"],
    span: 1,
    about:
      "Predicted 5 km, 10 km, half marathon and marathon times (Riegel), from the best effort of 5 km or more.",
  },
  {
    id: "longRuns",
    title: "w.longRuns",
    types: ["run"],
    span: 2,
    about:
      "The share of the longest run in each week's km (flagged above 35%), weekly ascent, and the pace split of races and long runs.",
  },
  {
    id: "setsPerCategory",
    title: "w.setsPerCategory",
    types: ["strength"],
    span: 2,
    about: "Completed sets of each movement category each week.",
  },
  {
    id: "muscleBalance",
    title: "w.muscleBalance",
    types: ["strength"],
    span: 1,
    about: "Average weekly sets of each muscle group against 10-20, and the push:pull ratio.",
  },
  {
    id: "exercises",
    title: "w.exercises",
    types: ["strength"],
    span: 3,
    about:
      "Each exercise by muscle group, with sort, search and group filter; a row opens its trend and its sessions.",
  },
  {
    id: "strengthSessions",
    title: "w.strengthSessions",
    types: ["strength"],
    span: 3,
    about: "Each strength session with its exercises and sets in order.",
  },
  {
    id: "walkDetails",
    title: "w.walkDetails",
    types: ["walk", "hike"],
    span: 2,
    about: "Weekly pace and average HR, and steps, cadence and body battery change of each walk.",
  },
  {
    id: "steps",
    title: "w.steps",
    span: 1,
    about: "Daily steps against the goal, and floors, for the last 14 days.",
  },
  {
    id: "hikeVertical",
    title: "w.hikeVertical",
    types: ["hike", "walk", "run"],
    span: 3,
    about: "Vertical metres per hour of each activity with ascent.",
  },
  {
    id: "bikeDetails",
    title: "w.bikeDetails",
    types: ["bike"],
    span: 3,
    about: "Weekly speed and ascent, each ride, and indoor against outdoor time.",
  },
  {
    id: "swimDetails",
    title: "w.swimDetails",
    types: ["swim"],
    span: 3,
    about: "Each swim with pace per 100 m, SWOLF, lengths, strokes and pool length.",
  },
  {
    id: "racketDetails",
    title: "w.racketDetails",
    types: ["racket", "other"],
    span: 3,
    about:
      "Each racket session: sport, HR, time in Z3+, Z4-5 share, calories per hour, training effect, and its load against a run of the same length.",
  },
];
