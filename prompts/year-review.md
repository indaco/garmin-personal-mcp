Give me my year in review for {{year}}. Use the tools of the `garmin-personal` MCP server. Today is
{{today}}.

1. Call `getYearReview` with `year` = {{year}}{{path}}. When I name a dashboard page, also give it
   as `path`: its sports and its excluded data apply. It reads a local cache. When days are missing,
   it can ask me in a form before it fetches them. Call no other tool, also not for a missing day.
   If the call fails, say why in one line. If it refuses the `path`, also say which `path` you sent,
   that text that is not a year is read as the page, and what this command takes: a year, the
   `.html` file of a dashboard page, or both. Then ask me to correct it and stop: until I do, do not
   call it again without the `path` or with another `path`.

The reply has `year`, `fill`, `lastDayOpen` and `settings`. A field below without one of these names
before it is a field of `year`.

Then answer in chat, in this order, short:

- **The year**: the first line. When `coverage.complete` is true, name `year.year` and its days,
  `from` to `to`. Else name `year.year`, say that the recap covers the days from
  `coverage.activities.from` to `coverage.activities.to` only, and write "n/a (not in the cache)"
  for each range of `coverage.missing`. When `coverage.activities` is null, say instead that the
  cache has no day of this year, and write only the parts Missing days and HRV and resting HR: a 0
  in the other parts is not a known value.
- **Missing days**: one line from `fill.asked`. `notNeeded`: no line. `yes`: the activity list was
  fetched, with `fill.garminCalls` requests. With a `fill.error`, say instead that the fetch failed,
  that no activities were saved, and give the `fill.error`. `no`: "nothing was fetched (you said
  no)". `unasked`, for each range of `coverage.missing`: "n/a from A to B: the assistant cannot show
  the confirm form, so nothing was fetched". `tooLarge`, for each range: "n/a from A to B: the fetch
  needs about N requests, which is too many, so nothing was fetched", where N is `fill.estimate`.
  With `tooLarge`, when `year.year` is before the year of today, also tell me to review a newer year
  first, then this one, and that this works only when the assistant can show the confirm form. Offer
  no other way to fetch these days.
- **Last day**: only when `lastDayOpen` is true, and `fill.asked` is not `yes` or there is a
  `fill.error`. Say that `coverage.activities.to`, the last day in the cache, can lack a session
  that came to Garmin after the last update of the cache. When `fill.asked` is `notNeeded` and the
  year is the year of today, also say that a dashboard update adds it.
- **Totals**: from `totals`: the sessions (`activities`), `activeDays`, `km`, `hours`, `ascentM` in
  metres, `calories` and `load`. When `estimatedLoads` is more than 0, say how many of the loads are
  estimates from heart rate. When `unlikelyTimes` is more than 0, say how many sessions have a time
  that is not likely (over 12 h at under 1 km/h), and that this time and a load estimate from it do
  not count.
- **Sports**: a table of `sports` in the given order: `sport`, `sessions`, `km`, `hours` and `load`.
  Then `topSport`, the sport with the most hours. When `hours` is null in each row, it is the sport
  with the most sessions: say so.
- **Months**: a table of `months`: `month`, `sessions`, `activeDays`, `km`, `hours` and `load`. A
  month with `covered` = "none" is "n/a (not in the cache)" in each column. With "part", say that
  the month counts only its `days` days in the cache.
- **Highlights**: `biggestMonth`, `biggestWeek` (its `monday`) and `bestBlock` (the best 4 weeks in
  a row: `from`, `to`, `sessions` and `value`). When `measure` is "load", they compare the load.
  When it is "hours", no session has a load: say it, and that they compare the hours. The weeks go
  from Monday to Sunday. A week counts only when all its 7 days are in the year and in the cache.
  Then `mostConsistentMonth`: `activeDays` of its `days` days, `sharePct` %. A month needs 14 days
  in the cache for this.
- **Streaks**: `streaks.days`, the most days in a row with a session, and `streaks.weeks`, the most
  weeks in a row with a session: the `length`, `from` and `to` of each. A day that is not in the
  cache ends a streak.
- **Sessions**: `longest` (`hours` and `km`) and `biggest` (`load`), each with its `date`, its
  `sport`, and its `name` when it has one. When `estimate` is true, say that this load is an
  estimate from heart rate.
- **Records**: from `records`, for each distance the runs that set a new best, in the given order:
  `date`, `time`, and the time that it beat (`previous`). A null `previous` is "first of the year".
  Say that these are the bests of the year in the cache, not all-time records. When
  `settings.sports` is a list without "running", leave this part out. Else an empty `records` is
  "n/a (no best effort)".
- **Rhythm**: from `rhythm`: the sessions of each weekday (`weekdays`, Monday first) and the top one
  (`topWeekday`, where 0 is Monday), and the sessions of each part of the day (`timeOfDay`: night
  22:00-4:59, morning 5:00-11:59, afternoon 12:00-17:59, evening 18:00-21:59) and the top one
  (`topTimeOfDay`).
- **HRV and resting HR**: one table by month: the `mean` of `hrv` in ms with its `nights`, and the
  `mean` of `rhr` in bpm with its `days`. A null `mean` is "n/a (N nights; a mean needs 7)" or "n/a
  (N days; a mean needs 7)": give the number. A month without a row is "n/a". When
  `settings.exclude` has "recovery", leave this part out. Else a missing `hrv` or `rhr` is "n/a (not
  in the cache)".

Every number comes from the tool result: do not compute one. **Never invent or estimate a missing
value**: a null or missing value shows as "n/a", never as 0. Do not mention the data or the sports
that the `settings` of the reply exclude, also when this chat holds them, and also where a rule
above names a missing value. Do not create or change a dashboard.
