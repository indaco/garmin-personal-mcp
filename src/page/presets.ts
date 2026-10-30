import type { Instance, Span } from "./layout";

/** The preset widgets of each board, in order, with their width in columns. */
const PRESETS: Record<string, [widget: string, span: Span][]> = {
  all: [
    ["kpis", 3],
    ["readiness", 2],
    ["calendar", 1],
    ["periodComparison", 3],
    ["records", 3],
    ["weeklyVolume", 2],
    ["intensityMinutes", 1],
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
  ],
  running: [
    ["typeKpis", 3],
    ["typeWeekly", 2],
    ["hrZones", 1],
    ["bestEfforts", 1],
    ["races", 2],
    ["aerobicFitness", 2],
    ["intensityShare", 1],
    ["runningForm", 3],
    ["runWalk", 1],
    ["trainingEffect", 2],
    ["racePredictor", 1],
    ["longRuns", 2],
    ["activities", 3],
  ],
  strengthTraining: [
    ["typeKpis", 3],
    ["typeWeekly", 2],
    ["hrZones", 1],
    ["setsPerCategory", 2],
    ["muscleBalance", 1],
    ["exercises", 3],
    ["strengthSessions", 3],
  ],
  walking: [
    ["typeKpis", 3],
    ["typeWeekly", 2],
    ["hrZones", 1],
    ["walkDetails", 2],
    ["steps", 1],
    ["activities", 3],
  ],
  hiking: [
    ["typeKpis", 3],
    ["typeWeekly", 2],
    ["hrZones", 1],
    ["hikeVertical", 3],
    ["activities", 3],
  ],
  cycling: [
    ["typeKpis", 3],
    ["typeWeekly", 2],
    ["hrZones", 1],
    ["bikeDetails", 3],
    ["activities", 3],
  ],
  swimming: [
    ["typeKpis", 3],
    ["typeWeekly", 2],
    ["hrZones", 1],
    ["swimDetails", 3],
    ["activities", 3],
  ],
  racket: [
    ["typeKpis", 3],
    ["typeWeekly", 2],
    ["hrZones", 1],
    ["racketDetails", 3],
    ["activities", 3],
  ],
  generic: [
    ["typeKpis", 3],
    ["typeWeekly", 2],
    ["hrZones", 1],
    ["activities", 3],
  ],
};

export function preset(board: string): Instance[] {
  // any other SDK sport has the widgets of the Other board
  return (PRESETS[board] ?? PRESETS.generic).map(([widget, span]) => ({
    id: widget,
    widget,
    span,
  }));
}
