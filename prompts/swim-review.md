Review one of my swims as a swim coach. Use the tools of the `garmin-personal` MCP server. Today is
{{today}}.

1. {{find}}
2. Call `getActivity`, `getActivityLaps` and `getActivityWorkouts` with its `activityId`.
3. Call `getSleep` with `date` = the day after the swim (the night after it), and `getHrvRange` with
   `fromDate` and `toDate` = that day. When that night has not come yet, skip both calls and show the
   recovery as "n/a".

The swim is open water when its type contains `open_water`. Else it is a pool swim.

Then answer in chat, in this order, short:

- **Summary**: date, name, pool or open water, the pool length of a pool swim, distance, time, the
  pace per 100 m (time / distance: your own division, say so), SWOLF, average HR, and the training
  effect with its label.
- **Plan against execution**: when `getActivityWorkouts` gives steps, a table with one row per lap
  that has a `step`: the step (its `intensity`, duration and target as `getActivityWorkouts` gives
  them) and what the lap did (`metres`, `time`, `swimPace`). A lap's `step` is the `stepIndex` of its
  plan step. Match by it, not in order. Give no hit or miss: the server judges no swim plan, so say
  in one line that the table shows the plan beside the laps. With an empty list, say "no planned
  workout" in one line.
- **Intervals**: for a pool swim, a table with one row per lap with `metres` above 0: `metres`,
  `stroke`, `swimPace`, `swolf`, `strokes`, and the rest after it. A lap with `metres` 0 or `intensity`
  `rest` is a rest: its `time` is the rest of the lap before it. When no lap is a rest, write the rest
  as "n/a". For open water, skip this part: its laps are not repeats.
- **Set fade**: for a pool swim, each row of `sets`: `reps` x `metres`, `stroke`, `firstPace`,
  `lastPace`, `firstSwolf`, `lastSwolf` and `pct`, the last repeat's pace against the first in %: above 0
  is slower. `null` is "n/a". With an empty `sets`, say in one line that the swim has no repeated
  set. Read SWOLF together with pace: a lower SWOLF with a slower pace can be gliding, not better
  technique. Compare SWOLF only within this swim: it changes with the pool length and the swimmer.
  For open water, skip this part.
- **Recovery**: the sleep score and hours of the night after the swim, and its HRV (`lastNightAvg`)
  against Garmin's 7-day average of that night (`weeklyAvg`).
  A `getSleep` row with only the `date` means that night has no sleep data: show its sleep as "n/a".
- **Coach note**: 2 or 3 sentences: what went well and what to change next time. Base each sentence
  on a number above. Do not judge the swim on heart rate alone: use pace, SWOLF and strokes with it.

Every number comes from a tool result or from the division that this prompt asks for. **Never invent
or estimate a missing value**: a missing value or a failed call shows as "n/a". If a call fails, say
which one and why in one line. Do not create or change a dashboard.
