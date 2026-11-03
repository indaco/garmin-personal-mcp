// Runs the built commands as a user runs them, on the system of the machine: a real key file with
// its real access, a real hidden prompt, the real MCP server, and a fake Garmin on this machine.
// Everything stays in a temporary home folder.
//
//   pnpm build && pnpm test:e2e
//
// E2E_PTY is the path of node-pty, for the checks in a real terminal. CI sets it. Without it, these
// checks show SKIP: node-pty has a native part, so it is not a dev dependency of the project.
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";

const KEY = "s3cret-e2e-key";
const OTHER_KEY = "0ther-e2e-key";
const ENTRY = resolve("dist/index.js");
const WINDOWS = process.platform === "win32";
const USER = userInfo().username;
const TIMEOUT_MS = 30_000;

if (!existsSync(ENTRY)) {
  console.error("dist/index.js is missing: run pnpm build first");
  process.exit(1);
}

let failed = 0;
function check(name, ok, details = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (ok) return;
  failed++;
  if (details) console.log(`      ${details.replaceAll("\n", "\n      ")}`);
}

// the fake Garmin: it accepts only the two keys of this test
const garmin = createServer((req, res) => {
  const ok = [`ApiKey ${KEY}`, `ApiKey ${OTHER_KEY}`].includes(req.headers.authorization);
  res.writeHead(ok ? 200 : 401, { "Content-Type": "application/json" });
  res.end(ok ? '{"access_token":"t0ken","expires_in":3600}' : "denied");
});
await new Promise((done) => garmin.listen(0, "127.0.0.1", done));

const root = mkdtempSync(join(tmpdir(), "garmin-e2e-"));
let homes = 0;

/** A new home folder, with a space in its path, and the environment that points to it. */
function newHome(extra = {}) {
  const home = join(root, `my home ${++homes}`);
  mkdirSync(home);
  const env = { ...process.env, HOME: home, USERPROFILE: home, ...extra };
  env.GARMIN_BASE_URL = `http://127.0.0.1:${garmin.address().port}`;
  delete env.GARMIN_PERSONAL_API_KEY;
  delete env.GARMIN_API_KEY_FILE;
  delete env.GARMIN_DATA_DIR;
  return { home, env, keyFile: join(home, ".config", "garmin-mcp", "api-key") };
}

/** Runs a command to its end, with its input on a pipe. */
function run(args, env, input = "") {
  return new Promise((done, fail) => {
    const p = spawn(process.execPath, [ENTRY, ...args], { env });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      p.kill();
      fail(new Error(`timeout: ${args.join(" ")}`));
    }, TIMEOUT_MS);
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("close", (code) => {
      clearTimeout(timer);
      done({ code, stdout, stderr, all: stdout + stderr });
    });
    p.stdin.end(input);
  });
}

/** Whether only this user can read the file, as the system tells it. */
function onlyUser(file) {
  if (!WINDOWS) {
    const mode = statSync(file).mode & 0o777;
    return { ok: mode === 0o600, details: `mode ${mode.toString(8)}` };
  }
  const { stdout } = spawnSync("icacls", [file], { encoding: "utf8" });
  // one entry, for this user, with full access, and nothing that comes from the folder
  const entries = stdout.split(":(").length - 1;
  const ok =
    entries === 1 && stdout.toLowerCase().includes(USER.toLowerCase()) && stdout.includes(":(F)");
  return { ok, details: stdout };
}

/** Takes the right to write in a folder from this user, and gives the function that gives it back. */
function denyWrite(dir) {
  if (!WINDOWS) {
    chmodSync(dir, 0o500);
    return () => chmodSync(dir, 0o700);
  }
  spawnSync("icacls", [dir, "/deny", `${USER}:(OI)(CI)(WD,AD)`]);
  return () => spawnSync("icacls", [dir, "/remove:d", USER]);
}

// ---- setup, with the key on a pipe
{
  const { home, env, keyFile } = newHome();
  let r = await run(["setup"], env, `${KEY}\r\n`);
  check("setup: a Windows line ending on the pipe works", r.code === 0, r.all);
  check("setup: saves only the key", readFileSync(keyFile, "utf8") === `${KEY}\n`);
  const access = onlyUser(keyFile);
  check("setup: only the user can read the key file", access.ok, access.details);
  if (!WINDOWS) {
    const mode = statSync(dirname(keyFile)).mode & 0o777;
    check("setup: only the user can open the new folder", mode === 0o700, mode.toString(8));
  }
  check(
    "setup: says that only the user can read it",
    r.stdout.includes("only you can read it"),
    r.all,
  );
  check("setup: does not show the key", !r.all.includes(KEY), r.all);
  check("setup: does not show the home folder", !r.stdout.includes(home), r.stdout);

  r = await run(["setup"], env, `${OTHER_KEY}\n`);
  check(
    "setup: stops on a key file that exists",
    r.code === 1 && r.stderr.includes("exists"),
    r.all,
  );
  check("setup: keeps that key", readFileSync(keyFile, "utf8") === `${KEY}\n`);

  r = await run(["setup", "--force"], env, "wrong-key\n");
  check(
    "setup --force: a refused key gives 1",
    r.code === 1 && r.stderr.includes("not saved"),
    r.all,
  );
  check("setup --force: a refused key is not shown", !r.all.includes("wrong-key"), r.all);
  check(
    "setup --force: a refused key keeps the old key",
    readFileSync(keyFile, "utf8") === `${KEY}\n`,
  );

  r = await run(["setup", "--force"], env, `${OTHER_KEY}\n`);
  check(
    "setup --force: replaces the key",
    r.code === 0 && readFileSync(keyFile, "utf8") === `${OTHER_KEY}\n`,
    r.all,
  );
  const again = onlyUser(keyFile);
  check("setup --force: only the user can read the new file", again.ok, again.details);
  const left = readdirSync(dirname(keyFile));
  check("setup --force: leaves no temporary file", left.length === 1, left.join(", "));

  r = await run(["setup", "--force", OTHER_KEY], env);
  check(
    "setup: does not take the key as an argument",
    r.code === 1 && !r.all.includes(OTHER_KEY),
    r.all,
  );

  r = await run(["setup", "--force"], env, "two words\n");
  check(
    "setup: a key with a space is not sent and not saved",
    r.code === 1 && readFileSync(keyFile, "utf8") === `${OTHER_KEY}\n`,
    r.all,
  );
}

// ---- setup with no folder that it can make
{
  const { home, env } = newHome();
  writeFileSync(join(home, ".config"), "");
  const r = await run(["setup"], env, `${KEY}\n`);
  check(
    "setup: gives the reason when it cannot save",
    r.code === 1 && r.stderr.includes("Cannot save the key in"),
    r.all,
  );
  check("setup: does not show the key when it cannot save", !r.all.includes(KEY), r.all);
}

// ---- doctor
{
  const { home, env, keyFile } = newHome();
  let r = await run(["doctor"], env);
  check(
    "doctor: fails without a key, and names setup",
    r.code === 1 && r.stdout.includes("setup"),
    r.all,
  );

  await run(["setup"], env, `${KEY}\n`);
  r = await run(["doctor"], env);
  check(
    "doctor: passes after setup",
    r.code === 0 && r.stdout.endsWith("All checks passed.\n"),
    r.all,
  );
  check(
    "doctor: does not show the key or the token",
    !r.all.includes(KEY) && !r.all.includes("t0ken"),
    r.all,
  );
  check("doctor: does not show the home folder", !r.stdout.includes(home), r.stdout);
  check("doctor: makes no missing folder", !existsSync(join(home, "workspace")), r.all);

  const refused = await run(["doctor"], { ...env, GARMIN_PERSONAL_API_KEY: "wrong-key" });
  check(
    "doctor: tests the key of the environment",
    refused.code === 1 && refused.stdout.includes("HTTP 401"),
    refused.all,
  );
  check("doctor: does not show that key", !refused.all.includes("wrong-key"), refused.all);

  if (WINDOWS) {
    check(
      "doctor: says that it does not check the access on Windows",
      r.stdout.includes("not checked on Windows"),
      r.all,
    );
  } else {
    chmodSync(keyFile, 0o644);
    r = await run(["doctor"], env);
    check(
      "doctor: fails on a key file that others can read",
      r.code === 1 && r.stdout.includes("chmod 600"),
      r.all,
    );
    chmodSync(keyFile, 0o600);
  }

  // as root, a mode stops nothing
  if (process.getuid?.() !== 0) {
    const data = join(home, "data");
    mkdirSync(data);
    const undo = denyWrite(data);
    r = await run(["doctor"], { ...env, GARMIN_DATA_DIR: data });
    undo();
    check(
      "doctor: fails on a folder without the right to write",
      r.code === 1 && /failed {2}Data folder: cannot write in/.test(r.stdout),
      r.all,
    );
    const left = readdirSync(data);
    check("doctor: leaves nothing in a folder that it tests", left.length === 0, left.join(", "));
  } else {
    console.log("SKIP  doctor: fails on a folder without the right to write (root)");
  }
}

// ---- info and the help
{
  const { home, env } = newHome();
  await run(["setup"], env, `${KEY}\n`);
  let r = await run(["info"], env);
  check(
    "info: shows the home folder as ~",
    r.code === 0 &&
      !r.stdout.includes(home) &&
      r.stdout.includes(`${join("~", ".config", "garmin-mcp", "api-key")} (found)`),
    r.all,
  );

  r = await run(["--help"], env);
  check(
    "--help: lists doctor and setup",
    r.code === 0 && r.stdout.includes("  doctor ") && r.stdout.includes("  setup [--force] "),
    r.all,
  );
  for (const command of ["info", "doctor", "setup", "refresh", "schedule"]) {
    r = await run([command, "--help"], env);
    check(
      `${command} --help: gives its help`,
      r.code === 0 && r.stdout.startsWith(`Usage: garmin-personal-mcp ${command}`),
      r.all,
    );
  }

  for (const args of [["foo"], ["--foo"], [""], ["info", "--foo"]]) {
    r = await run(args, env);
    check(
      `${JSON.stringify(args)}: help on stderr, 1, and no server`,
      r.code === 1 && r.stdout === "" && r.stderr.includes("Usage: garmin-personal-mcp"),
      r.all,
    );
  }
}

// ---- the MCP server: stdout has only MCP messages
{
  const { env } = newHome();
  const line = await new Promise((done, fail) => {
    const p = spawn(process.execPath, [ENTRY], { env });
    let stdout = "";
    const timer = setTimeout(() => {
      p.kill();
      fail(new Error("timeout: the MCP server"));
    }, TIMEOUT_MS);
    p.stdout.on("data", (d) => {
      stdout += d;
      if (!stdout.includes("\n")) return;
      clearTimeout(timer);
      p.kill();
      done(stdout);
    });
    p.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "e2e", version: "1" } } })}\n`,
    );
  });
  check(
    "server: answers with one JSON line",
    JSON.parse(line).id === 1 && line.trim().split("\n").length === 1,
    line,
  );
}

// ---- setup in a real terminal
// eslint-disable-next-line no-control-regex
const plain = (s) => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g, "");
const ptyPath = process.env.E2E_PTY;
if (ptyPath) {
  const pty = createRequire(import.meta.url)(ptyPath);

  /** Runs setup in a terminal, and types when the prompt shows: a fast paste must stay hidden. */
  const terminal = (env, typed) =>
    new Promise((done, fail) => {
      const term = pty.spawn(process.execPath, [ENTRY, "setup"], {
        cols: 160,
        rows: 40,
        cwd: root,
        env,
      });
      let out = "";
      let sent = false;
      const timer = setTimeout(() => {
        term.kill();
        fail(new Error(`timeout in the terminal. It shows:\n${plain(out)}`));
      }, TIMEOUT_MS);
      term.onData((d) => {
        out += d;
        if (sent || !plain(out).includes("hidden")) return;
        sent = true;
        term.write(typed);
      });
      term.onExit(({ exitCode }) => {
        clearTimeout(timer);
        done({ code: exitCode, out: plain(out) });
      });
    });

  {
    const { env, keyFile } = newHome();
    const r = await terminal(env, `${KEY}\r`);
    check("terminal: setup works", r.code === 0, r.out);
    check("terminal: the key stays hidden", !r.out.includes(KEY), r.out);
    check("terminal: saves only the key", readFileSync(keyFile, "utf8") === `${KEY}\n`);
    const access = onlyUser(keyFile);
    check("terminal: only the user can read the key file", access.ok, access.details);
  }
  {
    const { env, keyFile } = newHome();
    const r = await terminal(env, `${KEY}x\x7f\r`);
    check(
      "terminal: backspace removes a character",
      r.code === 0 && readFileSync(keyFile, "utf8") === `${KEY}\n`,
      r.out,
    );
  }
  {
    const { env, keyFile } = newHome();
    const r = await terminal(env, "abc\x03");
    check(
      "terminal: Ctrl-C saves nothing",
      r.code === 1 && r.out.includes("No key given") && !existsSync(keyFile),
      r.out,
    );
    check("terminal: Ctrl-C does not show what you typed", !r.out.includes("abc"), r.out);
  }
} else {
  console.log("SKIP  terminal: E2E_PTY is not set");
}

garmin.close();
rmSync(root, { recursive: true, force: true, maxRetries: 3 });
console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} checks failed.`);
// node-pty keeps handles open
process.exit(failed === 0 ? 0 : 1);
