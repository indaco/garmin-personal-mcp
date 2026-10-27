import { GROUPS } from "./calc";
import type { Key } from "./i18n/en";
import type { Span } from "./layout";

/**
 * The built-in widgets: id, title, the types they can show (none for a widget without a type) and width.
 * Pure data, so the server and the generated docs read the same list as the page. The descriptions are in
 * catalogue-about.ts: the server and the docs need them, the page does not.
 */
export interface CatalogueEntry {
  id: string;
  title: Key;
  types?: readonly string[];
  span: Span;
  /** The narrowest width that the widget fits in; 1 when not set. */
  minSpan?: Span;
}

export const CATALOGUE: readonly CatalogueEntry[] = [
  {
    id: "kpis",
    title: "w.kpis",
    types: ["all", ...GROUPS],
    span: 3,
  },
  {
    id: "readiness",
    title: "w.readiness",
    span: 2,
  },
  {
    id: "fitnessAge",
    title: "w.fitnessAge",
    span: 1,
  },
  {
    id: "periodComparison",
    title: "w.periodComparison",
    types: ["all", ...GROUPS],
    span: 3,
    minSpan: 2,
  },
  {
    id: "records",
    title: "w.records",
    types: ["all", ...GROUPS],
    span: 3,
  },
  {
    id: "weeklyVolume",
    title: "w.weeklyVolume",
    types: ["all", ...GROUPS],
    span: 2,
  },
  {
    id: "intensityMinutes",
    title: "w.intensityMinutes",
    types: ["all", ...GROUPS],
    span: 1,
  },
  {
    id: "loadSafety",
    title: "w.loadSafety",
    span: 3,
  },
  {
    id: "calendar",
    title: "w.calendar",
    types: ["all", ...GROUPS],
    span: 3,
  },
  {
    id: "loadVsRecovery",
    title: "w.loadVsRecovery",
    types: ["all", ...GROUPS],
    span: 3,
  },
  {
    id: "hrv",
    title: "w.hrv",
    span: 1,
  },
  { id: "restingHr", title: "w.restingHr", span: 1 },
  {
    id: "sleep",
    title: "w.sleep",
    span: 1,
  },
  {
    id: "sleepNeed",
    title: "w.sleepNeed",
    span: 1,
  },
  {
    id: "bedtime",
    title: "w.bedtime",
    span: 1,
  },
  {
    id: "bodyBattery",
    title: "w.bodyBattery",
    span: 1,
  },
  {
    id: "activities",
    title: "w.activities",
    types: ["all", ...GROUPS],
    span: 3,
    minSpan: 2,
  },
  {
    id: "coachNotes",
    title: "w.coachNotes",
    span: 3,
  },
  {
    id: "typeKpis",
    title: "w.typeKpis",
    types: ["all", ...GROUPS],
    span: 3,
  },
  {
    id: "typeWeekly",
    title: "w.typeWeekly",
    types: ["all", ...GROUPS],
    span: 2,
  },
  {
    id: "hrZones",
    title: "w.hrZones",
    types: ["all", ...GROUPS],
    span: 1,
  },
  {
    id: "bestEfforts",
    title: "w.bestEfforts",
    types: ["running"],
    span: 1,
  },
  {
    id: "races",
    title: "w.races",
    types: ["running"],
    span: 2,
  },
  {
    id: "aerobicFitness",
    title: "w.aerobicFitness",
    types: ["running"],
    span: 2,
  },
  {
    id: "intensityShare",
    title: "w.intensityShare",
    types: ["running"],
    span: 1,
  },
  {
    id: "runningForm",
    title: "w.runningForm",
    types: ["running"],
    span: 3,
  },
  {
    id: "runWalk",
    title: "w.runWalk",
    types: ["running"],
    span: 1,
  },
  {
    id: "trainingEffect",
    title: "w.trainingEffect",
    types: ["running"],
    span: 2,
  },
  {
    id: "racePredictor",
    title: "w.racePredictor",
    types: ["running"],
    span: 1,
  },
  {
    id: "longRuns",
    title: "w.longRuns",
    types: ["running"],
    span: 2,
  },
  {
    id: "setsPerCategory",
    title: "w.setsPerCategory",
    types: ["strengthTraining"],
    span: 2,
  },
  {
    id: "muscleBalance",
    title: "w.muscleBalance",
    types: ["strengthTraining"],
    span: 1,
  },
  {
    id: "exercises",
    title: "w.exercises",
    types: ["strengthTraining"],
    span: 3,
  },
  {
    id: "strengthSessions",
    title: "w.strengthSessions",
    types: ["strengthTraining"],
    span: 3,
  },
  {
    id: "walkDetails",
    title: "w.walkDetails",
    types: ["walking", "hiking"],
    span: 2,
  },
  {
    id: "steps",
    title: "w.steps",
    span: 1,
  },
  {
    id: "hikeVertical",
    title: "w.hikeVertical",
    types: ["hiking", "walking", "running"],
    span: 3,
  },
  {
    id: "bikeDetails",
    title: "w.bikeDetails",
    types: ["cycling"],
    span: 3,
  },
  {
    id: "swimDetails",
    title: "w.swimDetails",
    types: ["swimming"],
    span: 3,
  },
  {
    id: "racketDetails",
    title: "w.racketDetails",
    types: ["racket", "generic"],
    span: 3,
  },
];
