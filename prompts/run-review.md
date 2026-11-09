Review one of my runs as a running coach. Use the tools of the `garmin-personal` MCP server. Today is
{{today}}.

1. {{find}}
2. Call `getActivity` and `getActivityLaps` with its `activityId`.
3. Call `getSleep` with `date` = the day after the run (the night after it), and `getHrvRange` with
   `fromDate` and `toDate` = that day. When that night has not come yet, skip both calls and show the
   recovery as "n/a".

The run is intervals when the `getActivityLaps` answer has `work`. Else it is steady.

Then answer in chat, in this order, short:

- **Summary**: date, name, distance, time, pace, average HR, and the training effect with its label.
- **Plan against execution**: when `plan` of `getActivityLaps` is not null, a table with one row
  per row of `plan.laps`, in lap order: the lap, its `step`, the target (`type`, `low` to `high` in
  its `unit`, or its `zone`), what the lap did (`done`), and the `verdict` (hit or miss) with `off`
  (how far outside the target, in its unit; for a pace, above 0 is slower). Quote the verdict: do
  not judge a lap yourself. A row with a null `verdict` has no hit or miss, and a row with a null
  `target` has no target. A null value shows as "n/a". When `plan` is null, say "no planned
  workout" in one line.
- **Reps**: for intervals, each active lap of 20 m and 8 s or more, with its pace, HR and running
  form (ground contact `gctMs`, vertical ratio `vertRatioPct`, when the laps have them). A shorter
  lap is not a rep: for example an open step of the workout that ends when you press lap. Also the
  fade of each step from `work.fade`: `pct` is the last rep against the first, in %. When `pct` is
  null, the reps are not alike: write "n/a". Skip this part for a steady run.
- **HR drift**: for a steady run, `split.hrDriftPct`: the drop in distance per heartbeat from the
  first half to the second, in %. 5% or less shows a solid aerobic base. When it is null, a lap has
  no heart rate: write "n/a". When `split` is null, the run has fewer than 2 laps: write "n/a" too.
  Skip this part for intervals.
- **Recovery**: the sleep score and hours of the night after the run, and its HRV (`lastNightAvg`)
  against Garmin's 7-day average of that night (`weeklyAvg`).
  A `getSleep` row with only the `date` means that night has no sleep data: show its sleep as "n/a".
- **Coach note**: 2 or 3 sentences: what went well and what to change next time. Base each sentence
  on a number above.

Every number comes from a tool result. **Never invent or estimate a missing value**: a missing value
or a failed call shows as "n/a". If a call fails, say which one and why in one line. Do not create or
change a dashboard.
