/** Read-only Release/build/environment guard. Artifact contents are data, never code. */
import {
  readFile,
  writeFile,
  appendFile,
  mkdtemp,
  mkdir,
  rm,
} from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
export const REPOSITORY = "WizardFactory/TodayWeather";
export const ENVIRONMENT = "webapp-production";
const sha = /^[a-f0-9]{40}$/;
const digest = /^sha256:[a-f0-9]{64}$/;
const tagPattern = /^webapp\/v\d+\.\d+\.\d+$/;
const requireValue = (ok, message) => {
  if (!ok) throw Error(message);
};
export function parseManifest(body) {
  const blocks = [
    ...String(body ?? "").matchAll(
      /^```release-manifest\r?\n([\s\S]*?)^```\s*$/gm,
    ),
  ];
  requireValue(
    blocks.length === 1,
    "Exactly one release-manifest block is required",
  );
  const m = JSON.parse(blocks[0][1]);
  requireValue(
    m.schemaVersion === 1 && m.target === "webapp" && sha.test(m.sourceCommit),
    "Manifest requires webapp and a full clean sourceCommit",
  );
  requireValue(
    Number.isSafeInteger(m.buildRunId) &&
      m.buildRunId > 0 &&
      Number.isSafeInteger(m.artifactId) &&
      m.artifactId > 0 &&
      digest.test(m.artifactDigest),
    "Manifest requires immutable run/artifact IDs and SHA256 digest",
  );
  requireValue(
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(m.rollbackReference ?? ""),
    "Manifest requires an opaque rollbackReference",
  );
  return m;
}
export function validateCandidate({
  repository,
  tag,
  tagCommit,
  release,
  run,
  artifact,
}) {
  requireValue(
    repository === REPOSITORY && tagPattern.test(tag),
    "Only upstream webapp/vMAJOR.MINOR.PATCH releases qualify",
  );
  requireValue(
    release.tag_name === tag &&
      release.draft === false &&
      release.prerelease === false,
    "Release must be published and not prerelease",
  );
  const m = parseManifest(release.body);
  requireValue(
    tagCommit === m.sourceCommit,
    "Tag and Release sourceCommit differ",
  );
  requireValue(
    run.id === m.buildRunId &&
      run.event === "push" &&
      run.head_branch === "master" &&
      run.head_sha === m.sourceCommit &&
      run.status === "completed" &&
      run.conclusion === "success" &&
      run.path === ".github/workflows/web.yml" &&
      run.repository?.full_name === repository &&
      run.head_repository?.full_name === repository,
    "Requires a successful upstream Web app master-push run for this commit",
  );
  requireValue(
    artifact.id === m.artifactId &&
      artifact.name === "web-static-dist" &&
      artifact.expired === false &&
      artifact.digest === m.artifactDigest &&
      artifact.workflow_run?.id === run.id &&
      artifact.workflow_run?.head_sha === m.sourceCommit &&
      artifact.workflow_run?.head_branch === "master",
    "Artifact identity, provenance, digest or expiry mismatch",
  );
  return m;
}
export function validateEnvironment(environment, policies) {
  const rule = environment.protection_rules?.find(
    (r) => r.type === "required_reviewers",
  );
  requireValue(
    environment.name === ENVIRONMENT &&
      environment.can_admins_bypass === false &&
      rule?.prevent_self_review === true &&
      rule.reviewers?.length > 0,
    "Environment requires reviewers, no self-review and no admin bypass",
  );
  requireValue(
    environment.deployment_branch_policy?.custom_branch_policies === true &&
      environment.deployment_branch_policy?.protected_branches === false &&
      policies.branch_policies?.length === 1 &&
      policies.branch_policies[0].name === "master" &&
      policies.branch_policies[0].type === "branch",
    "Environment must allow only the master branch",
  );
}
export function assertArtifactCommit(release, manifest) {
  requireValue(
    release.commit === manifest.sourceCommit,
    "Artifact release.json commit must exactly equal Release sourceCommit",
  );
}
export async function githubSnapshot(tag, token, fetcher = fetch) {
  requireValue(tagPattern.test(tag), "Invalid webapp tag");
  requireValue(token, "GitHub read token required");
  const get = async (path) => {
    const response = await fetcher(
      `https://api.github.com/repos/${REPOSITORY}/${path}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
    if (!response.ok)
      throw Error(`GitHub read failed (${response.status}): ${path}`);
    return response.json();
  };
  const release = await get(`releases/tags/${encodeURIComponent(tag)}`);
  const m = parseManifest(release.body);
  let object = (await get(`git/ref/tags/${encodeURIComponent(tag)}`)).object;
  for (let i = 0; object.type === "tag" && i < 5; i++)
    object = (await get(`git/tags/${object.sha}`)).object;
  requireValue(object.type === "commit", "Tag does not resolve to a commit");
  const [run, artifact, environment, policies] = await Promise.all([
    get(`actions/runs/${m.buildRunId}`),
    get(`actions/artifacts/${m.artifactId}`),
    get(`environments/${ENVIRONMENT}`),
    get(`environments/${ENVIRONMENT}/deployment-branch-policies?per_page=100`),
  ]);
  validateEnvironment(environment, policies);
  const snapshot = {
    repository: REPOSITORY,
    tag,
    tagCommit: object.sha,
    release,
    run,
    artifact,
  };
  validateCandidate(snapshot);
  return snapshot;
}
export function assertArchiveDigest(bytes, expected) {
  requireValue(
    digest.test(expected) &&
      "sha256:" + createHash("sha256").update(bytes).digest("hex") === expected,
    "Downloaded archive SHA256 mismatch",
  );
}
export async function downloadArtifact(manifest, directory, token) {
  requireValue(token, "GitHub read token required");
  const response = await fetch(
    `https://api.github.com/repos/${REPOSITORY}/actions/artifacts/${manifest.artifactId}/zip`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    },
  );
  requireValue(response.ok, "Artifact download failed");
  const bytes = Buffer.from(await response.arrayBuffer());
  requireValue(bytes.length <= 500000000, "Artifact archive too large");
  assertArchiveDigest(bytes, manifest.artifactDigest);
  const tmp = await mkdtemp(join(tmpdir(), "tw-release-zip-"));
  try {
    const zip = join(tmp, "artifact.zip");
    await writeFile(zip, bytes);
    await mkdir(directory, { recursive: false });
    const extraction = spawnSync(
      "python3",
      [
        "-c",
        `
import pathlib, stat, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    seen = set()
    assert sum(i.file_size for i in z.infolist()) <= 500000000, "Artifact expands beyond limit"
    for i in z.infolist():
        p = pathlib.PurePosixPath(i.filename)
        assert not p.is_absolute() and ".." not in p.parts and "\\" not in i.filename, "Unsafe archive path"
        assert i.filename not in seen, "Duplicate archive entry"
        seen.add(i.filename)
        mode = i.external_attr >> 16
        assert not stat.S_ISLNK(mode), "Archive symlink forbidden"
    z.extractall(sys.argv[2])
`,
        zip,
        resolve(directory),
      ],
      { encoding: "utf8" },
    );
    requireValue(
      !extraction.error && extraction.status === 0,
      "Artifact extraction rejected unsafe/invalid archive",
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
export async function main(argv) {
  const [command, input, output, artifactDir] = argv;
  if (command === "download") {
    const manifest = JSON.parse(await readFile(input, "utf8"));
    await downloadArtifact(manifest, output, process.env.GH_TOKEN);
    return;
  }
  let snapshot;
  if (command === "fetch")
    snapshot = await githubSnapshot(input, process.env.GH_TOKEN);
  else if (command === "check")
    snapshot = JSON.parse(await readFile(input, "utf8"));
  else
    throw Error(
      "Usage: web-release-guard.mjs fetch TAG OUTPUT [DIST] | check SNAPSHOT OUTPUT [DIST]",
    );
  const manifest = validateCandidate(snapshot);
  if (artifactDir)
    assertArtifactCommit(
      JSON.parse(await readFile(resolve(artifactDir, "release.json"), "utf8")),
      manifest,
    );
  await writeFile(
    output,
    JSON.stringify(
      { ...manifest, tag: snapshot.tag, releaseId: snapshot.release.id },
      null,
      2,
    ) + "\n",
  );
  if (process.env.GITHUB_OUTPUT)
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `source_commit=${manifest.sourceCommit}\nbuild_run_id=${manifest.buildRunId}\nartifact_id=${manifest.artifactId}\n`,
    );
  console.log(
    `Verified ${snapshot.tag}: ${manifest.sourceCommit}, run ${manifest.buildRunId}, artifact ${manifest.artifactId}`,
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main(process.argv.slice(2)).catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
