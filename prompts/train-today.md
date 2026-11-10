Tell me if I should train hard today, as a coach. Use the tools of the `garmin-personal` MCP server.
Today is {{today}}.

1. Call `writeDashboard` with `preview` = true. Do not give `weeks`: the server then uses the weeks
   of the dashboard page, so the numbers match the page. It writes no page file and returns the
   `digest`. Do not call `getDashboardData`: its whole result is too large for this check.

Then answer in chat, in this order, short:

- **Verdict**: `readiness.verdict`. "easy" is "Go easy", "normal" is "Normal", "push" is "Ready to
  push". If it is null, write "n/a": there is no HRV status and no sleep score. If the digest has no
  `readiness`, write "n/a" for the verdict and for each input: there is no HRV and no sleep data. Do
  not give your own verdict. Say that this is the dashboard's own rule, not Garmin's Training
  Readiness.
- **Why**: a table with one row for each input of `readiness`: the HRV status (`hrvStatus`), the
  sleep score (`sleepScore`), the resting HR (`rhr`) against the average of the 7 days before
  (`rhrAvg7`), and the load ratio of 7 to 28 days (`loadRatio`). Give its value and the rule that it
  meets:
  1. "easy" when the HRV status is LOW, or the sleep score is less than 60, or the resting HR is
     5 bpm or more above the 7-day average.
  2. Else "push" when the HRV status is BALANCED, the sleep score is 80 or more, and the load ratio
     is less than 1.3.
  3. Else "normal".
  The server applies these rules to the exact numbers: quote its verdict as it is. A null value is
  "n/a". When `hrvDate` or `recoveryDate` is not {{today}}, give that date: the value is from an
  older night. If `settings.exclude` has `recovery`, say that the dashboard leaves out the recovery
  data.
- **Fitness and form**: from `fitnessFatigue`: the fitness (the load average of about 42 days), the
  fatigue (about 7 days) and the form (the fitness minus the fatigue of the day before). Below 0 you
  carry fatigue; above 0 you are fresh. If `fitnessFatigue` is null, write "n/a". If
  `load.estimatedLoads` is more than 0, say that some loads are estimates from heart rate.
- **Coach note**: 1 or 2 sentences: what to do today. Base each sentence on a number above. Do not
  go against the verdict.

Every number comes from the tool result. **Never invent or estimate a missing value**: a missing
value or a failed call shows as "n/a". If a call fails, say which one and why in one line. Do not
create or change a dashboard.
