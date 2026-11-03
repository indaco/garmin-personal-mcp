// Runs the built commands as a user runs them, on the system of the machine: a real key file with
// its real access, a real hidden prompt, the real MCP server, and a fake Garmin on this machine.
// Everything stays in a temporary home folder.
//
//   pnpm build && pnpm test:e2e
//
// E2E_PTY is the path of node-pty, for the checks in a real terminal. CI sets it. Without it, these
// checks show SKIP: node-pty has a native part, so it is not a dev dependency of the project.
// E2E_SECOND_USER makes a local account on Windows for the checks as another user. Only CI sets it:
// never set it on your own computer.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  cpSync,
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

/**
 * Whether only this user can read the file, as the system tells it. On Windows, as on the root of
 * the other systems, the system account and the administrators can always read it.
 */
function onlyUser(file) {
  if (!WINDOWS) {
    const mode = statSync(file).mode & 0o777;
    return { ok: mode === 0o600, details: `mode ${mode.toString(8)}` };
  }
  const { stdout } = spawnSync("icacls", [file], { encoding: "utf8" });
  const names = stdout
    .replace(file, "")
    .split("\n")
    .map((line) => /^\s*(.+?):\(/.exec(line)?.[1])
    .filter(Boolean)
    .map((name) => name.toLowerCase());
  const user = names.filter((name) => name.split("\\").at(-1) === USER.toLowerCase());
  const others = names.filter(
    (name) =>
      !user.includes(name) && !["nt authority\\system", "builtin\\administrators"].includes(name),
  );
  return { ok: user.length > 0 && others.length === 0, details: stdout };
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

// ---- setup in a folder that gives access to all users: a new file there takes that access
if (WINDOWS) {
  const { env, keyFile } = newHome();
  const dir = dirname(keyFile);
  mkdirSync(dir, { recursive: true });
  spawnSync("icacls", [dir, "/grant", "*S-1-5-32-545:(OI)(CI)(R)"]);
  const other = join(dir, "other-file");
  writeFileSync(other, "");
  const before = onlyUser(other);
  check("setup: another file in a shared folder is open to all users", !before.ok, before.details);
  const r = await run(["setup"], env, `${KEY}\n`);
  const after = onlyUser(keyFile);
  check(
    "setup: closes the key file in a shared folder",
    r.code === 0 && after.ok,
    `${after.details}\n${r.all}`,
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

  writeFileSync(join(home, "a-file"), "");
  r = await run(["doctor"], { ...env, GARMIN_DATA_DIR: join(home, "a-file", "data") });
  check(
    "doctor: fails on a folder under a file",
    r.code === 1 && /failed {2}Data folder: cannot write in/.test(r.stdout),
    r.all,
  );

  // a mode stops nobody as root. On Windows, the checks as a second user test this
  if (WINDOWS || process.getuid?.() === 0) {
    console.log("SKIP  doctor: fails on a folder without the right to write (as an administrator)");
  } else {
    const data = join(home, "data");
    mkdirSync(data);
    chmodSync(data, 0o500);
    r = await run(["doctor"], { ...env, GARMIN_DATA_DIR: data });
    chmodSync(data, 0o700);
    check(
      "doctor: fails on a folder without the right to write",
      r.code === 1 && /failed {2}Data folder: cannot write in/.test(r.stdout),
      r.all,
    );
    const left = readdirSync(data);
    check("doctor: leaves nothing in a folder that it tests", left.length === 0, left.join(", "));
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

// ---- on Windows, as a second user who is not an administrator
const icacls = (...args) => {
  const r = spawnSync("icacls", args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`icacls ${args.join(" ")}: ${r.stdout}${r.stderr}`);
};

const readIfThere = (f) => (existsSync(f) ? readFileSync(f, "utf8") : "");

if (WINDOWS && process.env.E2E_SECOND_USER) {
  const other = "garminE2e";
  // no password in a log: it goes to net and to PowerShell, and it lives as long as this run.
  // At most 14 characters: for a longer one, net asks for a confirmation
  const password = `aA1!${randomBytes(6).toString("base64url")}`;
  const base = mkdtempSync(join(`${process.env.SystemDrive}\\`, "garmin-e2e-"));
  const USERS = "*S-1-5-32-545";
  let script = 0;

  /** Runs the lines of a .cmd file as the second user: it has its own environment, so the file sets it. */
  const asOther = (lines) =>
    new Promise((done, fail) => {
      const file = join(base, `run-${++script}.cmd`);
      writeFileSync(file, ["@echo off", ...lines, "exit /b %errorlevel%", ""].join("\r\n"));
      const stdout = `${file}.out`;
      const stderr = `${file}.err`;
      const ps = [
        "$password = ConvertTo-SecureString $env:E2E_PASSWORD -AsPlainText -Force",
        `$credential = New-Object System.Management.Automation.PSCredential('.\\${other}', $password)`,
        `$p = Start-Process -FilePath cmd.exe -ArgumentList '/c', '"${file}"' -Credential $credential -WorkingDirectory '${base}' -RedirectStandardOutput '${stdout}' -RedirectStandardError '${stderr}' -PassThru`,
        "$handle = $p.Handle",
        "$p.WaitForExit()",
        "exit $p.ExitCode",
      ].join("; ");
      const p = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], {
        env: { ...process.env, E2E_PASSWORD: password },
      });
      let launcher = "";
      p.stdout.on("data", (d) => (launcher += d));
      p.stderr.on("data", (d) => (launcher += d));
      const timer = setTimeout(() => {
        p.kill();
        fail(new Error(`timeout as the second user: ${lines.join(" | ")}`));
      }, TIMEOUT_MS);
      p.on("close", (code) => {
        clearTimeout(timer);
        const out = readIfThere(stdout) + readIfThere(stderr);
        done({ code, out, details: `exit ${code}\n${out}${launcher}` });
      });
    });

  try {
    const added = spawnSync("net", ["user", other, password, "/add"], { encoding: "utf8" });
    if (added.status !== 0) throw new Error(`net user: ${added.stderr}`);
    // the second user can read everything here, unless a test closes it
    icacls(base, "/grant", `${USERS}:(OI)(CI)(RX)`);
    cpSync(resolve("dist"), join(base, "dist"), { recursive: true });

    // these two controls prove that the commands really run as a user without administrator rights
    let r = await asOther(["whoami"]);
    check(
      "second user: runs as that user",
      r.code === 0 && r.out.toLowerCase().includes(other.toLowerCase()),
      r.details,
    );
    r = await asOther(["net session"]);
    check("second user: is not an administrator", r.code !== 0, r.details);

    const { env } = newHome();
    const keys = join(base, "keys");
    mkdirSync(keys);
    const keyFile = join(keys, "api-key");
    const open = join(keys, "open-file");
    writeFileSync(open, "open text");
    const saved = await run(["setup"], { ...env, GARMIN_API_KEY_FILE: keyFile }, `${KEY}\n`);
    check("second user: setup saves in the shared folder", saved.code === 0, saved.all);

    r = await asOther([`type "${open}"`]);
    check(
      "second user: reads another file in the same folder",
      r.code === 0 && r.out.includes("open text"),
      r.details,
    );
    r = await asOther([`type "${keyFile}"`]);
    check("second user: cannot read the key file", r.code !== 0 && !r.out.includes(KEY), r.details);

    // doctor as this user, in a folder with the right to write and in one with an ACL that denies it
    const home = join(base, "other-home");
    const writable = join(base, "writable");
    const denied = join(base, "denied");
    for (const dir of [home, writable, denied]) {
      mkdirSync(dir);
      icacls(dir, "/grant", `${other}:(OI)(CI)(M)`);
    }
    icacls(denied, "/deny", `${other}:(OI)(CI)(WD,AD)`);
    const doctorIn = (data) =>
      asOther([
        `set "HOME=${home}"`,
        `set "USERPROFILE=${home}"`,
        `set "GARMIN_BASE_URL=${env.GARMIN_BASE_URL}"`,
        `set "GARMIN_PERSONAL_API_KEY=${KEY}"`,
        `set "GARMIN_DATA_DIR=${data}"`,
        `"${process.execPath}" "${join(base, "dist", "index.js")}" doctor`,
      ]);
    r = await doctorIn(writable);
    check(
      "second user: doctor passes in a folder with the right to write",
      r.code === 0 && r.out.includes("All checks passed."),
      r.details,
    );
    r = await doctorIn(denied);
    check(
      "second user: doctor fails on a folder where an ACL denies writing",
      r.code === 1 && /failed {2}Data folder: cannot write in/.test(r.out),
      r.details,
    );
    check("second user: doctor does not show the key", !r.out.includes(KEY), r.details);
    const left = readdirSync(denied);
    check("second user: doctor leaves nothing in that folder", left.length === 0, left.join(", "));
  } catch (e) {
    check("second user: the checks ran to their end", false, e.message.replaceAll(password, "***"));
  } finally {
    spawnSync("net", ["user", other, "/delete"]);
    rmSync(base, { recursive: true, force: true, maxRetries: 3 });
  }
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
