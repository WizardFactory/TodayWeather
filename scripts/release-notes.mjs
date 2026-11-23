#!/usr/bin/env node
// Drafts and checks the notes of a target-specific GitHub Release (docs/operations/github-releases.md).
//
//   node scripts/release-notes.mjs --scope android --version 2.0.0-rc.1 [--commit <ref>] [--from <ref>]
//   node scripts/release-notes.mjs --check <notes file>
//
// The draft lists what was merged under the scope's paths since its previous final tag, read from the local Git
// history only, and leaves `<fill in>` where the operator records what Git cannot know. --check passes when nothing
// is left to fill in and the tag exists at the commit the notes name. Neither mode creates a tag or a Release.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const FILL = "<fill in>";
const storeStatus = [
  ["Store status", `build ${FILL} / signing ${FILL} / submission ${FILL} / store publication ${FILL}`],
];
// One entry per delivery scope. `paths` select the changes; `candidates` allows -rc.N versions (store apps, whose
// test-track builds are released before the production build).
export const SCOPES = {
  android: {
    paths: ["android/"],
    candidates: true,
    artifact: [
      ["Package", "net.wizardfactory.todayweather"],
      ["versionName", null],
      ["versionCode", FILL],
      ["minSdk / targetSdk", FILL],
      ["APK SHA-256", FILL],
      ["Signing certificate SHA-256", `${FILL} (equal to the certificate of the installed store release)`],
      ["Release CI run", `${FILL} (Android release verification, passed on the source commit)`],
      ["Device gate", `${FILL} (private evidence reference)`],
    ],
    status: storeStatus,
  },
  ios: {
    paths: ["ios/"],
    candidates: true,
    artifact: [
      ["Bundle ID", "net.wizardfactory.todayweather"],
      ["Marketing version", null],
      ["Build number", FILL],
      ["Archive / IPA SHA-256", FILL],
      ["Release verification", `${FILL} (run or log reference on the source commit)`],
      ["Device acceptance", `${FILL} (private evidence reference)`],
    ],
    status: storeStatus,
  },
  webapp: {
    paths: ["web/", "packages/"],
    artifact: [["Build", `${FILL} (master-push build run URL)`]],
    manifest: true,
  },
  "backend/tw-svc": {
    paths: ["server/"],
    artifact: [
      ["Host", "tw-svc"],
      ["Package and dependency identity", FILL],
      ["Host and configuration inventory", `${FILL} (private reference)`],
    ],
  },
  "backend/tw-gather": {
    paths: ["server/"],
    artifact: [
      ["Host", "tw-gather"],
      ["Package and dependency identity", FILL],
      ["Gather configuration and grid inventory", `${FILL} (private reference)`],
    ],
  },
  "backend/server2": {
    paths: ["server2/"],
    artifact: [
      ["Executable SHA-256", FILL],
      ["Verified candidate run", `${FILL} (Server2 workflow run on the source commit)`],
      ["Configuration inventory", `${FILL} (private reference)`],
    ],
  },
};

class UsageError extends Error {}

function git(args, options = {}) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options }).trimEnd();
}

function tryGit(args) {
  try {
    return git(args);
  } catch {
    return null;
  }
}

function parseVersion(text) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/.exec(text);
  if (!match) return null;
  const [major, minor, patch] = match.slice(1, 4).map(Number);
  return { major, minor, patch, candidate: match[4] === undefined ? null : Number(match[4]) };
}

function previousFinal(scope, commit) {
  const prefix = `${scope}/v`;
  const tags = git(["tag", "--merged", commit, "--list", `${prefix}*`]).split("\n").filter(Boolean);
  const finals = tags
    .map((tag) => ({ tag, version: parseVersion(tag.slice(prefix.length)) }))
    .filter(({ version }) => version && version.candidate === null)
    .sort((a, b) =>
      b.version.major - a.version.major || b.version.minor - a.version.minor || b.version.patch - a.version.patch);
  return finals.length ? finals[0].tag : null;
}

function changes(from, commit, paths) {
  const log = git(["log", "--first-parent", "--format=%H%x1f%s%x1f%b%x1e", `${from}..${commit}`, "--", ...paths]);
  return log.split("\x1e").map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    const [hash, subject, body = ""] = entry.split("\x1f");
    const merged = /^Merge pull request #(\d+) from \S+$/.exec(subject);
    if (merged) {
      const title = body.split("\n").map((line) => line.trim()).find(Boolean);
      return `- ${title ?? subject} (#${merged[1]})`;
    }
    if (/\(#\d+\)$/.test(subject)) return `- ${subject}`;
    return `- ${subject} (${hash.slice(0, 9)})`;
  });
}

function draft(options) {
  const scope = SCOPES[options.scope];
  if (!scope) throw new UsageError(`unknown scope ${options.scope}: use one of ${Object.keys(SCOPES).join(", ")}`);
  if (!options.version) throw new UsageError("--version MAJOR.MINOR.PATCH is required");
  const version = parseVersion(options.version);
  if (!version) throw new UsageError(`${options.version}: the version is MAJOR.MINOR.PATCH, or MAJOR.MINOR.PATCH-rc.N`);
  if (version.candidate !== null && !scope.candidates) {
    throw new UsageError(`${options.scope} has no release candidates: use MAJOR.MINOR.PATCH`);
  }
  const tag = `${options.scope}/v${options.version}`;
  if (tryGit(["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`]) !== null) {
    throw new UsageError(`${tag} already exists: a tag is never reused, choose the next version`);
  }
  const commit = tryGit(["rev-parse", "--verify", "--quiet", `${options.commit}^{commit}`]);
  if (!commit) throw new UsageError(`cannot resolve the commit ${options.commit}`);

  let from;
  let previous;
  if (options.from) {
    from = tryGit(["rev-parse", "--verify", "--quiet", `${options.from}^{commit}`]);
    if (!from) throw new UsageError(`cannot resolve the starting commit ${options.from}`);
    previous = `none (changes since ${from})`;
  } else {
    const last = previousFinal(options.scope, commit);
    if (!last) {
      throw new UsageError(
        `no previous ${options.scope}/v* release is contained in ${commit}: pass --from <commit> for the first one`);
    }
    from = git(["rev-parse", `${last}^{commit}`]);
    previous = `${last} (${from})`;
  }

  const list = changes(from, commit, scope.paths);
  const since = options.from ? from : previous.split(" ")[0];
  const lines = [
    `Source commit: ${commit}`,
    `Delivery scope: ${options.scope}`,
    `Tag: ${tag}`,
    `Previous release: ${previous}`,
    "",
    "## Changes",
    "",
    `User impact: ${FILL}`,
    "",
    ...(list.length ? list : [`- No changes under ${scope.paths.join(", ")} since ${since}`]),
    "",
    "## Artifact",
    "",
    ...scope.artifact.map(([name, value]) => `- ${name}: ${value ?? options.version.replace(/-rc\.\d+$/, "")}`),
    "",
    "## Status",
    "",
    `Publication: ${FILL} (UTC time; publishing this Release is not deployment completion)`,
    "Rollout status: pending",
    `Operator/approval: ${FILL}`,
    `Verification: ${FILL}`,
    `Rollback: ${FILL}`,
    `Attempts: ${FILL}`,
    ...(scope.status ?? []).map(([name, value]) => `${name}: ${value}`),
  ];
  if (scope.manifest) {
    lines.push("", "```release-manifest", JSON.stringify({
      schemaVersion: 1,
      target: "webapp",
      sourceCommit: commit,
      buildRunId: FILL,
      artifactId: FILL,
      artifactDigest: FILL,
      rollbackReference: FILL,
    }, null, 2), "```");
  }
  return `${lines.join("\n")}\n`;
}

function check(file) {
  const text = readFileSync(file, "utf8");
  const problems = [];
  const field = (name) => new RegExp(`^${name}: (.+)$`, "m").exec(text)?.[1].trim();
  const tag = field("Tag");
  const commit = field("Source commit");
  if (!tag) problems.push("no Tag line");
  if (!commit || !/^[0-9a-f]{40}$/.test(commit)) problems.push("Source commit is not a full 40-character SHA");
  const unfilled = text.split("\n").filter((line) => line.includes("<fill in")).map((line) => line.trim());
  if (unfilled.length) problems.push(`unfilled: ${unfilled.join(" | ")}`);
  if (tag && commit) {
    const tagged = tryGit(["rev-parse", "--verify", "--quiet", `refs/tags/${tag}^{commit}`]);
    if (tagged === null) problems.push(`tag ${tag} does not exist`);
    else if (tagged !== commit) problems.push(`tag ${tag} points at ${tagged}, the notes say ${commit}`);
  }
  return { tag, problems };
}

function main(argv) {
  const options = { commit: "HEAD" };
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i];
    if (!["--scope", "--version", "--commit", "--from", "--check"].includes(name) || argv[i + 1] === undefined) {
      throw new UsageError(`usage: release-notes.mjs --scope <scope> --version <version> [--commit <ref>] [--from <ref>]
       release-notes.mjs --check <notes file>`);
    }
    options[name.slice(2)] = argv[i + 1];
  }
  if (options.check) {
    const { tag, problems } = check(options.check);
    if (problems.length) {
      process.stderr.write(`${problems.join("\n")}\n`);
      return 1;
    }
    process.stdout.write(`${tag}: notes complete\n`);
    return 0;
  }
  if (!options.scope) throw new UsageError("--scope and --version are required");
  process.stdout.write(draft(options));
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof UsageError)) throw error;
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 2;
}
