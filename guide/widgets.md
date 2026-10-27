# Widget catalogue

The built-in widgets of the dashboard. `pnpm guide` writes this page from the code: do not change
it by hand.

| Widget | Id | Shows | Types | Width |
| ------ | -- | ----- | ----- | ----- |
| Overview | `kpis` | Window totals; the last 7 days against the 4-week average for distance and time; the 7:28 load ratio; last night's HRV against its 7-day average. | all and each type | 3 |
| Readiness today | `readiness` | Today's verdict (go easy, normal, ready to push) from HRV status, sleep score, resting HR and the load ratio. The dashboard's own rule. | - | 2 |
| Fitness age | `fitnessAge` | Garmin fitness age against actual age, the achievable age, and, under Details, its components with Garmin's targets. | - | 1 |
| Period comparison | `periodComparison` | Sessions, distance, time and load of the window against the same number of weeks before it, per type and in total. | all and each type | 3 |
| Records | `records` | Best efforts, longest run and ride, heaviest set and the best estimated 1RM of each exercise in the window: 4 first, the others under Show all. | all and each type | 3 |
| Weekly volume | `weeklyVolume` | Time, distance, sessions or load of each week, stacked by type, with a 4-week average line. | all and each type | 2 |
| Intensity minutes | `intensityMinutes` | Moderate + 2 x vigorous minutes of the activities each week, against 150 minutes. | all and each type | 1 |
| Load safety | `loadSafety` | Weekly load with its change against the week before (flagged above +10%), and 7-day monotony and strain (Foster). | - | 3 |
| Consistency | `calendar` | A heatmap of the training minutes of each day; a day shows its activities on hover or touch. | all and each type | 3 |
| Load vs recovery | `loadVsRecovery` | Daily load by type (bars) with nightly HRV (line). | all and each type | 3 |
| HRV | `hrv` | Nightly HRV of the last 14 days with its 7-day average and the balanced range. | - | 1 |
| Resting HR | `restingHr` | Resting HR of the last 14 days. | - | 1 |
| Sleep | `sleep` | Sleep stages and sleep score of the last 14 nights. | - | 1 |
| Sleep need | `sleepNeed` | Sleep against the sleep need of the last 14 nights, with the average gap. | - | 1 |
| Bedtime | `bedtime` | Bedtimes of the last 14 nights and their spread. | - | 1 |
| Body battery | `bodyBattery` | Body battery high and low of the last 14 days. | - | 1 |
| Activities | `activities` | The activities of the window, 15 rows first; activities with laps open to show them. | all and each type | 3 |
| Coach notes | `coachNotes` | The coach notes that Claude writes for the data. | - | 3 |
| Summary | `typeKpis` | Sessions, time, distance with pace or speed, HR, Garmin load and its share, and the last 7 days against the 4-week average. | all and each type | 3 |
| Each week | `typeWeekly` | Time, distance or sessions of each week. | all and each type | 2 |
| Time in HR zones | `hrZones` | Minutes in HR zones 1-5 each week. | all and each type | 1 |
| Best efforts | `bestEfforts` | The fastest 1 km, mile, 5 km, 10 km, half marathon and marathon in the window. | running | 1 |
| Races | `races` | Each race with its time, pace, HR, power and aerobic training effect. | running | 2 |
| Aerobic fitness | `aerobicFitness` | Pace against HR of each run (older runs paler), and weekly pace and efficiency (metres per heartbeat). | running | 2 |
| Easy and hard running | `intensityShare` | The share of running time in Z1-2 (easy) and Z4-5 (hard) each week. | running | 1 |
| Running form | `runningForm` | Weekly cadence, ground contact, stride, vertical oscillation and ratio, and power, one small chart for each: cadence and ground contact first, the others under Show all. | running | 3 |
| Run Walk Run | `runWalk` | Run Walk Run sessions: the pace of the run segments, the overall pace and the walk time. | running | 1 |
| Training effect | `trainingEffect` | Aerobic and anaerobic training effect of each run, and the training effect labels of each week. | running | 2 |
| Race predictor | `racePredictor` | Predicted 5 km, 10 km, half marathon and marathon times (Riegel), from the best effort of 5 km or more. | running | 1 |
| Long runs and pace split | `longRuns` | The share of the longest run in each week's km (flagged above 35%), weekly ascent, and the pace split of races and long runs. | running | 2 |
| Sets per movement | `setsPerCategory` | Completed sets of each movement category each week. | strengthTraining | 2 |
| Muscle-group balance | `muscleBalance` | Average weekly sets of each muscle group against 10-20, and the push:pull ratio. | strengthTraining | 1 |
| Exercises | `exercises` | Each exercise by muscle group, with sort, search and group filter; a row opens its trend and its sessions. | strengthTraining | 3 |
| Sessions | `strengthSessions` | Each strength session with its exercises and sets in order, the last 6 first, the others under Show all. | strengthTraining | 3 |
| Pace and walks | `walkDetails` | Weekly pace and average HR, and steps, cadence and body battery change of each walk. | walking, hiking | 2 |
| Daily steps | `steps` | Daily steps against the goal, and floors, for the last 14 days. | - | 1 |
| Vertical speed | `hikeVertical` | Vertical metres per hour of each activity with ascent. | hiking, walking, running | 3 |
| Rides | `bikeDetails` | Weekly speed and ascent, each ride, and indoor against outdoor time. | cycling | 3 |
| Swims | `swimDetails` | Each swim with pace per 100 m, SWOLF, lengths, strokes and pool length. | swimming | 3 |
| Sessions and intensity | `racketDetails` | Each racket session: sport, HR, time in Z3+, Z4-5 share, calories per hour, training effect, and its load against a run of the same length. | racket, generic | 3 |

_Types_ are the types that the widget can show. A widget without types shows the same thing on
every board. _Width_ is the default width in columns.

## The preset of each board

| Board | Widgets, in order |
| ----- | ----------------- |
| all | `kpis`, `readiness`, `calendar`, `periodComparison`, `records`, `weeklyVolume`, `intensityMinutes`, `loadSafety`, `loadVsRecovery`, `activities`, `coachNotes` |
| running | `typeKpis`, `typeWeekly`, `hrZones`, `bestEfforts`, `races`, `aerobicFitness`, `intensityShare`, `runningForm`, `runWalk`, `trainingEffect`, `racePredictor`, `longRuns`, `activities` |
| strengthTraining | `typeKpis`, `typeWeekly`, `hrZones`, `setsPerCategory`, `muscleBalance`, `exercises`, `strengthSessions` |
| walking | `typeKpis`, `typeWeekly`, `hrZones`, `walkDetails`, `steps`, `activities` |
| hiking | `typeKpis`, `typeWeekly`, `hrZones`, `hikeVertical`, `activities` |
| cycling | `typeKpis`, `typeWeekly`, `hrZones`, `bikeDetails`, `activities` |
| swimming | `typeKpis`, `typeWeekly`, `hrZones`, `swimDetails`, `activities` |
| racket | `typeKpis`, `typeWeekly`, `hrZones`, `racketDetails`, `activities` |
| generic | `typeKpis`, `typeWeekly`, `hrZones`, `activities` |
