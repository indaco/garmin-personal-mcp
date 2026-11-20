Review my last {{weeks}} whole training weeks as one block, as a coach. Use the tools of the
`garmin-personal` MCP server. Today is {{today}}. The block starts on Monday `{{first}}`, and its
last week starts on Monday `{{last}}`.

1. Call `writeDashboard` with `preview` = true and `weeks` = {{weeks}}. It writes no page file and
   returns the `digest`. Do not call `getDashboardData`: its whole result is too large for this
   check.

`digest.weekly` has one row for each week, keyed by its Monday. The block is the rows from
`{{first}}` to `{{last}}`. The week in progress is not in the block: do not use its row. A Monday
of the block from `digest.period.start` on without a row had no sessions: show it with 0 sessions,
not as "n/a". A Monday before `digest.period.start` has no data: leave it out, say how many whole
weeks the block has, and go on with those. With fewer than 4 whole weeks, say so and stop.

Then answer in chat, in this order, short:

- **The block**: a table with one row for each week of the block, oldest first: sessions, hours,
  km, load, the load ramp (`rampPct`), `monotony`, `strain`, and the easy and hard share in % of
  runs (`runEasyPct`, `runHardPct`) and of rides (`rideEasyPct`, `rideHardPct`). A null value is
  "n/a". When `runEasyPct` or `rideEasyPct` is missing or null in every row of the block, leave
  out the columns of that sport and say so in one line. When `estimatedLoads` is more than 0, say
  that some loads of that week are estimates from heart rate.
- **Load**: the weeks with a `rampPct` above 10 and the weeks with a `monotony` above 2: these are
  the page's flags. Without such a week, write "none". Then the `strain` of the first and the last
  week of the block, as given. A low `monotony` in a week with 1 or 2 sessions does not make it a
  good week: say that the week has few sessions.
- **Intensity**: the easy and hard share of the first and the last week of the block, runs and
  rides apart. When `runIntensityApproximate` is true, say that some runs count in the zone of
  their average HR. When `rideIntensityApproximate` is true, say the same of the rides.
- **Aerobic**: from `blockEfficiency`. For runs (`blockEfficiency.runs`): the metres per heartbeat
  of the runs below zone 4, `last` against `first`, over `comparedWeeks` weeks at each end of the
  block, and the change in % (`changePct`). For rides (`blockEfficiency.rides`): the normalized
  power per heartbeat of the rides below zone 4, in W per bpm, in the same way. A higher value is
  more for each heartbeat. Say that this counts the whole weeks of the block only, and that the
  aerobic efficiency tile of the page also counts this week. A null `first` or `last` is "n/a". A
  null `changePct` is "n/a (F and L sessions at the two ends; the change needs 3 at each end)",
  where F and L are `firstRuns` and `lastRuns`, or `firstRides` and `lastRides`: give the numbers,
  and say that a longer block has more sessions. A `ridesWithPower` of 0 is "n/a (no ride with
  power: the ride trend needs a power meter)" for all the ride values. When only one of `runs` and
  `rides` is there, the other sport has no session in the page period: write "n/a (no runs)" or
  "n/a (no rides)". Without `blockEfficiency`: when a row of the block has the key `runEasyPct` or
  `rideEasyPct`, also with a null value, the page has no HR zones: write "n/a (no HR zones)" for
  both. Else write "n/a" for both.
- **Coach note**: 2 or 3 sentences: what the block built, and what the next block changes. Base
  each sentence on a number above.

Every number comes from the tool result. **Never invent or estimate a missing value**: a missing
value or a failed call shows as "n/a". If a call fails, say which one and why in one line. Do not
mention the data or the sports that the `settings` of the reply exclude, also where a rule above
names a missing value. Do not create or change a dashboard.
