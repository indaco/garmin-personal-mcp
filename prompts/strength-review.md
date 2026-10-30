Review one of my strength sessions as a strength coach. Use the tools of the `garmin-personal` MCP
server. Today is {{today}}.

1. {{find}}
2. Call `getActivitySets` and `getActivityWorkouts` with its `activityId`.
3. Call `listActivities` with `names` = [the session's name] and `limit` = 100 (`getActivity` gives
   the name when you have only the id). Its row of this session is the summary. The previous session
   is the most recent strength session of the same name before this one: call `getActivitySets` with
   its `activityId`. Without one, show the comparison as "n/a".
4. Call `getSleep` with `date` = the day after the session (the night after it), and `getHrvRange`
   with `fromDate` and `toDate` = that day. When that night has not come yet, skip both calls and show
   the recovery as "n/a".

A set with 0 reps was not done: leave it out of every count. The estimated 1RM (e1RM) of a set is
kg × (1 + reps / 30), for sets of 1 to 12 reps with weight only; say that it is an estimate.

Then answer in chat, in this order, short:

- **Summary**, from the `listActivities` row: date, name, the session time (`elapsed` when the row
  has it, else `duration`), average and max HR (`avgHR`, `maxHR`), training load (`trainingLoad`),
  and the aerobic and anaerobic training effect (`aerobicTE`, `anaerobicTE`) with its label
  (`teLabel`).
- **Plan against execution**: when the session followed a planned workout, a table with one row per
  planned exercise, in plan order: the planned sets and reps, the done sets and reps, and hit or miss.
  Match a planned step to the done exercise by `exerciseName` (`BARBELL_BACK_SQUAT` is "Barbell Back
  Squat", case ignored), or by `exerciseCategory` when the step has no `exerciseName`. The planned
  sets of an exercise are its `ACTIVE` steps times the repeats of the `REPEAT_UNTIL_STEPS_CMPLT` step
  around them. A step with `durationType` REPS plans `durationValue` reps; a step with `targetType`
  REPS plans `targetValueLow` to `targetValue` reps, and when `targetValue` is 0 or under it, at
  least `targetValueLow` reps; any other step has no planned reps: show "n/a". The plan has no
  weights: do not show a planned weight. List a done exercise that matches a `WARMUP` or `COOLDOWN`
  step as the warm-up or cool-down, without hit or miss, and one that the plan does not have as "not
  in the plan". When the done sets have no reps (timed sets), judge the sets only and show the reps
  as "n/a". The warm-up and cool-down stay out of Sets and Rest. Without a planned workout, say so in
  one line.
- **Sets**: for each exercise, the top set (the heaviest set of 1 to 12 reps, then the most reps;
  the heaviest set when none has 1 to 12 reps) and its e1RM, and the same for the previous session
  when it has that exercise, with the change in %. For an exercise without weight, the most reps in
  a set; for a timed one, the longest set in seconds, without a change: its time follows the lap
  button or the plan, not strength. The rep drop: the reps of the last set against the first set at
  the same weight, when the exercise has 2 or more of them. A rest-pause or cluster group is a
  repeat block whose rest inside it is 20 s or less or OPEN, with a longer rest step right after the
  block. A drop inside a group is the plan: compare only the first set of each group.
- **Rest**: for each exercise, the median `restSec` of its done sets against its planned rest (the
  `REST` steps with `durationType` TIME after its sets, in seconds; an OPEN rest step has no planned
  time). When an exercise has more than one planned rest (a short one inside a rest-pause group and
  a longer one between groups), compare each with the rests after the sets it follows. Two exercises
  in one repeat block with one rest step after the second, inside the block, are a superset: the
  first one has no rest of its own, so show "n/a (superset)" for it. Without a plan, the median
  rest only.
- **Recovery**: the sleep score and hours of the night after the session, and its HRV
  (`lastNightAvg`) against Garmin's 7-day average of that night (`weeklyAvg`).
- **Coach note**: 2 or 3 sentences: what went well and what to change next time (a load to raise, a
  rest to cut or stretch). Base each sentence on a number above.

Every number comes from a tool result. **Never invent or estimate a missing value**, apart from the
e1RM that this prompt defines: a missing value or a failed call shows as "n/a". If a call fails, say
which one and why in one line. Do not create or change a dashboard.
