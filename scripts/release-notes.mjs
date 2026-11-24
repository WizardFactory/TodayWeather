#!/usr/bin/env node
// Drafts and checks the notes of a target-specific GitHub Release (docs/operations/github-releases.md).
//
//   node scripts/release-notes.mjs --scope android --version 2.0.0-rc.1 [--commit <ref>] [--from <ref>]
//   node scripts/release-notes.mjs --check <notes file> --tag <tag to publish> [--commit <ref>]
//
// The draft lists what was merged under the scope's paths since its previous final tag, read from the local Git
// history only, and leaves `<fill in>` where the operator records what Git cannot know. --check passes when nothing
// is left to fill in, the notes are of the tag that is about to be published, and that tag exists at the commit
// the notes name (and at --commit, when given). Neither mode creates a tag or a Release.
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
      ["R8 mapping SHA-256", `${FILL} (mapping.txt of the build, uploaded to Play with the APK)`],
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
      ["Release CI run", `${FILL} (iOS release verification, passed on the source commit)`],
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

// Orders by MAJOR.MINOR.PATCH; candidates of a version compare equal to it.
function compare(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

// The newest final tag of the scope among those the commit contains.
function previousFinal(scope, commit) {
  const prefix = `${scope}/v`;
  const tags = git(["tag", "--merged", commit, "--list", `${prefix}*`]).split("\n").filter(Boolean);
  const finals = tags
    .map((tag) => ({ tag, version: parseVersion(tag.slice(prefix.length)) }))
    .filter(({ version }) => version && version.candidate === null)
    .sort((a, b) => compare(b.version, a.version));
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
  if (!Object.hasOwn(SCOPES, options.scope)) {
    throw new UsageError(`unknown scope ${options.scope}: use one of ${Object.keys(SCOPES).join(", ")}`);
  }
  const scope = SCOPES[options.scope];
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

  // Versions only grow along the history: a commit that already contains a final release of the scope cannot
  // become an equal or older version, and its changes are counted from that release.
  const last = previousFinal(options.scope, commit);
  if (last && compare(version, parseVersion(last.slice(`${options.scope}/v`.length))) <= 0) {
    throw new UsageError(`${options.version} is not above ${last}, which ${commit} already contains`);
  }
  let from;
  let previous;
  if (options.from) {
    from = tryGit(["rev-parse", "--verify", "--quiet", `${options.from}^{commit}`]);
    if (!from) throw new UsageError(`cannot resolve the starting commit ${options.from}`);
    if (tryGit(["merge-base", "--is-ancestor", from, commit]) === null) {
      throw new UsageError(`the starting commit ${from} is not an ancestor of ${commit}`);
    }
    previous = `none (changes since ${from})`;
  } else {
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

// A tag name of this convention, read as a name only and never as a Git revision expression (android/v2.0.0^):
// its scope and version, or null.
function releaseTag(tag) {
  const named = /^(.+)\/v([^/]+)$/.exec(tag ?? "");
  if (named === null || !Object.hasOwn(SCOPES, named[1])) return null;
  const version = parseVersion(named[2]);
  return version === null ? null : { scope: named[1], version };
}

// Checks the notes in `file` for the Release of `publish`, the tag about to be pushed, at `expected`, its commit
// when the caller names one.
function check(file, publish, expected) {
  if (!publish) throw new UsageError("--check needs --tag <the tag to publish>");
  const wanted = releaseTag(publish);
  if (wanted === null) throw new UsageError(`${publish} is not a release tag (<scope>/vMAJOR.MINOR.PATCH or -rc.N)`);
  let expectedCommit = null;
  if (expected !== undefined) {
    expectedCommit = tryGit(["rev-parse", "--verify", "--quiet", `${expected}^{commit}`]);
    if (!expectedCommit) throw new UsageError(`cannot resolve the commit ${expected}`);
  }
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    throw new UsageError(`cannot read the notes ${file}: ${error.code ?? error.message}`);
  }
  const problems = [];
  const field = (name) => new RegExp(`^${name}: (.+)$`, "m").exec(text)?.[1].trim();
  const tag = field("Tag");
  const commit = field("Source commit");
  if (!tag) problems.push("no Tag line");
  else if (releaseTag(tag) === null) problems.push(`${tag} is not a release tag (<scope>/vMAJOR.MINOR.PATCH or -rc.N)`);
  if (tag && tag !== publish) problems.push(`the notes are of ${tag}, not of ${publish}`);
  if (wanted.version.candidate !== null && !SCOPES[wanted.scope].candidates) {
    problems.push(`${wanted.scope} has no release candidates: ${publish} cannot be released`);
  }
  if (field("Delivery scope") !== wanted.scope) {
    problems.push(`the tag is of scope ${wanted.scope}, the notes say Delivery scope ${field("Delivery scope") ?? "nothing"}`);
  }
  if (!commit || !/^[0-9a-f]{40}$/.test(commit)) problems.push("Source commit is not a full 40-character SHA");
  else if (expectedCommit !== null && commit !== expectedCommit) {
    problems.push(`Source commit ${commit} is not the commit ${expectedCommit} named with --commit`);
  }
  const unfilled = text.split("\n").filter((line) => line.includes("<fill in")).map((line) => line.trim());
  if (unfilled.length) problems.push(`unfilled: ${unfilled.join(" | ")}`);
  // The tag that will be pushed must exist here, at the commit the notes name.
  const tagged = tryGit(["rev-parse", "--verify", "--quiet", `refs/tags/${publish}^{commit}`]);
  if (tagged === null) problems.push(`tag ${publish} does not exist`);
  else if (commit && tagged !== commit) problems.push(`tag ${publish} points at ${tagged}, the notes say ${commit}`);
  return { tag: publish, problems };
}

function main(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i];
    if (!["--scope", "--version", "--commit", "--from", "--check", "--tag"].includes(name) || argv[i + 1] === undefined) {
      throw new UsageError(`usage: release-notes.mjs --scope <scope> --version <version> [--commit <ref>] [--from <ref>]
       release-notes.mjs --check <notes file> --tag <tag to publish> [--commit <ref>]`);
    }
    options[name.slice(2)] = argv[i + 1];
  }
  if (options.check) {
    const { tag, problems } = check(options.check, options.tag, options.commit);
    if (problems.length) {
      process.stderr.write(`${problems.join("\n")}\n`);
      return 1;
    }
    process.stdout.write(`${tag}: notes complete\n`);
    return 0;
  }
  if (!options.scope) throw new UsageError("--scope and --version are required");
  process.stdout.write(draft({ commit: "HEAD", ...options }));
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof UsageError)) throw error;
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 2;
}
