# AGENTS.md

Instructions for coding agents that work in this repository. [CONTRIBUTING.md](CONTRIBUTING.md) has
the full rules, the code map and the branch, commit and PR conventions. This file gives the parts
that an agent breaks most often.

## What this is

A stdio MCP server in TypeScript (Node.js 22 or later) for the read-only Garmin Connect Personal
API. The client starts `dist/index.js` and speaks JSON-RPC over stdin and stdout. The server gives
tools, prompts (`prompts/*.md`) and a dashboard page (`src/page/`, built into
`dist/dashboard.html`). `showDashboard` also shows that page inside the chat, as an MCP App.

## Commands

```bash
pnpm lint                # Oxlint, then an Oxfmt check
pnpm fmt                 # correct the format
pnpm typecheck           # tsc --noEmit
pnpm test                # Vitest
pnpm vitest run test/tools.test.ts -t "name"   # one test
pnpm build               # dist/index.js, the page template, THIRD-PARTY-NOTICES.md
pnpm build:site          # the website in dist-site/, after the build
pnpm build:all           # both builds, and the demo GIF when its inputs changed (needs ImageMagick)
pnpm demo                # record assets/dashboard.gif again, from the data of the website demo
pnpm test:page           # the dashboard page and the website in headless Chromium, after both builds
pnpm guide               # write the generated parts of guide/
```

Smoke test: the server must answer with one JSON line and nothing else on stdout.

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
  | timeout 10 node dist/index.js
```

## Rules

- **stdout carries only MCP messages.** Do not use `console.log` in `src/`. Use `log()` from
  `src/log.ts`. Only the `refresh` and `schedule` commands, which are not MCP, print to stdout.
- **The API key and the access token stay secret.** Do not put them in the log, in an error message
  or in a tool result.
- **The prompts never invent data.** A missing value or a failed call shows as "n/a". Keep this rule
  when you edit `prompts/`.
- **Names are a contract.** Do not rename tools, prompts, arguments or output fields without an
  issue.
- **Generated files**: do not edit the generated parts of `guide/` (run `pnpm guide`) or
  `THIRD-PARTY-NOTICES.md` (the build writes it).
- **The README documents each tool, prompt argument and environment variable.** Update it in the
  same change.
- **The guide has an index.** A new, renamed or removed page in `guide/` changes its line in
  `guide/README.md`.
- **Client-neutral text.** The server runs in every stdio MCP client. Text that a user or a model
  reads (README, guides, page texts, prompts, tool descriptions) says "your assistant" or "the
  assistant". Name a client only for its own steps (install, configuration, slash commands) and for
  measurements made with it.
- **Name the clients of a feature that only some clients show**, such as the dashboard in the chat.
  Write "tested" only for a client that you tried. Mark the others "not tested". Do not write "some
  assistants".
- **Dependencies are the latest versions.** Runtime libraries are dev dependencies, because tsdown
  bundles them into `dist/index.js`.
- **No personal data.** Tests use synthetic data and `fitFile()` from `test/fit-file.ts`, never a
  real .FIT file or a real Garmin call.

## Before you finish

Run `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build`. After a change to `src/page/` or
`site/`, also run `pnpm build:site` and `pnpm test:page`. A running client keeps the old server
process: start a new session to see a changed tool or prompt.
