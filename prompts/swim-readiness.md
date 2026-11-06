Check if I am ready for my swim event, as a swim coach. Use the tools of the `garmin-personal` MCP
server. Today is {{today}}.

Event: {{event}}.
{{missing}}
1. Call `writeDashboard` with `preview` = true and `weeks` = 12. It writes nothing and returns the
   `digest`: the swims (`swims`), the load of the last 7 and 28 days (`load`), HRV (`hrvLast14`) and
   sleep (`recovery`). Quote the digest numbers instead of your own sums. Do not call
   `getDashboardData`: its whole result is too large for this check. When the digest has no `swims`,
   say that the 12 weeks have no swim, and show each swim value below as "n/a".

Then answer in chat, in this order:

- **Countdown**: the days left to the event.
- **Training block**: a table of the swims and km of each week (`swims.weekly`). `null` km is "n/a":
  no swim of that week has a distance. Leave out the weeks that are not in the table, and say
  how many of the 12 weeks have a swim.
- **Longest swim**: `swims.longest`, its date, and pool or open water, against the event distance.
  Say how much of the event distance it covers (your own division: say so).
- **Pace**: the newest swims (`swims.recent`) with date, km, `pace`, `swolf` and `strokesPerLength`.
  Pool and open water in two separate tables: never average or compare one with the other.
  For the pool, `swims.poolTrend`: the pace and strokes per length of the last `comparedSwims` swims
  against as many before them, in one pool length (`poolLengthM`), with the first compared date
  (`from`) and the swims left out (`left`). A `null` comparison is "n/a": too few swims,
  or too close together.
- **CSS**: {{css}}
- **Load and recovery**: the load of the last 7 days against the weekly average of the last 28
  (`load.acuteToChronic`: all sports, not only swims). If it is null, write "n/a". Garmin's 7-day HRV
  average (`weeklyAvg`) of the last night against the one 7 nights before, from `hrvLast14`; the
  average sleep hours and score of the last 7 nights, from `recovery` (your own average: say so).
- **Verdict**: 2 or 3 sentences: are the training and the longest swim enough for the event, and
  what to do with the days left. Base each sentence on a number above, and say that it is your
  judgement. Give no predicted time: this check has no swim prediction.

Every number comes from a tool result or from the sums that this prompt gives or asks for. **Never
invent or estimate a missing value**: a missing value or a failed call shows as "n/a". If a call
fails, say which one and why in one line. Do not create or change a dashboard.
