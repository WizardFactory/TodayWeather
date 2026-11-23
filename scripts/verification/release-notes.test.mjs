// Tests for scripts/release-notes.mjs: every case builds its own Git repository in a temporary directory.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "release-notes.mjs");

function repository(t) {
  const dir = mkdtempSync(join(tmpdir(), "release-notes-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid",
        GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid",
        GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null",
      },
    }).trim();
  git("init", "-q", "-b", "master");
  const commit = (path, subject, body = "") => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), `${subject}\n${Math.random()}\n`);
    git("add", "-A");
    git("commit", "-q", "-m", body ? `${subject}\n\n${body}` : subject);
    return git("rev-parse", "HEAD");
  };
  // A pull request merged with a merge commit, as GitHub writes it.
  const mergePr = (number, branch, path, title) => {
    git("checkout", "-q", "-b", branch);
    commit(path, `work on ${branch}`);
    git("checkout", "-q", "master");
    git("merge", "-q", "--no-ff", branch, "-m", `Merge pull request #${number} from WizardFactory/${branch}\n\n${title}`);
    return git("rev-parse", "HEAD");
  };
  const run = (...args) => {
    const result = spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: "utf8" });
    return { code: result.status, out: result.stdout, err: result.stderr };
  };
  return { dir, git, commit, mergePr, run };
}

test("lists the scope's merged pull requests since its previous final tag", (t) => {
  const r = repository(t);
  r.commit("android/a.txt", "start");
  r.git("tag", "android/v2.0.0");
  r.mergePr(11, "feat/a", "android/b.txt", "Show the hourly chart");
  r.mergePr(12, "feat/b", "ios/b.txt", "An iOS only change");
  r.commit("android/c.txt", "Fix the widget size (#13)");
  r.git("tag", "android/v2.0.1-rc.1");
  const head = r.commit("android/d.txt", "A direct commit");

  const { code, out, err } = r.run("--scope", "android", "--version", "2.0.1-rc.2");
  assert.equal(code, 0, err);
  assert.match(out, new RegExp(`^Source commit: ${head}$`, "m"));
  assert.match(out, /^Delivery scope: android$/m);
  assert.match(out, /^Tag: android\/v2\.0\.1-rc\.2$/m);
  // A release candidate is not a previous release: the changes stay cumulative since the last final tag.
  assert.match(out, /^Previous release: android\/v2\.0\.0 /m);
  assert.match(out, /^- Show the hourly chart \(#11\)$/m);
  assert.match(out, /^- Fix the widget size \(#13\)$/m);
  assert.match(out, new RegExp(`^- A direct commit \\(${head.slice(0, 9)}\\)$`, "m"));
  assert.doesNotMatch(out, /iOS only/);
  assert.match(out, /versionCode: <fill in>/);
});

test("uses the newest final tag by version, and only tags the commit contains", (t) => {
  const r = repository(t);
  r.commit("ios/a.txt", "start");
  r.git("tag", "ios/v2.0.9");
  r.mergePr(21, "feat/a", "ios/b.txt", "Between 2.0.9 and 2.0.10");
  r.git("tag", "ios/v2.0.10");
  const target = r.mergePr(22, "feat/b", "ios/c.txt", "After 2.0.10");
  r.commit("ios/d.txt", "later");
  r.git("tag", "ios/v2.1.0");

  const { code, out, err } = r.run("--scope", "ios", "--version", "2.0.11", "--commit", target);
  assert.equal(code, 0, err);
  assert.match(out, /^Previous release: ios\/v2\.0\.10 /m);
  assert.match(out, /After 2\.0\.10 \(#22\)/);
  assert.doesNotMatch(out, /Between 2\.0\.9/);
});

test("a first release needs an explicit starting commit", (t) => {
  const r = repository(t);
  const first = r.commit("android/a.txt", "start");
  r.mergePr(31, "feat/a", "android/b.txt", "First feature");

  const missing = r.run("--scope", "android", "--version", "2.0.0-rc.1");
  assert.equal(missing.code, 2);
  assert.match(missing.err, /no previous android\/v\* release.*--from/s);

  const given = r.run("--scope", "android", "--version", "2.0.0-rc.1", "--from", first);
  assert.equal(given.code, 0, given.err);
  assert.match(given.out, new RegExp(`^Previous release: none \\(changes since ${first}\\)$`, "m"));
  assert.match(given.out, /First feature \(#31\)/);
});

test("says so when the scope has no changes", (t) => {
  const r = repository(t);
  r.commit("web/a.txt", "start");
  r.git("tag", "webapp/v1.0.0");
  r.commit("android/a.txt", "another scope");
  const { code, out } = r.run("--scope", "webapp", "--version", "1.0.1");
  assert.equal(code, 0);
  assert.match(out, /^- No changes under web\/, packages\/ since webapp\/v1\.0\.0$/m);
  assert.match(out, /```release-manifest/);
});

test("refuses unknown scopes, bad versions, release candidates outside the store apps, and used tags", (t) => {
  const r = repository(t);
  r.commit("android/a.txt", "start");
  r.git("tag", "android/v2.0.0");
  r.commit("android/b.txt", "next");
  for (const [args, message] of [
    [["--scope", "cordova/android", "--version", "1.0.0"], /unknown scope/],
    [["--scope", "android", "--version", "v2.0.1"], /MAJOR\.MINOR\.PATCH/],
    [["--scope", "android", "--version", "2.0"], /MAJOR\.MINOR\.PATCH/],
    [["--scope", "webapp", "--version", "1.0.0-rc.1"], /release candidates/],
    [["--scope", "android", "--version", "2.0.0"], /android\/v2\.0\.0 already exists/],
    [["--scope", "android", "--version", "2.0.1", "--commit", "no-such-ref"], /cannot resolve/],
    [["--scope", "android"], /--version/],
  ]) {
    const result = r.run(...args);
    assert.equal(result.code, 2, args.join(" "));
    assert.match(result.err, message, args.join(" "));
    assert.equal(result.out, "");
  }
});

test("check passes complete notes for the tagged commit and names what is missing", (t) => {
  const r = repository(t);
  const first = r.commit("android/a.txt", "start");
  const head = r.commit("android/b.txt", "next");
  const draft = r.run("--scope", "android", "--version", "2.0.0", "--from", first).out;
  const notes = join(r.dir, "notes.md");

  writeFileSync(notes, draft);
  const unfilled = r.run("--check", notes);
  assert.equal(unfilled.code, 1);
  assert.match(unfilled.err, /unfilled: .*versionCode/s);

  const filled = draft.replace(/<fill in[^>]*>/g, "done");
  writeFileSync(notes, filled);
  const untagged = r.run("--check", notes);
  assert.equal(untagged.code, 1);
  assert.match(untagged.err, /tag android\/v2\.0\.0 does not exist/);

  r.git("tag", "-a", "android/v2.0.0", "-m", "release", first);
  const moved = r.run("--check", notes);
  assert.equal(moved.code, 1);
  assert.match(moved.err, new RegExp(`points at ${first}, the notes say ${head}`));

  r.git("tag", "-d", "android/v2.0.0");
  r.git("tag", "-a", "android/v2.0.0", "-m", "release", head);
  const complete = r.run("--check", notes);
  assert.equal(complete.code, 0, complete.err);
  assert.match(complete.out, /android\/v2\.0\.0: notes complete/);
});
