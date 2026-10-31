# Contributing

garmin-personal-mcp is a read-only MCP server for the official Garmin Connect Personal API,
written in TypeScript. This file tells you how to make a change, and which rules each change must
obey. If a change cannot obey a rule, describe the trade-off in the PR. Do not relax the rule
without a word.

## How to contribute

For all changes larger than a typo or a one-line fix, **open an issue first**. A short
discussion before the work prevents a long discussion in the PR review.

**Branch names.** Use a [Conventional Commits](https://www.conventionalcommits.org/) prefix that
matches the change: `feat/`, `fix/`, `refactor/`, `perf/`, `chore/`, `docs/`, `test/`, `ci/`,
`build/`.

**Commit messages.** Use a Conventional Commits header (`type(scope): subject`). Keep the body
short, and explain _why_, not _what_.

**Pull requests.** Open all PRs against `main`. Write the PR title as a Conventional Commits
header of fewer than 70 characters. Fill in each section of the PR template, and write `- None`
when a section does not apply. In the description, describe the change that a user sees. Do not
write a list of changed files, because the diff shows them.

> [!NOTE]
> **AI-assisted contributions are welcome.** You can write a PR with Claude, Copilot or a similar
> tool. But you must read the diff, understand what the change does, and accept it as your own
> work. [AGENTS.md](AGENTS.md) gives the rules to your coding agent.

## Out of scope

Maintainers close PRs against these boundaries without a long discussion. If a boundary seems
wrong, open an issue _before_ you write code.

- **Write access.** The server is read-only. It does not create, change or delete data in Garmin
  Connect.
- **Other Garmin APIs.** The server uses only the official Personal API, with a personal API key.
  It does not sign in with a user name and password, and it does not read the private API of the
  Garmin Connect web app. The one exception is the public exercise catalogue, which the server
  gets without a token.
- **Data that the Personal API does not have.** For example VO2 max or training readiness. The
  dashboard calculates an estimate and labels it.

## Development environment

You need three tools: Node.js 22 or later, pnpm, and [prek](https://prek.j178.dev) for the git
hooks. Get them in one of two ways:

- **With [devbox](https://www.jetify.com/devbox)**: run `devbox shell` in the repository. It gives
  you Node 26, pnpm and prek.
- **Without devbox**: install Node.js, then run `npm install -g pnpm`. To install prek, follow the
  instructions on the prek website.

In the two cases, pnpm uses the version in the `packageManager` field of `package.json`. CI uses
the same version.

```bash
git clone https://github.com/indaco/garmin-personal-mcp.git
cd garmin-personal-mcp
devbox shell             # with devbox only
pnpm install
pnpm build               # writes dist/index.js, dist/dashboard.html and THIRD-PARTY-NOTICES.md
prek install             # the git hooks: format and lint on commit, typecheck and tests on push
```

### Run your build in a client

To try a change before a release, use your build in place of the npm package. In the client
configuration, use `node` with the absolute path of `dist/index.js` in place of
`npx -y @indaco/garmin-personal-mcp@latest`:

```json
{
  "mcpServers": {
    "garmin-personal": {
      "command": "node",
      "args": ["/absolute/path/to/garmin-personal-mcp/dist/index.js"]
    }
  }
}
```

In Claude Code: `claude mcp add garmin-personal --scope user -- node /absolute/path/to/dist/index.js`.
Remove the npm version first, because the two servers have the same name.

To check that your build starts, send it one `initialize` request. It must answer with one JSON
line and write nothing else to stdout:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
  | node dist/index.js
```

The command sends the first message of each client, then the server stops. The server does not
call Garmin, so you do not need an API key.

| Output                                                      | Meaning                                                                |
| ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| One JSON line with `"serverInfo":{"name":"garmin-personal"` | The build is correct.                                                  |
| An error on stderr                                          | The build does not start. Read the error, then run `pnpm build`.       |
| Text before the JSON line                                   | Code in `src/` writes to stdout. The clients cannot read the messages. |
| No output, and the command does not stop                    | The server does not answer. Stop it with Ctrl-C.                       |

## Code map

Where each part of the server and the page is.

| File                                 | Content                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------ |
| `src/index.ts`                       | the entry point: the stdio server, or a command of `src/cli.ts`                      |
| `src/cli.ts`                         | the `refresh` and `schedule` commands                                                |
| `src/server.ts`                      | the MCP server with its tools and prompts                                            |
| `src/api-client.ts`                  | HTTP, the token and the retries                                                      |
| `src/tools.ts`, `src/fit.ts`         | the tools and the .FIT decoder                                                       |
| `src/dashboard.ts`                   | the `getDashboardData` tool and its cache                                            |
| `src/dashboard-page.ts`              | `writeDashboard` and `editDashboard`: the page file and its blocks                   |
| `src/schedule.ts`                    | `scheduleDashboardRefresh`: the cron, and the job for each system                    |
| `src/digest.ts`                      | the digest of the data for the coach notes                                           |
| `src/page/`                          | the dashboard page: app, layout, calculations, widgets, themes and texts             |
| `src/prompts.ts`                     | the prompts. The prompt texts are in `prompts/`.                                     |
| `src/config.ts`, `src/log.ts`        | the settings and the log                                                             |
| `scripts/build-template.mjs`         | writes `dist/dashboard.html`                                                         |
| `scripts/third-party-notices.mjs`    | writes `THIRD-PARTY-NOTICES.md` after each build                                     |
| `scripts/fill-dashboard-fixture.mjs` | fills `dist/dashboard.html` with a data file, for screenshots and checks             |
| `scripts/demo-dashboard.mjs`         | writes the demo of the website in `dist-site/demo/`: sample data and the filled page |
| `scripts/demo-gif.mjs`               | records `assets/dashboard.gif` from the data of the website demo                     |
| `scripts/demo-stamp.mjs`             | the hash of the GIF inputs, in `assets/dashboard.gif.sha256`                         |
| `site/`                              | the project website: template, partials, styles, script and public files             |
| `scripts/build-site.mjs`             | writes `dist-site/`: the website, with its facts from the code and README            |

## Before you submit

Run these commands before you open the PR. CI runs lint, typecheck, test and build on Node 22, 24
and 26, and the page tests one time on Node 26.

```bash
pnpm lint                # Oxlint, then an Oxfmt check
pnpm typecheck           # tsc --noEmit
pnpm test                # Vitest
pnpm test:coverage       # Vitest with coverage, report in coverage/
pnpm build               # tsdown, the page template, then the third-party notices
pnpm test:page           # the dashboard page in headless Chromium, after the build
```

`pnpm test:page` needs the Chromium headless shell. Install it one time:

```bash
pnpm exec playwright-core install --only-shell chromium
```

`pnpm fmt` corrects the format. `pnpm guide` writes the generated parts of `guide/`.

The README and the website show the same demo, `assets/dashboard.gif`. `pnpm demo` records it from
the data of the website demo, and writes the hash of its inputs to `assets/dashboard.gif.sha256`.
The inputs are the page sources, the English texts and the demo scripts. After a change to them, the
site test and `pnpm build:site` fail until you record the GIF again. `pnpm build:all` records it
only when the inputs changed. Recording needs the build and ImageMagick. Commit the GIF and its hash
file. The demo data ends on a fixed date, `DEMO_END` in `scripts/demo-dashboard.mjs`.

After a dependency change, commit the new `THIRD-PARTY-NOTICES.md` that the build writes. CI fails when the
file does not match the bundle.

## Rules for each change

- **stdout carries only MCP messages.** The client reads JSON-RPC from stdout. Do not use
  `console.log` in `src/`. Use `log()` from `src/log.ts`, which writes to the log file. Only the
  `refresh` and `schedule` commands, which are not MCP, write their result to stdout.
- **The API key and the access token stay secret.** Do not write them to the log, to an error
  message or to a tool result. The tests check this.
- **The token goes only to the Personal API host.** `garminGet` accepts only a relative path. Keep
  this check when you add a tool.
- **The prompts never invent data.** A failed call shows as "n/a". Keep this rule when you edit a
  file in `prompts/`.
- **The names stay stable.** Tool names, prompt names, arguments and output fields are a contract
  with the prompts and with the dashboards that users already have. A change to them needs an
  issue first.
- **The dashboard cache keeps its format.** Other servers can use the same data folder.
- **The README documents each tool, prompt argument and environment variable.** Update it in the
  same PR.
- **Dependencies are the latest versions.** Runtime libraries are dev dependencies, because tsdown
  bundles them into `dist/index.js`, and `npx` installs nothing else.

## Tests

Write the test first for each change that adds logic. Put tests in `test/`, with the name of the
module that they test (`test/tools.test.ts` for `src/tools.ts`).

- **No real .FIT files.** A real .FIT file can have a GPS track. Make the .FIT file in the test
  with `fitFile()` from `test/fit-file.ts`.
- **No real Garmin calls.** Mock `fetch`, or give the code a mocked API client.
- **No writes to your home folder.** Use a temporary folder for the data folder, and set `HOME`
  for tests of the log.
- **Synthetic page data.** The page tests use the synthetic data in
  `test/fixtures/dashboard-data.json`.

## Add a widget

1. Add the widget to `src/page/catalogue.ts`: its id, the key of its title, its types and its width.
2. Add an English description of more than 20 characters to `ABOUT` in
   `src/page/catalogue-about.ts`. The assistant and the widget guide read it.
3. Add the title to every catalogue in `src/page/i18n/locales/`.
4. Put its calculations in a module of `src/page/` (for example `metrics.ts`), with a test in
   `test/page/`.
5. Register it in a file of `src/page/widgets/` with `register({ id, render })`.
6. Add a page test in `test/e2e/` if it has controls or a chart.
7. Run `pnpm guide` to write the widget catalogue in `guide/widgets.md`.

## Add a language

[guide/languages.md](guide/languages.md) gives the procedure. The tests make sure that the new
catalogue has every key and every placeholder of English.

## Release

Release from an up-to-date `main` with a clean tree.

1. Run `pnpm lint && pnpm test`.
2. Run `sley bump auto && sley changelog merge`. Edit `.changes/<TAG>.md` if you want highlights.
3. Branch protection blocks a push to `main`, so open a PR. Create a branch, commit `.version`,
   `package.json`, `CHANGELOG.md` and `.changes/` as `chore(release): vX.Y.Z`, push it and open
   the PR with the same title: the squash merge uses the title as the commit message.
4. After the merge, switch to `main` and pull. The tag must point to the release commit on `main`.
5. Run `sley tag create --push`.

The first version, 0.1.0, was published by hand. Its notes in `.changes/v0.1.0.md` are written by
hand, because `sley bump` writes the notes file and 0.1.0 needs no bump.

The Release workflow checks the tag and runs the checks. It publishes to npm with trusted
publishing and skips a version that is already on npm. It creates the GitHub Release from
`.changes/<TAG>.md`. As a last check, it installs the published version with `npx`.

If `tag-validate` fails, nothing was published. Delete the tag (`git push --delete origin <TAG>`,
`git tag -d <TAG>`), fix the problem and tag again. After a publish, a version cannot be replaced.
Fix forward with a new patch version, and use `npm deprecate` for a bad one.

## License

garmin-personal-mcp uses the [MIT License](LICENSE). When you submit a contribution, you agree to
license it under the same terms.
