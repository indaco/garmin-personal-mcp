# Changelog

All notable changes to this project will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). The changelog is generated and managed by [sley](https://github.com/indaco/sley).

## v0.6.0 - 2026-10-31

### 🚀 Enhancements

- warn on a late automatic refresh and run a missed one ([800eb6c](https://github.com/indaco/garmin-personal-mcp/commit/800eb6c)) ([#137](https://github.com/indaco/garmin-personal-mcp/pull/137))
- show the dashboard in the chat as an MCP App ([c57fd2e](https://github.com/indaco/garmin-personal-mcp/commit/c57fd2e)) ([#135](https://github.com/indaco/garmin-personal-mcp/pull/135))
- sticky site header, five strength questions, external links in a new tab ([549802c](https://github.com/indaco/garmin-personal-mcp/commit/549802c)) ([#134](https://github.com/indaco/garmin-personal-mcp/pull/134))

### 🩹 Fixes

- cron steps, prompt arguments as typed, n/a gaps on the page, clean tool errors ([0994cae](https://github.com/indaco/garmin-personal-mcp/commit/0994cae)) ([#144](https://github.com/indaco/garmin-personal-mcp/pull/144))
- keep the crontab, let only the model call tools, and correct the digest load ([51b4d3f](https://github.com/indaco/garmin-personal-mcp/commit/51b4d3f)) ([#143](https://github.com/indaco/garmin-personal-mcp/pull/143))
- keep excluded data out of the coach notes when the chat already has it ([e72a8ee](https://github.com/indaco/garmin-personal-mcp/commit/e72a8ee)) ([#140](https://github.com/indaco/garmin-personal-mcp/pull/140))
- keep the README demo GIF and the website demo in sync ([9477072](https://github.com/indaco/garmin-personal-mcp/commit/9477072)) ([#133](https://github.com/indaco/garmin-personal-mcp/pull/133))

### 📖 Documentation

- rewrite guide and prompt sentences in Simplified Technical English ([e0da21d](https://github.com/indaco/garmin-personal-mcp/commit/e0da21d)) ([#141](https://github.com/indaco/garmin-personal-mcp/pull/141))
- name the clients that show the dashboard in the chat, and add a guide index ([429e429](https://github.com/indaco/garmin-personal-mcp/commit/429e429)) ([#139](https://github.com/indaco/garmin-personal-mcp/pull/139))

### ✅ Tests

- restore and raise the unit coverage ([0b1082f](https://github.com/indaco/garmin-personal-mcp/commit/0b1082f)) ([#138](https://github.com/indaco/garmin-personal-mcp/pull/138))

### 🏡 Chores

- add glama.json ([7483936](https://github.com/indaco/garmin-personal-mcp/commit/7483936)) ([#146](https://github.com/indaco/garmin-personal-mcp/pull/146))

### ❤️ Contributors

- [@indaco](https://github.com/indaco)

## v0.5.0 - 2026-10-30

### 🚀 Enhancements

- compact getSleep and no Garmin user ids in tool results ([a347c81](https://github.com/indaco/garmin-personal-mcp/commit/a347c81)) ([#130](https://github.com/indaco/garmin-personal-mcp/pull/130))
- coach analyses for the Strength board ([8878806](https://github.com/indaco/garmin-personal-mcp/commit/8878806)) ([#129](https://github.com/indaco/garmin-personal-mcp/pull/129))
- compare the running form of intervals on their reps ([0ad16e0](https://github.com/indaco/garmin-personal-mcp/commit/0ad16e0)) ([#127](https://github.com/indaco/garmin-personal-mcp/pull/127))
- add run coaching analytics and the run-review and race-readiness prompts ([027c62f](https://github.com/indaco/garmin-personal-mcp/commit/027c62f)) ([#123](https://github.com/indaco/garmin-personal-mcp/pull/123))
- add the digest to the getDashboardData result ([f1bf7ad](https://github.com/indaco/garmin-personal-mcp/commit/f1bf7ad)) ([#122](https://github.com/indaco/garmin-personal-mcp/pull/122))

### 🩹 Fixes

- say what strength-review compares without an e1RM or in another form ([e216211](https://github.com/indaco/garmin-personal-mcp/commit/e216211)) ([#131](https://github.com/indaco/garmin-personal-mcp/pull/131))
- offer at most 4 options in the language question of training-dashboard ([a8fbff5](https://github.com/indaco/garmin-personal-mcp/commit/a8fbff5)) ([#125](https://github.com/indaco/garmin-personal-mcp/pull/125))
- count the .FIT downloads of getDashboardData and skip empty laps ([5e178f1](https://github.com/indaco/garmin-personal-mcp/commit/5e178f1)) ([#126](https://github.com/indaco/garmin-personal-mcp/pull/126))

### 📖 Documentation

- list the coach prompts and more strength questions on the website ([93fc566](https://github.com/indaco/garmin-personal-mcp/commit/93fc566)) ([#128](https://github.com/indaco/garmin-personal-mcp/pull/128))

### 🏡 Chores

- switch coverage to v8 and link the website from the package ([29a185a](https://github.com/indaco/garmin-personal-mcp/commit/29a185a)) ([#121](https://github.com/indaco/garmin-personal-mcp/pull/121))

### ❤️ Contributors

- [@indaco](https://github.com/indaco)

## v0.4.0 - 2026-10-29

### 🚀 Enhancements

- add the project website and its build ([830c4e5](https://github.com/indaco/garmin-personal-mcp/commit/830c4e5)) ([#117](https://github.com/indaco/garmin-personal-mcp/pull/117))
- add the Munich and Munich dark dashboard themes ([4f8290a](https://github.com/indaco/garmin-personal-mcp/commit/4f8290a)) ([#114](https://github.com/indaco/garmin-personal-mcp/pull/114))

### 🩹 Fixes

- tell the schedule when a scheduled page is rebuilt ([041792a](https://github.com/indaco/garmin-personal-mcp/commit/041792a)) ([#113](https://github.com/indaco/garmin-personal-mcp/pull/113))

### 💅 Refactors

- move the page styles to a cascade layer and native nesting ([40434cb](https://github.com/indaco/garmin-personal-mcp/commit/40434cb)) ([#115](https://github.com/indaco/garmin-personal-mcp/pull/115))

### 📖 Documentation

- shorten the README now that the website exists ([78a6b44](https://github.com/indaco/garmin-personal-mcp/commit/78a6b44)) ([#118](https://github.com/indaco/garmin-personal-mcp/pull/118))

### ❤️ Contributors

- [@indaco](https://github.com/indaco)

## v0.3.2 - 2026-10-29

### 🩹 Fixes

- ask to keep the saved settings when the dashboard is rebuilt ([930fe59](https://github.com/indaco/garmin-personal-mcp/commit/930fe59)) ([#108](https://github.com/indaco/garmin-personal-mcp/pull/108))

### 📖 Documentation

- show the README questions as examples ([b677244](https://github.com/indaco/garmin-personal-mcp/commit/b677244)) ([#109](https://github.com/indaco/garmin-personal-mcp/pull/109))

### ❤️ Contributors

- [@indaco](https://github.com/indaco)

## v0.3.1 - 2026-10-29

### 🩹 Fixes

- print the version and the help without starting the server ([71698c8](https://github.com/indaco/garmin-personal-mcp/commit/71698c8)) ([#106](https://github.com/indaco/garmin-personal-mcp/pull/106))

### ❤️ Contributors

- [@indaco](https://github.com/indaco)

## v0.3.0 - 2026-10-29

### 🚀 Enhancements

- ask for the title and headline of a preset or blank dashboard ([1baef2f](https://github.com/indaco/garmin-personal-mcp/commit/1baef2f)) ([#102](https://github.com/indaco/garmin-personal-mcp/pull/102))
- update dashboard pages on a schedule ([9f26b38](https://github.com/indaco/garmin-personal-mcp/commit/9f26b38)) ([#101](https://github.com/indaco/garmin-personal-mcp/pull/101))
- filter activities by name in listActivities and on the dashboard ([e586189](https://github.com/indaco/garmin-personal-mcp/commit/e586189)) ([#99](https://github.com/indaco/garmin-personal-mcp/pull/99))
- show the server version in the dashboard footer ([88900d9](https://github.com/indaco/garmin-personal-mcp/commit/88900d9)) ([#96](https://github.com/indaco/garmin-personal-mcp/pull/96))
- local widget library, widget languages and catalogue search ([04bad92](https://github.com/indaco/garmin-personal-mcp/commit/04bad92)) ([#95](https://github.com/indaco/garmin-personal-mcp/pull/95))

### 🩹 Fixes

- show the server version on demo pages, keep search dialogs still ([4110dc9](https://github.com/indaco/garmin-personal-mcp/commit/4110dc9)) ([#98](https://github.com/indaco/garmin-personal-mcp/pull/98))

### ❤️ Contributors

- [@indaco](https://github.com/indaco)

## v0.2.0 - 2026-10-29

### 🚀 Enhancements

- dashboard languages from the Garmin profile, and four more languages ([51a3b23](https://github.com/indaco/garmin-personal-mcp/commit/51a3b23)) ([#93](https://github.com/indaco/garmin-personal-mcp/pull/93))
- show the dashboard in the units of the Garmin profile ([11ab4a3](https://github.com/indaco/garmin-personal-mcp/commit/11ab4a3)) ([#89](https://github.com/indaco/garmin-personal-mcp/pull/89))
- add getWeight, getBodyBattery and getActivityWorkouts ([1202b2b](https://github.com/indaco/garmin-personal-mcp/commit/1202b2b)) ([#88](https://github.com/indaco/garmin-personal-mcp/pull/88))

### 📖 Documentation

- **tools:** remove weight from the data the Personal API does not have ([3e5cbae](https://github.com/indaco/garmin-personal-mcp/commit/3e5cbae)) ([#92](https://github.com/indaco/garmin-personal-mcp/pull/92))
- lead the README with the MCP server, then the dashboard ([b01d14b](https://github.com/indaco/garmin-personal-mcp/commit/b01d14b)) ([#91](https://github.com/indaco/garmin-personal-mcp/pull/91))

### ❤️ Contributors

- [@indaco](https://github.com/indaco)

## v0.1.1 - 2026-10-28

### 🩹 Fixes

- name the assistant, not Claude, in page and prompt texts ([1a5ae6a](https://github.com/indaco/garmin-personal-mcp/commit/1a5ae6a)) ([#84](https://github.com/indaco/garmin-personal-mcp/pull/84))

### 📖 Documentation

- connect Codex and other stdio clients ([397b82f](https://github.com/indaco/garmin-personal-mcp/commit/397b82f)) ([#83](https://github.com/indaco/garmin-personal-mcp/pull/83))
- add AGENTS.md for coding agents ([13ca4cd](https://github.com/indaco/garmin-personal-mcp/commit/13ca4cd)) ([#85](https://github.com/indaco/garmin-personal-mcp/pull/85))
- run the npm package with @latest in the install commands ([70b4606](https://github.com/indaco/garmin-personal-mcp/commit/70b4606)) ([#82](https://github.com/indaco/garmin-personal-mcp/pull/82))

### ❤️ Contributors

- [@indaco](https://github.com/indaco)

## v0.1.0 - 2026-10-28

### 🏡 Chores

- Initial Release

### ❤️ Contributors

- [@indaco](https://github.com/indaco)
