Check if I am ready for my race, as a running coach. Use the tools of the `garmin-personal` MCP
server. Today is {{today}}.

Race: {{race}}.
{{missing}}
1. Call `writeDashboard` with `preview` = true and `weeks` = 12. It writes nothing and returns the
   `digest`: the weekly km and load, the load of the last 7 and 28 days, best efforts, races, HRV
   (`hrvLast14`) and sleep (`recovery`). Quote the digest numbers instead of your own sums. Do not call
   `getDashboardData`: its whole result is too large for this check.
2. Call `listActivities` with `startDate` = {{startDate}} and `limit` = 100. From its runs (a type
   that ends in `running`) take the longest run, and call `getActivityLaps` for each run over 15 km.

Then answer in chat, in this order:

- **Countdown**: the days left to the race.
- **Training block**: a table of the run km (`weekly.<monday>.runKm`) and the load of each week (the
  first week can be partial: say so); the longest run and its date; for the runs over 15 km, the pace
  of the first and the second half and the HR drift (the drop in distance per heartbeat from the
  first to the second half, in %). From the laps: leave out the warm-up, cool-down, rest and recovery
  laps, take the distance of a lap as its time / pace (the lap km is rounded to 10 m), and split at
  half the distance (a lap across the middle counts for its share on each side).
- **Load and taper**: the load of the last 7 days against the weekly average of the last 28
  (`load.acuteToChronic`). In the last 2 weeks before a race the load should drop: say if it does, or
  how to use the days left.
- **Prediction**: the predicted race time from each best effort of 5 km or more, with Riegel
  (time × (race distance / effort distance)^1.06; 5k = 5 km, 10k = 10 km, half = 21.0975 km,
  marathon = 42.195 km). The estimate is the fastest of them; show the others too. {{goalLine}}
- **Recovery**: Garmin's 7-day HRV average (`weeklyAvg`) of the last night against the one 7 nights
  before, from `hrvLast14`; the average sleep hours and score of the last 7 nights, from `recovery`
  (your own average: say so).
- **Race plan**: the target pace for each quarter of the race, for an even or slightly negative
  split, {{planFrom}}.

Every number comes from a tool result, from the Riegel formula above or from the averages that this
prompt asks for. **Never invent or estimate a
missing value**: a missing value or a failed call shows as "n/a". If a call fails, say which one and
why in one line. Do not create or change a dashboard.
