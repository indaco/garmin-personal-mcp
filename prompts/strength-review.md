Review one of my strength sessions as a strength coach. Use the tools of the `garmin-personal` MCP
server. Today is {{today}}.

1. {{find}}
2. Call `getActivitySets` and `getActivityWorkouts` with its `activityId`.
3. When step 1 called `listActivities` with `names`, use its rows; otherwise call `listActivities`
   with `names` = [the session's name] and `limit` = 100 (`getActivity` gives the name when you have
   only the id). Its row of this session is the summary. The previous session is the most recent
   strength session of the same name before this one: call `getActivitySets` with its `activityId`.
   Without one, show the comparison as "n/a".
4. Call `getSleep` with `date` = the day after the session (the night after it), and `getHrvRange`
   with `fromDate` and `toDate` = that day. When that night has not come yet, skip both calls and show
   the recovery as "n/a".

A set with 0 reps was not done: leave it and its `restSec` out of every count and median. The e1RM
is an estimate: say so.

Then answer in chat, in this order, short:

- **Summary**, from the `listActivities` row: date, name, the session time (`elapsed` when the row
  has it, else `duration`), average and max HR (`avgHR`, `maxHR`), training load (`trainingLoad`),
  and the aerobic and anaerobic training effect (`aerobicTE`, `anaerobicTE`) with its label
  (`teLabel`).
- **Plan against execution**: when `plan` of `getActivitySets` is not null, a table with one
  row per row of `plan.exercises`, in its order: the exercise, the planned sets and reps
  (`plannedSets`, `plannedReps` from `low` to `high`; `high` null is "at least `low`"), the done
  sets and reps (`doneSets`, `reps`), and the `verdict` (hit or miss) with its `why` (`sets`,
  `reps`). Add `extra` (done sets above the plan) and `over` (done sets above the high end) when
  they are not 0. Show a row with `part` as the warm-up or cool-down and a row with `notInPlan` as
  "not in the plan", both without hit or miss. The plan has no weights: do not show a planned
  weight. A null value shows as "n/a". The warm-up and cool-down stay out of Sets and Rest. When
  `plan` is null, say "no planned workout" in one line.
- **Sets**: for each exercise, the top set (`top`) and the e1RM (`e1rmKg`: the best estimate of its
  sets of 1 to 12 reps) of `getActivitySets`. Give the same for the previous session when it has
  that exercise, with the change in %. When `e1rmKg` is null, show "n/a" and give the change in % of
  the top set's weight. When the previous session has the exercise in another form (timed sets
  against sets with reps, or sets without weight against sets with weight), show its comparison as
  "n/a". For an exercise without weight, the most
  reps in a set; for a timed one, the longest set in seconds, without a change: its time follows the
  lap button or the plan, not strength. The rep drop: the reps of the last set against the first set
  at the same weight, when the exercise has 2 or more of them. A rest-pause or cluster group is a
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
  A `getSleep` row with only the `date` means that night has no sleep data: show its sleep as "n/a".
- **Coach note**: 2 or 3 sentences: what went well and what to change next time (a load to raise, a
  rest to cut or stretch). Base each sentence on a number above.

Every number comes from a tool result. **Never invent or estimate a missing value**: a missing value
or a failed call shows as "n/a". If a call fails, say which one and why in one line. Do not create
or change a dashboard.
