Review one of my runs as a running coach. Use the tools of the `garmin-personal` MCP server. Today is
{{today}}.

1. {{find}}
2. Call `getActivity`, `getActivityLaps` and `getActivityWorkouts` with its `activityId`.
3. Call `getSleep` with `date` = the day after the run (the night after it), and `getHrvRange` with
   `fromDate` and `toDate` = that day. When that night has not come yet, skip both calls and show the
   recovery as "n/a".

The run is intervals when the `getActivityLaps` answer has `work`. Else it is steady.

Then answer in chat, in this order, short:

- **Summary**: date, name, distance, time, pace, average HR, and the training effect with its label.
- **Plan against execution**: when the run followed a planned workout, a table with one row per
  lap whose step has a target (not OPEN): the step, its target (pace, HR or cadence, low to high),
  what the lap did, and hit or miss. A lap's `step` is the `stepIndex` of its plan step. Match by
  it, not in order: auto-lap splits a long step into several laps, and each rep of a repeat is its
  own lap with the same `step`. Leave out the laps without a `step`. When no step has a target, say
  so in one line. Without a planned workout, say so in one line.
- **Reps**: for intervals, each active lap of 20 m and 8 s or more, with its pace, HR and running
  form (ground contact `gctMs`, vertical ratio `vertRatioPct`, when the laps have them). A shorter
  lap is a lap that the watch adds between steps. Also the fade of each step from `work.fade`: `pct`
  is the last rep against the first, in %. When `pct` is null, the reps are not alike: write "n/a".
  Skip this part for a steady run.
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
