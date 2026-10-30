/**
 * The example questions of "ask in your own words", by sport, with the tools that answer them.
 * Questions of the sports outside AUTHORED are quoted word for word from the README; the site test
 * checks it.
 */
export const QUESTIONS: Record<string, [question: string, tools: string][]> = {
  running: [
    ["List my last 5 activities, with pace and heart rate.", "listActivities"],
    [
      "How much time did I spend in each HR zone on my runs this month?",
      "listActivities · getHeartRateZones",
    ],
    ["Show the laps of my last run.", "getActivityLaps"],
    [
      "How did my sessions named Tempo 5k and Long run change over the last 2 months?",
      "listActivities",
    ],
    [
      "My run on Saturday felt hard. Compare it with my sleep and HRV of the nights before.",
      "listActivities · getSleep · getHrvRange",
    ],
  ],
  strength: [
    ["Compare my sets of this week with the week before.", "getActivitySets"],
    ["Which muscles did I train most this week?", "getActivitySets"],
    [
      "What was my heaviest squat set this month, and what 1RM does it suggest?",
      "listActivities · getActivitySets",
    ],
    ["Which of my lifts have stalled over the last 6 weeks?", "listActivities · getActivitySets"],
    ["How long did I rest between sets in my last strength session?", "getActivitySets"],
    [
      "How much weight did I lift in total in each strength session this month?",
      "listActivities · getActivitySets",
    ],
    ["Did I do the reps and rests my workout planned?", "getActivityWorkouts · getActivitySets"],
  ],
  swimming: [
    ["Show the laps of my last swim.", "getActivityLaps"],
    ["How far did I swim this month, and at what pace?", "listActivities"],
  ],
  cycling: [
    ["List my rides of this month, with distance and heart rate.", "listActivities"],
    ["Show the laps of my last ride.", "getActivityLaps"],
  ],
  padel: [
    ["How many padel sessions did I play this month, and how long were they?", "listActivities"],
    ["Show the details of my last padel session.", "getActivity"],
  ],
  every: [
    ["List my last 5 activities, with pace and heart rate.", "listActivities"],
    [
      "How did my sessions named Tempo 5k and Long run change over the last 2 months?",
      "listActivities",
    ],
  ],
};

/** The sports whose questions are written for the page, not taken from the README. */
export const AUTHORED = new Set(["swimming", "cycling", "padel"]);

/** The line under the questions of a sport, or "". */
export function note(sport: string): string {
  if (sport === "every")
    return "Any activity your Garmin records works the same way: walks, hikes, yoga, HIIT and more.";
  if (AUTHORED.has(sport))
    return "These examples are written for this page. Any question about an activity works the same way.";
  return "";
}

export const label = (sport: string) => (sport === "every" ? "every activity" : sport);
