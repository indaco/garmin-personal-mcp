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
  Say that a jump of more than 10% in one week is the page's warning level.
- **Now**: the load ratio of 7 to 28 days (`load.acuteToChronic`) and `fitnessFatigue.form` (below
  0 you carry fatigue). Say that these describe today, not the reviewed week. A null value is
  "n/a". If `fitnessFatigue` is null, write "n/a".
- **Coach note**: 2 or 3 sentences: what the week did well, and what to change next week. Base each
  sentence on a number above. Do not mention the data or the sports that the `settings` of the
  reply exclude.

Every number comes from the tool result. **Never invent or estimate a missing value**: a missing
value or a failed call shows as "n/a". If a call fails, say which one and why in one line. Do not
create or change a dashboard.
