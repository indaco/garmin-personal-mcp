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
> work.

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

You need Node.js 22 or later and pnpm. The `packageManager` field in `package.json` sets the pnpm
version, so `corepack enable` gives you the same pnpm as CI.

```bash
git clone https://github.com/indaco/garmin-personal-mcp.git
cd garmin-personal-mcp
pnpm install
pnpm build               # writes dist/index.js, dist/dashboard.html and THIRD-PARTY-NOTICES.md
```

### Run your build in a client

To try a change before a release, use your build in place of the npm package. In the client
configuration, use `node` with the absolute path of `dist/index.js` in place of
`npx -y @indaco/garmin-personal-mcp`:

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

## Code map

Where each part of the server and the page is.

| File                                 | Content                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------ |
| `src/index.ts`                       | the stdio entry point                                                    |
| `src/server.ts`                      | the MCP server with its tools and prompts                                |
| `src/api-client.ts`                  | HTTP, the token and the retries                                          |
| `src/tools.ts`, `src/fit.ts`         | the tools and the .FIT decoder                                           |
| `src/dashboard.ts`                   | the `getDashboardData` tool and its cache                                |
| `src/dashboard-page.ts`              | `writeDashboard` and `editDashboard`: the page file and its blocks       |
| `src/digest.ts`                      | the digest of the data for the coach notes                               |
| `src/page/`                          | the dashboard page: app, layout, calculations, widgets, themes and texts |
| `src/prompts.ts`                     | the prompts. The prompt texts are in `prompts/`.                         |
| `src/config.ts`, `src/log.ts`        | the settings and the log                                                 |
| `scripts/build-template.mjs`         | writes `dist/dashboard.html`                                             |
| `scripts/third-party-notices.mjs`    | writes `THIRD-PARTY-NOTICES.md` after each build                         |
| `scripts/fill-dashboard-fixture.mjs` | fills `dist/dashboard.html` with a data file, for screenshots and checks |

## Before you submit

Run these commands before you open the PR. CI runs the same commands on Node 22, 24 and 26.

```bash
pnpm lint                # Oxlint, then an Oxfmt check
pnpm typecheck           # tsc --noEmit
pnpm test                # Vitest
pnpm build               # tsdown, the page template, then the third-party notices
pnpm test:page           # the dashboard page in headless Chromium, after the build
```

`pnpm test:page` needs the Chromium headless shell. Install it one time:

```bash
pnpm exec playwright-core install --only-shell chromium
```

`pnpm fmt` corrects the format. `pnpm guide` writes the generated parts of `guide/`. After a
visible change to the dashboard page, `pnpm demo` records the README demo `assets/dashboard.gif`
again: it needs the build and ImageMagick. After a
dependency change, commit the new `THIRD-PARTY-NOTICES.md` that the build writes. CI fails when the
file does not match the bundle.

## Rules for each change

- **stdout carries only MCP messages.** The client reads JSON-RPC from stdout. Do not use
  `console.log` in `src/`. Use `log()` from `src/log.ts`, which writes to the log file.
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

1. Add the widget to `src/page/catalogue.ts`: its id, the key of its title, its types, its width
   and a short English description.
2. Add the title to every catalogue in `src/page/i18n/`.
3. Put its calculations in a module of `src/page/` (for example `metrics.ts`), with a test in
   `test/page/`.
4. Register it in a file of `src/page/widgets/` with `register({ id, render })`.
5. Add a page test in `test/e2e/` if it has controls or a chart.
6. Run `pnpm guide` to write the widget catalogue in `guide/widgets.md`.

## Add a language

[guide/languages.md](guide/languages.md) gives the procedure. The tests make sure that the new
catalogue has every key and every placeholder of English.

## License

garmin-personal-mcp uses the [MIT License](LICENSE). When you submit a contribution, you agree to
license it under the same terms.
