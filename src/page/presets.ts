import type { Instance, Span } from "./layout";

/** The preset widgets of each board, in order, with their width in columns. */
type Row = [widget: string, span: Span][];
const PRESETS: Record<string, Row> & { generic: Row } = {
  all: [
    ["kpis", 3],
    ["readiness", 2],
    ["calendar", 1],
    ["periodComparison", 3],
    ["weeklyVolume", 2],
    ["intensityMinutes", 1],
    ["records", 3],
    ["loadSafety", 3],
    ["fitnessFatigue", 3],
    ["loadVsRecovery", 3],
    ["activities", 3],
    ["coachNotes", 3],
  ],
  recovery: [
    ["readiness", 2],
    ["fitnessAge", 1],
    ["loadVsRecovery", 3],
    ["hrv", 1],
    ["restingHr", 1],
    ["sleep", 1],
    ["sleepNeed", 1],
    ["bedtime", 1],
    ["bodyBattery", 1],
    ["stress", 3],
    ["recoveryTrend", 3],
  ],
  running: [
    ["typeKpis", 3],
    ["typeWeekly", 2],
    ["hrZones", 1],
    ["records", 3],
    ["races", 2],
    ["racePredictor", 1],
    ["aerobicFitness", 2],
    ["bestEfforts", 1],
    ["trainingEffect", 2],
    ["intensityShare", 1],
    ["runningForm", 3],
    ["longRuns", 2],
    ["runWalk", 1],
    ["workoutTrend", 3],
    ["activities", 3],
  ],
  strengthTraining: [
    ["typeKpis", 3],
    ["typeWeekly", 2],
    ["hrZones", 1],
    ["records", 3],
    ["setsPerCategory", 2],
    ["muscleBalance", 1],
    ["planAdherence", 3],
    ["exercises", 3],
    ["strengthSessions", 3],
  ],
  walking: [
    ["typeKpis", 3],
    ["typeWeekly", 2],
    ["hrZones", 1],
    ["records", 3],
    ["steps", 3],
    ["walkDetails", 3],
    ["activities", 3],
  ],
  hiking: [
    ["typeKpis", 3],
    ["typeWeekly", 2],
    ["hrZones", 1],
    ["records", 3],
    ["hikeVertical", 3],
    ["activities", 3],
  ],
  cycling: [
    ["typeKpis", 3],
    ["typeWeekly", 2],
    ["hrZones", 1],
    ["records", 3],
    ["intensityShare", 3],
    ["hikeVertical", 3],
    ["bikeDetails", 3],
    ["activities", 3],
  ],
  swimming: [
    ["typeKpis", 3],
    ["typeWeekly", 2],
    ["hrZones", 1],
    ["records", 3],
    ["swimTrend", 3],
    ["swimDetails", 3],
    ["activities", 3],
  ],
  racket: [
    ["typeKpis", 3],
    ["typeWeekly", 2],
    ["hrZones", 1],
    ["records", 3],
    ["racketDetails", 3],
    ["activities", 3],
  ],
  generic: [
    ["typeKpis", 3],
    ["typeWeekly", 2],
    ["hrZones", 1],
    ["records", 3],
    ["activities", 3],
  ],
};

/**
 * The preset widgets of a page from before the `seen` record: the widgets that every such board
 * has met. Frozen on purpose; never add a widget here when a release adds one to a preset.
 */
const BASELINE: Record<string, string[]> & { generic: string[] } = {
  all: [
    "kpis",
    "readiness",
    "calendar",
    "periodComparison",
    "records",
    "weeklyVolume",
    "intensityMinutes",
    "loadSafety",
    "fitnessFatigue",
    "loadVsRecovery",
    "activities",
    "coachNotes",
  ],
  recovery: [
    "readiness",
    "fitnessAge",
    "loadVsRecovery",
    "hrv",
    "restingHr",
    "sleep",
    "sleepNeed",
    "bedtime",
    "bodyBattery",
  ],
  running: [
    "typeKpis",
    "typeWeekly",
    "hrZones",
    "bestEfforts",
    "races",
    "aerobicFitness",
    "intensityShare",
    "runningForm",
    "runWalk",
    "trainingEffect",
    "racePredictor",
    "longRuns",
    "workoutTrend",
    "activities",
  ],
  strengthTraining: [
    "typeKpis",
    "typeWeekly",
    "hrZones",
    "setsPerCategory",
    "muscleBalance",
    "exercises",
    "strengthSessions",
  ],
  walking: ["typeKpis", "typeWeekly", "hrZones", "walkDetails", "steps", "activities"],
  hiking: ["typeKpis", "typeWeekly", "hrZones", "hikeVertical", "activities"],
  cycling: ["typeKpis", "typeWeekly", "hrZones", "bikeDetails", "activities"],
  swimming: ["typeKpis", "typeWeekly", "hrZones", "swimDetails", "activities"],
  racket: ["typeKpis", "typeWeekly", "hrZones", "racketDetails", "activities"],
  generic: ["typeKpis", "typeWeekly", "hrZones", "activities"],
};

export const PRESET_BOARDS: readonly string[] = Object.keys(PRESETS);

/** A board name is user data (`constructor`, `__proto__`): only an own key picks a list. */
const pick = <T>(table: Record<string, T> & { generic: T }, board: string): T =>
  Object.entries(table).find(([name]) => name === board)?.[1] ?? table.generic;

export function baseline(board: string): string[] {
  return pick(BASELINE, board);
}

export function preset(board: string): Instance[] {
  // any other SDK sport has the widgets of the Other board
  return pick(PRESETS, board).map(([widget, span]) => ({
    id: widget,
    widget,
    span,
  }));
}
