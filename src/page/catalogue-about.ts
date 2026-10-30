/** What each built-in widget shows, in English, for Claude (editDashboard) and the docs. Not in the page. */
export const ABOUT: Record<string, string> = {
  kpis: "Window totals; the last 7 days against the 4-week average for distance and time; the 7:28 load ratio; last night's HRV against its 7-day average.",
  readiness:
    "Today's verdict (go easy, normal, ready to push) from HRV status, sleep score, resting HR and the load ratio. The dashboard's own rule.",
  fitnessAge:
    "Garmin fitness age against actual age, the achievable age, and, under Details, its components with Garmin's targets.",
  periodComparison:
    "Sessions, distance, time and load of the window against the same number of weeks before it, per type and in total.",
  records:
    "Best efforts, longest run and ride, heaviest set and the best estimated 1RM of each exercise in the window: 4 first, the others under Show all.",
  weeklyVolume:
    "Time, distance, sessions or load of each week, stacked by type, with a 4-week average line.",
  intensityMinutes:
    "Moderate + 2 x vigorous minutes of the activities each week, against 150 minutes.",
  loadSafety:
    "Weekly load with its change against the week before (flagged above +10%), and 7-day monotony and strain (Foster).",
  calendar:
    "A heatmap of the training minutes of each day; a day shows its activities on hover or touch.",
  loadVsRecovery: "Daily load by type (bars) with nightly HRV (line).",
  hrv: "Nightly HRV of the last 14 days with its 7-day average and the balanced range.",
  restingHr: "Resting HR of the last 14 days.",
  sleep: "Sleep stages and sleep score of the last 14 nights.",
  sleepNeed: "Sleep against the sleep need of the last 14 nights, with the average gap.",
  bedtime: "Bedtimes of the last 14 nights and their spread.",
  bodyBattery: "Body battery high and low of the last 14 days.",
  activities:
    "The activities of the window, 15 rows first; activities with laps open to show them.",
  coachNotes: "The coach notes that the assistant writes for the data.",
  typeKpis:
    "Sessions, time, distance with pace or speed, HR, Garmin load and its share, and the last 7 days against the 4-week average.",
  typeWeekly: "Time, distance or sessions of each week.",
  hrZones: "Minutes in HR zones 1-5 each week.",
  bestEfforts: "The fastest 1 km, mile, 5 km, 10 km, half marathon and marathon in the window.",
  races: "Each race with its time, pace, HR, power and aerobic training effect.",
  aerobicFitness:
    "Pace against HR of each run (older runs paler), and weekly pace and efficiency (metres per heartbeat).",
  intensityShare: "The share of running time in Z1-2 (easy) and Z4-5 (hard) each week.",
  runningForm:
    "Weekly cadence, ground contact, stride, vertical oscillation and ratio, and power, one small chart for each: cadence and ground contact first, the others under Show all.",
  runWalk:
    "Run Walk Run sessions: the pace of the run segments, the overall pace and the walk time.",
  trainingEffect:
    "Aerobic and anaerobic training effect of each run, and the training effect labels of each week.",
  racePredictor:
    "Predicted 5 km, 10 km, half marathon and marathon times (Riegel), from the best effort of 5 km or more.",
  longRuns:
    "The share of the longest run in each week's km (flagged above 35%), weekly ascent, and the pace split and HR drift of races and long runs.",
  setsPerCategory: "Completed sets of each movement category each week.",
  muscleBalance: "Average weekly sets of each muscle group against 10-20, and the push:pull ratio.",
  exercises:
    "Each exercise by muscle group, with sort, search and group filter; a row opens its trend and its sessions.",
  strengthSessions:
    "Each strength session with its exercises and sets in order, the last 6 first, the others under Show all.",
  walkDetails:
    "Weekly pace and average HR, and steps, cadence and body battery change of each walk.",
  steps: "Daily steps against the goal, and floors, for the last 14 days.",
  hikeVertical: "Vertical metres per hour of each activity with ascent.",
  bikeDetails: "Weekly speed and ascent, each ride, and indoor against outdoor time.",
  swimDetails: "Each swim with pace per 100 m, SWOLF, lengths, strokes and pool length.",
  racketDetails:
    "Each racket session: sport, HR, time in Z3+, Z4-5 share, calories per hour, training effect, and its load against a run of the same length.",
};
