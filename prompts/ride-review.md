Review one of my rides as a cycling coach. Use the tools of the `garmin-personal` MCP server. Today
is {{today}}.

1. {{find}}
2. Call `getActivityLaps` and `getActivityWorkouts` with its `activityId`.
3. Call `listActivities` with `names` = [the ride's full name] and `endDate` = the ride's day
   (`getActivity` gives the name and the day when you have only the id). Its row of this ride is the
   summary. The earlier rides are the rows before this one with the same `type` and the same name,
   ignoring case. Same name does not prove the same route: leave out a ride whose `km` differs from
   this ride's by more than 10%, and say how many you left out.
4. Call `getSleep` with `date` = the day after the ride (the night after it), and `getHrvRange` with
   `fromDate` and `toDate` = that day. When that night has not come yet, skip both calls and show the
   recovery as "n/a".

The ride is a mountain-bike ride when its type is `mountain_biking`. Else it is a road ride. An
indoor ride (type `indoor_cycling` or `virtual_ride`) has no real ascent: show its ascent per hour as
"n/a".

Then answer in chat, in this order, short:

- **Summary**, from the `listActivities` row: date, name, road or mountain bike, distance, the
  moving time `duration` (and `elapsed` when the row has it), the speed in km/h (`km` / `duration`:
  your own division, say so; the row's `pace` is for foot sports, do not quote it), ascent `ascentM`,
  the ascent per hour (`ascentM` / `duration`: your own division), average and max HR, and the
  training effect with its label and the `trainingLoad`.
- **Power**: `avgPowerW` and `normPowerW` of the row. When the row has neither, write "n/a: the ride
  has no power data" in one line, and give no power, IF or TSS from heart rate or speed.
- **Trail**: for a mountain-bike ride, `grit` (how hard the trail was) and `flow` (how smoothly you
  rode it: lower is smoother). A missing value shows "n/a". Skip this part for a road ride.
- **Effort**: the share of `hrZonesSec` in Z1-2 and in Z4-5, in % of the sum of the 5 zones. Without
  `hrZonesSec`, write "n/a".
- **Plan against execution**: when `getActivityWorkouts` gives steps, a table with one row per lap
  that has a `step`: the step (its `intensity`, duration and target as `getActivityWorkouts` gives
  them) and what the lap did (`km`, `time`, `kmh`, `avgHR`, `avgPowerW`). A lap's `step` is the
  `stepIndex` of its plan step. Match by it, not in order. Give no hit or miss: the server judges no
  ride plan, so say in one line that the table shows the plan beside the laps. With an empty list,
  say "no planned workout" in one line.
- **Laps**: when the ride has 2 laps or more, a table with one row per lap: `km`, `time`, `kmh`,
  `avgHR`, `cadence`, `ascentM` and `avgPowerW`, "n/a" when a lap has no value. A lap's speed follows
  its climb: do not read a slower lap with more `ascentM` as a fade. With 1 lap, skip this part.
- **Same route**: the earlier rides of step 3, at most the 5 most recent: date, km, speed, ascent per
  hour, average HR, and `grit` and `flow` for a mountain-bike ride. Say how many rides you compared
  and the date of the oldest. Wind, weather and the trail surface change speed and HR on one route:
  say so in one line. Without an earlier ride, write "n/a: no earlier ride of this name".
- **Recovery**: the sleep score and hours of the night after the ride, and its HRV (`lastNightAvg`)
  against Garmin's 7-day average of that night (`weeklyAvg`).
  A `getSleep` row with only the `date` means that night has no sleep data: show its sleep as "n/a".
- **Coach note**: 2 or 3 sentences: what went well and what to change next time. Base each sentence
  on a number above. Compare speed, HR and ascent per hour only with the rides of **Same route**: a
  hillier route gives a lower speed and a higher ascent per hour at the same fitness.

Every number comes from a tool result or from the division that this prompt asks for. **Never invent
or estimate a missing value**: a missing value or a failed call shows as "n/a". If a call fails, say
which one and why in one line. Do not create or change a dashboard.
