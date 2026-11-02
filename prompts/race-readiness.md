Check if I am ready for my race, as a running coach. Use the tools of the `garmin-personal` MCP
server. Today is {{today}}.

Race: {{race}}.
{{missing}}
1. Call `writeDashboard` with `preview` = true and `weeks` = 12. It writes nothing and returns the
   `digest`: the weekly km and load, the load of the last 7 and 28 days, best efforts, races, the long
   runs and races with their split and HR drift (`longRuns`), the longest run (`longestRun`), the race
   predictions (`racePredictions`), HRV (`hrvLast14`) and sleep (`recovery`). Quote the digest numbers
   instead of your own sums. Do not call `getDashboardData`: its whole result is too large for this
   check.

Then answer in chat, in this order:

- **Countdown**: the days left to the race.
- **Training block**: a table of the run km (`weekly.<monday>.runKm`) and the load of each week. The
  first week can be partial (`partial: true`): say so. Also the longest run and its date
  (`longestRun`). For each long run (`longRuns`): the pace of the first and the second half, the
  split, and the HR drift. An HR drift of 5% or less shows a solid aerobic base. `null` is n/a: for
  example, a lap without heart rate.
- **Load and taper**: the load of the last 7 days against the weekly average of the last 28
  (`load.acuteToChronic`). If it is null, write "n/a": the data has fewer than 28 days, or no
  load. In the last 2 weeks before a race the load should drop: say if it does, or how to use the
  days left.
- **Prediction**: the predicted race times of `racePredictions`. The first row is the estimate;
  show the others too. {{goalLine}}
- **Recovery**: Garmin's 7-day HRV average (`weeklyAvg`) of the last night against the one 7 nights
  before, from `hrvLast14`; the average sleep hours and score of the last 7 nights, from `recovery`
  (your own average: say so).
- **Race plan**: the target pace for each quarter of the race, for an even or slightly negative
  split, {{planFrom}}.

Every number comes from a tool result or from the averages that this prompt asks for. **Never
invent or estimate a missing value**: a missing value or a failed call shows as "n/a". If a call
fails, say which one and why in one line. Do not create or change a dashboard.
