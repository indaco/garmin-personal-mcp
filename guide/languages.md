# Languages

The dashboard has English and Italian built in. You can add any language, and you can change the
built-in texts.

## Add a language through Claude

Run the `dashboard-language` prompt. Give the language, for example "German". Without a language,
Claude uses the language of the conversation. Claude:

1. gets the English texts from the `editDashboard` tool.
2. translates them. Each `{placeholder}` stays as it is.
3. saves them in the page with `editDashboard`.

Reload the page. The **Language** menu shows the language by its own name, for example _Deutsch_.
A text without a translation shows in English.

The server accepts only the keys of the English texts, with the same placeholders. After a server
update with new texts, the update prompt tells Claude which texts are missing.

To change one text of a built-in language, ask Claude. For example: "In Italian, call the readiness
widget _Forma di oggi_".

## Add a built-in language

A built-in language is in every page. To add one:

1. Copy `src/page/i18n/it.ts` to `src/page/i18n/<code>.ts`, for example `de.ts`.
2. Translate every text. Keep each `{placeholder}`. A text with `|` has a singular and a plural
   form: keep the `|`.
3. Add the catalogue and the name of the language in `src/page/i18n.ts`.
4. Run `pnpm test`. The tests make sure that the new language has every key and every placeholder.

## The texts

<!-- keys:start -->
| Key | English text |
| --- | ------------ |
| `title` | Training + Recovery |
| `na` | n/a |
| `noData` | This page has no data yet. Ask Claude to write the dashboard. |
| `period` | {from} to {to} |
| `inProgress` | * week in progress |
| `menu.settings` | Settings |
| `menu.theme` | Theme |
| `footer.links` | Project links |
| `footer.source` | Source on GitHub |
| `footer.issues` | Report an issue |
| `footer.releases` | Releases |
| `footer.license` | MIT License |
| `menu.language` | Language |
| `lang.auto` | Auto |
| `themeGroup.auto` | Auto |
| `themeGroup.dark` | Dark |
| `themeGroup.light` | Light |
| `themeGroup.accessible` | Accessible |
| `theme.system` | System |
| `theme.midnight` | Midnight |
| `theme.graphite` | Graphite |
| `theme.ocean` | Ocean |
| `theme.forest` | Forest |
| `theme.plum` | Plum |
| `theme.light` | Light |
| `theme.paper` | Paper |
| `theme.mist` | Mist |
| `theme.hcDark` | High contrast dark |
| `theme.hcLight` | High contrast light |
| `window.label` | Weeks |
| `window.last` | Last {n} |
| `window.all` | All |
| `window.from` | From week |
| `window.to` | To week |
| `type.all` | All |
| `type.recovery` | Recovery |
| `type.running` | Run |
| `type.strengthTraining` | Strength |
| `type.walking` | Walk |
| `type.hiking` | Hike |
| `type.cycling` | Bike |
| `type.swimming` | Swim |
| `type.racket` | Racket sports |
| `type.generic` | Other |
| `type.transition` | Transition |
| `type.fitnessEquipment` | Fitness equipment |
| `type.basketball` | Basketball |
| `type.soccer` | Soccer |
| `type.tennis` | Tennis |
| `type.americanFootball` | American football |
| `type.training` | Training |
| `type.crossCountrySkiing` | Cross-country skiing |
| `type.alpineSkiing` | Alpine skiing |
| `type.snowboarding` | Snowboarding |
| `type.rowing` | Rowing |
| `type.mountaineering` | Mountaineering |
| `type.multisport` | Multisport |
| `type.paddling` | Paddling |
| `type.flying` | Flying |
| `type.eBiking` | E-bike |
| `type.motorcycling` | Motorcycling |
| `type.boating` | Boating |
| `type.driving` | Driving |
| `type.golf` | Golf |
| `type.hangGliding` | Hang gliding |
| `type.horsebackRiding` | Horseback riding |
| `type.hunting` | Hunting |
| `type.fishing` | Fishing |
| `type.inlineSkating` | Inline skating |
| `type.rockClimbing` | Rock climbing |
| `type.sailing` | Sailing |
| `type.iceSkating` | Ice skating |
| `type.skyDiving` | Skydiving |
| `type.snowshoeing` | Snowshoeing |
| `type.snowmobiling` | Snowmobiling |
| `type.standUpPaddleboarding` | Stand-up paddleboarding |
| `type.surfing` | Surfing |
| `type.wakeboarding` | Wakeboarding |
| `type.waterSkiing` | Water skiing |
| `type.kayaking` | Kayaking |
| `type.rafting` | Rafting |
| `type.windsurfing` | Windsurfing |
| `type.kitesurfing` | Kitesurfing |
| `type.tactical` | Tactical |
| `type.jumpmaster` | Jumpmaster |
| `type.boxing` | Boxing |
| `type.floorClimbing` | Floor climbing |
| `type.baseball` | Baseball |
| `type.diving` | Diving |
| `type.shooting` | Shooting |
| `type.winterSport` | Winter sports |
| `type.grinding` | Grinding |
| `type.hiit` | HIIT |
| `type.videoGaming` | Video gaming |
| `type.wheelchairPushWalk` | Wheelchair push walk |
| `type.wheelchairPushRun` | Wheelchair push run |
| `type.meditation` | Meditation |
| `type.paraSport` | Para sport |
| `type.discGolf` | Disc golf |
| `type.teamSport` | Team sports |
| `type.cricket` | Cricket |
| `type.rugby` | Rugby |
| `type.hockey` | Hockey |
| `type.lacrosse` | Lacrosse |
| `type.volleyball` | Volleyball |
| `type.waterTubing` | Water tubing |
| `type.wakesurfing` | Wakesurfing |
| `type.waterSport` | Water sports |
| `type.archery` | Archery |
| `type.mixedMartialArts` | Mixed martial arts |
| `type.motorSports` | Motorsports |
| `type.snorkeling` | Snorkeling |
| `type.dance` | Dance |
| `type.jumpRope` | Jump rope |
| `type.poolApnea` | Pool apnea |
| `type.mobility` | Mobility |
| `type.geocaching` | Geocaching |
| `type.canoeing` | Canoeing |
| `tabs.label` | Activity types |
| `edit.start` | Edit layout |
| `edit.done` | Done |
| `edit.add` | Add widget |
| `edit.reset` | Reset board |
| `edit.discard` | Discard |
| `edit.bar` | Edit layout |
| `edit.editing` | Editing · {board} |
| `edit.unsaved` | Unsaved changes |
| `discard.title` | Discard your changes? |
| `discard.text` | The layout goes back to how it was before you selected Edit layout, on every board. |
| `discard.keep` | Keep editing |
| `discard.confirm` | Discard changes |
| `edit.copy` | Copy layout |
| `edit.drag` | Drag to move {title} |
| `edit.earlier` | Move {title} earlier |
| `edit.later` | Move {title} later |
| `edit.span` | Width {n} for {title} |
| `edit.hide` | Hide {title} |
| `edit.show` | Show {title} |
| `edit.remove` | Remove {title} |
| `edit.hidden` | Hidden |
| `said.moved` | {title} moved to position {n} of {count} |
| `said.width` | {title}: width {n} |
| `said.hidden` | {title} hidden |
| `said.shown` | {title} shown |
| `said.removed` | {title} removed |
| `said.added` | {title} added |
| `said.saved` | Layout saved |
| `said.unchanged` | No changes to save |
| `said.discarded` | Changes discarded |
| `stale.label` | New layout |
| `stale.text` | Claude wrote a new layout for this dashboard. The layout you made in this browser stays until you choose. |
| `stale.keep` | Keep mine |
| `stale.new` | Use the new one |
| `stale.used` | The new layout is in use |
| `stale.kept` | Your layout is in use |
| `add.title` | Add a widget |
| `add.type` | Type |
| `add.add` | Add |
| `add.close` | Close |
| `add.hiddenGroup` | Hidden on this board |
| `add.none` | Every widget is on this board. |
| `copy.title` | Copy layout |
| `copy.hint` | This layout is saved in this browser only. To keep it in the page, paste this text to Claude and ask it to save the dashboard layout. |
| `copy.copy` | Copy |
| `copy.copied` | Copied |
| `board.empty` | This board has no widgets. Use “Edit layout”, then “Add widget”. |
| `widget.failed` | This widget failed: {message} |
| `widget.unknown` | Unknown widget: {id} |
| `empty.window` | No sessions in the selected weeks. |
| `w.coachNotes` | Coach notes |
| `notes.none` | No notes. |
| `notes.disclaimer` | Training suggestions for the data up to {date}. Not medical advice. |
| `w.kpis` | Overview |
| `kpi.totals` | {km} km · {time} · {n} session\|{km} km · {time} · {n} sessions |
| `kpi.distance` | Distance · last 7 days |
| `kpi.time` | Time · last 7 days |
| `kpi.vs4w` | vs 4-week average |
| `kpi.ratio` | Load ratio 7:28 |
| `kpi.band` | Band 0.8-1.3 |
| `kpi.ratioAll` | Uses all activities, also with a type filter |
| `kpi.hrv` | HRV last night |
| `kpi.vsBaseline` | vs 7-day average {v} ms |
| `w.readiness` | Readiness today |
| `ready.easy` | Go easy |
| `ready.push` | Ready to push |
| `ready.normal` | Normal |
| `ready.hrv` | HRV status |
| `ready.sleep` | Sleep score |
| `ready.rhr` | Resting HR |
| `ready.rhrVs` | 7 days before: {avg} bpm |
| `ready.ratio` | Load ratio 7:28 |
| `ready.note` | The dashboard's own rule, not Garmin's readiness. It shows today: the week window does not change it. |
| `w.fitnessAge` | Fitness age |
| `fa.age` | Fitness age |
| `fa.actual` | Actual age |
| `fa.achievable` | Achievable |
| `fa.component` | Component |
| `fa.value` | Now |
| `fa.target` | Garmin target |
| `fa.potential` | Potential age |
| `fa.bodyFat` | Body fat % |
| `fa.bmi` | BMI |
| `fa.rhr` | Resting HR |
| `fa.vigorousDaysAvg` | Vigorous days / week |
| `fa.vigorousMinutesAvg` | Vigorous minutes / week |
| `today.note` | It shows today: the week window does not change it. |
| `w.periodComparison` | Period comparison |
| `pc.vs` | {from} to {to} against {pfrom} to {pto} |
| `pc.partial` | partial: these weeks start before the data |
| `pc.type` | Type |
| `pc.sessions` | Sessions |
| `pc.distance` | Distance |
| `pc.time` | Time |
| `pc.load` | Load |
| `pc.total` | Total |
| `w.records` | Records |
| `rec.best` | Fastest {d} |
| `d.1k` | 1 km |
| `d.mile` | mile |
| `d.5k` | 5 km |
| `d.10k` | 10 km |
| `d.half` | half marathon |
| `d.marathon` | marathon |
| `rec.longestRun` | Longest run |
| `rec.longestRide` | Longest ride |
| `rec.topSet` | Heaviest set |
| `rec.e1rm` | Best est. 1RM · {name} |
| `rec.none` | No records in the selected weeks. |
| `rec.estimate` | 1RM values are estimates (Epley, sets of 1-12 reps). |
| `w.weeklyVolume` | Weekly volume |
| `m.time` | Time |
| `m.distance` | Distance |
| `m.sessions` | Sessions |
| `m.load` | Load |
| `vol.avg` | 4-week average |
| `w.intensityMinutes` | Intensity minutes |
| `im.guide` | Guideline 150 min |
| `im.note` | Moderate + 2 x vigorous minutes of the activities only, not of the whole day. |
| `w.loadSafety` | Load safety |
| `ls.weekLoad` | Load · last 7 days |
| `ls.monotony` | Monotony · 7 days |
| `ls.monotonyFlag` | Above 2.0 |
| `ls.strain` | Strain · 7 days |
| `ls.flagged` | Weeks above +10% |
| `ls.load` | Weekly load |
| `ls.ramp` | Change vs week before (%) |
| `ls.note` | All activities. Red weeks rose more than 10%; a week in progress is not flagged. Monotony and strain (Foster) are estimates. |
| `ls.estimated` | Some loads are estimates: the activity has no Garmin load. |
| `w.loadVsRecovery` | Load vs recovery |
| `lvr.hrv` | HRV (ms) |
| `lvr.note` | Daily load by type (bars) and nightly HRV (line). |
| `w.calendar` | Consistency |
| `cal.minutes` | {n} min |
| `cal.rest` | Rest day |
| `w.hrv` | HRV |
| `hrv.low` | Range low |
| `hrv.band` | Balanced range |
| `hrv.nightly` | Nightly HRV |
| `hrv.avg` | 7-day average |
| `rec14` | Last 14 days: the week window does not change it. |
| `rec.board` | The recovery widgets show the last 14 days: the week window does not change them. |
| `w.restingHr` | Resting HR |
| `w.sleep` | Sleep |
| `sl.deep` | Deep |
| `sl.light` | Light |
| `sl.rem` | REM |
| `sl.awake` | Awake |
| `sl.score` | Score |
| `w.sleepNeed` | Sleep need |
| `sn.gap` | Short of need · average |
| `sn.actual` | Slept |
| `sn.need` | Need |
| `w.bedtime` | Bedtime |
| `bt.spread` | Bedtime spread |
| `w.bodyBattery` | Body battery |
| `bb.high` | High |
| `bb.low` | Low |
| `w.activities` | Activities |
| `col.date` | Date |
| `col.type` | Type |
| `col.name` | Name |
| `col.distance` | Distance |
| `col.time` | Time |
| `col.pace` | Pace / speed |
| `col.hr` | Avg HR |
| `col.ascent` | Ascent |
| `col.race` | Race |
| `laps.show` | laps |
| `lap.n` | Lap |
| `lap.intensity` | Intensity |
| `act.more` | Show all {n} |
| `act.less` | Show fewer |
| `one.session` | One session so far: trends start at 2 sessions. |
| `w.typeKpis` | Summary |
| `tk.sessions` | Sessions |
| `tk.time` | Time |
| `tk.avg` | {v} per session |
| `tk.distance` | Distance |
| `tk.speed` | Average speed |
| `tk.pace` | Average pace |
| `tk.ascent` | Ascent |
| `tk.hr` | Average HR |
| `tk.peak` | Peak {v} bpm |
| `tk.load` | Garmin training load |
| `tk.share` | {v}% of all load |
| `w.typeWeekly` | Each week |
| `w.hrZones` | Time in HR zones |
| `zones.approximate` | Approximate: some activities have no zone time, so all their minutes count in the zone of their average HR. |
| `form.cadence` | Cadence |
| `form.stride` | Stride |
| `form.gct` | Ground contact |
| `form.vertOsc` | Vertical oscillation |
| `form.vertRatio` | Vertical ratio |
| `form.power` | Power |
| `form.normPower` | Normalized power |
| `w.bestEfforts` | Best efforts |
| `be.distance` | Distance |
| `be.activity` | Activity |
| `w.races` | Races |
| `races.none` | No races in the selected weeks. |
| `te.aerobic` | Aerobic TE |
| `te.anaerobic` | Anaerobic TE |
| `w.aerobicFitness` | Aerobic fitness |
| `af.runs` | Runs (older paler) |
| `af.pace` | Pace (min/km) |
| `af.weekPace` | Weekly pace |
| `af.efficiency` | Efficiency |
| `af.effUnit` | m per heartbeat |
| `w.intensityShare` | Easy and hard running |
| `is.easy` | Z1-2 (easy) |
| `is.hard` | Z4-5 (hard) |
| `w.runningForm` | Running form |
| `w.runWalk` | Run Walk Run |
| `rw.none` | No Run Walk Run sessions in the selected weeks. |
| `rw.runPace` | Run pace |
| `rw.pace` | Overall pace |
| `rw.walk` | Walk time |
| `w.trainingEffect` | Training effect |
| `w.racePredictor` | Race predictor |
| `rp.none` | No best effort of 5 km or more in the selected weeks. |
| `rp.note` | Estimate (Riegel) from the {d} in {time} on {date}. |
| `w.longRuns` | Long runs and pace split |
| `lr.share` | Longest run share of weekly km |
| `lr.ascent` | Weekly ascent |
| `lr.note` | Red weeks: the longest run is more than 35% of the week's km. The table shows races and runs over 15 km with laps. |
| `lr.first` | First half |
| `lr.second` | Second half |
| `lr.split` | Split |
| `lr.gap` | Grade-adjusted pace |
| `lr.positive` | positive |
| `lr.negative` | negative |
| `lr.even` | even |
| `w.setsPerCategory` | Sets per movement |
| `ex.sets` | Completed sets |
| `w.muscleBalance` | Muscle-group balance |
| `mb.pushPull` | Push : pull sets |
| `mb.avg` | Average sets per week |
| `mb.perWeek` | sets per week |
| `mb.note` | A set counts 1 for each primary muscle group and 0.5 for each secondary one. Usual range: 10-20 sets per week (yellow below, red above). |
| `w.exercises` | Exercises |
| `ex.groups` | Muscle groups |
| `ex.search` | Search exercises |
| `ex.name` | Exercise |
| `ex.sessions` | Sessions |
| `ex.last` | Last |
| `ex.top` | Last top set |
| `ex.best` | Best est. 1RM |
| `ex.change` | Change |
| `ex.trend` | Trend |
| `ex.groupRow` | {n} exercise · {sets} completed sets\|{n} exercises · {sets} completed sets |
| `ex.reps` | {n} rep\|{n} reps |
| `ex.rest` | median rest {v} |
| `ex.weight` | Top set (kg) |
| `ex.e1rm` | Est. 1RM (kg) |
| `ex.volume` | Volume (kg) |
| `ex.maxReps` | Max reps |
| `ex.totalReps` | Total reps |
| `ex.longest` | Longest set (s) |
| `ex.restAfter` | rest {v} |
| `ex.notDone` | not done |
| `w.strengthSessions` | Sessions |
| `ss.count` | {n} exercise\|{n} exercises |
| `mg.chest` | Chest |
| `mg.back` | Back |
| `mg.shoulders` | Shoulders |
| `mg.biceps` | Biceps |
| `mg.triceps` | Triceps |
| `mg.forearms` | Forearms |
| `mg.quads` | Quads |
| `mg.hamstrings` | Hamstrings |
| `mg.glutes` | Glutes |
| `mg.calves` | Calves |
| `mg.abs` | Abs |
| `mg.hips` | Hips |
| `mg.other` | Other |
| `w.walkDetails` | Pace and walks |
| `wd.steps` | Steps |
| `wd.battery` | Body battery change |
| `wd.goal` | Step goal |
| `wd.floors` | Floors |
| `w.steps` | Daily steps |
| `w.hikeVertical` | Vertical speed |
| `hv.vam` | Vertical m per hour |
| `w.bikeDetails` | Rides |
| `bd.outdoor` | Outdoor |
| `bd.indoor` | Indoor |
| `bd.rides` | {n} ride\|{n} rides |
| `bd.where` | Where |
| `w.swimDetails` | Swims |
| `sw.pace` | Pace |
| `sw.lengths` | Lengths |
| `sw.strokes` | Strokes |
| `sw.pool` | Pool |
| `w.racketDetails` | Sessions and intensity |
| `pd.peak` | Peak HR |
| `pd.z3` | Time in Z3+ |
| `pd.z45` | Z4-5 share |
| `pd.kcal` | kcal per hour |
| `pd.load` | Load / run of same length |
| `pd.note` | The second load is an estimate: the average Garmin load per minute of your runs, times the length of the session. |
| `col.sport` | Sport |
| `sport.tennis` | Tennis |
| `sport.padel` | Padel |
| `sport.pickleball` | Pickleball |
| `sport.racquetball` | Racquetball |
| `sport.squash` | Squash |
| `sport.badminton` | Badminton |
| `sport.tableTennis` | Table tennis |
| `sport.platformTennis` | Platform tennis |
<!-- keys:end -->
