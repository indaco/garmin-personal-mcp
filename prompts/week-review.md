Review my last whole training week, as a coach. Use the tools of the `garmin-personal` MCP server.
Today is {{today}}. The last whole week starts on Monday `{{week}}`.

1. Call `writeDashboard` with `preview` = true. Do not give `weeks`: the server then uses the weeks
   of the dashboard page, so the numbers match the page. It writes nothing and returns the `digest`.
   Do not call `getDashboardData`: its whole result is too large for this check.

`digest.weekly` has one row for each week, keyed by its Monday. A week from `digest.period.start` on
without a row had no sessions: show it with 0 sessions, not as "n/a". A week before
`digest.period.start` has no data: leave it out of the table, and do not count it. If the week of
`{{week}}` is before `digest.period.start`, say that the page does not cover it, and stop. The rows
are not split by sport. Do not guess a split. A row with `partial` is not a whole week: say so if
you use it.

Then answer in chat, in this order, short:

- **The week**: a table with the week of `{{week}}` and the up to 4 weeks before it, newest first:
  sessions, hours, km, run km and load. A null `load` is "n/a". When `estimatedLoads` is more than
  0, say that some loads of that week are estimates from heart rate.
- **Against the weeks before**: how the week's load and hours compare with the mean of the weeks
  before it in the table, as a percent. Without an earlier week or with a null load, write "n/a".
  Then the page's load ramp of the week (`rampPct`): its load against the week before, in %. A
  ramp of more than 10% is the page's warning level: say so. A null `rampPct` is "n/a".
- **Now**: the load ratio of 7 to 28 days (`load.acuteToChronic`), the monotony and strain of the
  last 7 days (`load.monotony`, `load.strain`), and `fitnessFatigue.form` (below 0 you carry
  fatigue). A monotony above 2 is the page's flag: the days are too alike. Say that these describe
  today, not the reviewed week. A null value is "n/a". If `fitnessFatigue` is null, write "n/a".
- **New bests**: the run bests of the week of `{{week}}`: each entry of `recordProgression` with a
  date in that week, with the distance, the time and the `previous` time it beat. These are bests
  since `digest.period.start` only: an older, faster run can sit before that date, so name each one
  "best since" that date, never a personal record. A null `previous` means no earlier effort of
  that distance since that date, not a first ever. Without such an entry, write "none".
- **Strength plan**: the exercises hit and missed in the strength sessions of the week of
  `{{week}}`, from its key in `strengthPlan.weeks`. These count only the sessions done: a planned
  session that was skipped leaves no file and is not seen, so never read "all hit" as "every planned
  session done". Then the exercises that miss most in the page period (`strengthPlan.mostMissed`),
  each with its misses of its sessions and the reason (`sets`: too few sets, `reps`: reps under the
  plan); an empty list is "none". A week without a key is "no planned strength session", and a null
  week is "n/a" (sets not read). Without `strengthPlan`, write "no planned strength session" in one
  line.
- **Coach note**: 2 or 3 sentences: what the week did well, and what to change next week. Base each
  sentence on a number above. Do not mention the data or the sports that the `settings` of the
  reply exclude.

Every number comes from the tool result. **Never invent or estimate a missing value**: a missing
value or a failed call shows as "n/a". If a call fails, say which one and why in one line. Do not
create or change a dashboard.
