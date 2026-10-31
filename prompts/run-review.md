Review one of my runs as a running coach. Use the tools of the `garmin-personal` MCP server. Today is
{{today}}.

1. {{find}}
2. Call `getActivity`, `getActivityLaps` and `getActivityWorkouts` with its `activityId`.
3. Call `getSleep` with `date` = the day after the run (the night after it), and `getHrvRange` with
   `fromDate` and `toDate` = that day. When that night has not come yet, skip both calls and show the
   recovery as "n/a".

The run is intervals when its laps mark a warm-up, rest, recovery or cool-down (`intensity`). A free
run is steady even when the watch marks its auto laps `interval`.

Then answer in chat, in this order, short:

- **Summary**: date, name, distance, time, pace, average HR, and the training effect with its label.
- **Plan against execution**: when the run followed a planned workout, a table with one row per
  step: the target (pace, HR or cadence, low to high), what the matching lap did, and hit or miss.
  Match the steps to the laps in order, without the laps under 20 m or under 8 s: the watch adds
  them between steps. Without a planned workout, say so in one line.
- **Reps**: for intervals, each active lap of 20 m and 8 s or more, with its pace, HR and running
  form (ground contact `gctMs`, vertical ratio `vertRatioPct`, when the laps have them). A shorter
  lap is a lap that the watch adds between steps. Also the fade: the last rep against the first of
  the same workout step (`step`), in %. Give the fade for each step with more than one rep, only
  when those reps have the same distance or time. Skip this part for a steady run.
- **HR drift**: for a steady run, the distance per heartbeat of the first half against the second
  half, from the laps, in %. The halves split at half the distance: a lap across the middle counts
  for its share of distance on each side. Under 5% shows a solid aerobic base. Skip this part for
  intervals.
- **Recovery**: the sleep score and hours of the night after the run, and its HRV (`lastNightAvg`)
  against Garmin's 7-day average of that night (`weeklyAvg`).
  A `getSleep` row with only the `date` means that night has no sleep data: show its sleep as "n/a".
- **Coach note**: 2 or 3 sentences: what went well and what to change next time. Base each sentence
  on a number above.

Every number comes from a tool result. **Never invent or estimate a missing value**: a missing value
or a failed call shows as "n/a". If a call fails, say which one and why in one line. Do not create or
change a dashboard.
