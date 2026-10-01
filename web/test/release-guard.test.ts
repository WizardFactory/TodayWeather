import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error standalone release guard
import * as guard from "../../scripts/web-release-guard.mjs";
const {
  validateCandidate,
  validateEnvironment,
  parseManifest,
  assertArtifactCommit,
} = guard;
const sha = "a".repeat(40);
const digest = "sha256:" + "b".repeat(64);
const manifest = {
  schemaVersion: 1,
  target: "webapp",
  sourceCommit: sha,
  buildRunId: 12,
  artifactId: 34,
  artifactDigest: digest,
  rollbackReference: "webapp-backup-2653",
};
const candidate = () => ({
  repository: "WizardFactory/TodayWeather",
  tag: "webapp/v1.2.3",
  tagCommit: sha,
  release: {
    id: 1,
    tag_name: "webapp/v1.2.3",
    draft: false,
    prerelease: false,
    body: "```release-manifest\n" + JSON.stringify(manifest) + "\n```",
  },
  run: {
    id: 12,
    event: "push",
    head_branch: "master",
    head_sha: sha,
    status: "completed",
    conclusion: "success",
    path: ".github/workflows/web.yml",
    repository: { full_name: "WizardFactory/TodayWeather" },
    head_repository: { full_name: "WizardFactory/TodayWeather" },
  },
  artifact: {
    id: 34,
    name: "web-static-dist",
    expired: false,
    digest,
    workflow_run: { id: 12, head_sha: sha, head_branch: "master" },
  },
});
it("accepts only the explicit webapp Release and exact successful master-push artifact", () => {
  expect(validateCandidate(candidate())).toEqual(manifest);
  for (const patch of [
    { event: "pull_request" },
    { event: "workflow_dispatch" },
    { head_branch: "main" },
    { conclusion: "failure" },
    { status: "in_progress" },
    { path: ".github/workflows/" + "other.yml" },
    { head_sha: "c".repeat(40) },
    { head_repository: { full_name: "fork/repo" } },
  ]) {
    const c = candidate();
    Object.assign(c.run, patch);
    expect(() => validateCandidate(c)).toThrow();
  }
  for (const patch of [
    { expired: true },
    { id: 99 },
    { digest: "sha256:" + "c".repeat(64) },
    { name: "web-browser-evidence" },
    { workflow_run: { id: 99, head_sha: sha, head_branch: "master" } },
  ]) {
    const c = candidate();
    Object.assign(c.artifact, patch);
    expect(() => validateCandidate(c)).toThrow();
  }
  for (const patch of [
    { tagCommit: "d".repeat(40) },
    { repository: "fork/repo" },
    { tag: "backend/tw-svc/v1.2.3" },
  ])
    expect(() => validateCandidate({ ...candidate(), ...patch })).toThrow();
  for (const patch of [{ draft: true }, { prerelease: true }]) {
    const c = candidate();
    Object.assign(c.release, patch);
    expect(() => validateCandidate(c)).toThrow();
  }
});
it("rejects ambiguous manifests, unknown targets, shortened/dirty commits and unsafe references", () => {
  const body = (m: object) =>
    "```release-manifest\n" + JSON.stringify(m) + "\n```";
  for (const patch of [
    { target: "backend" },
    { sourceCommit: sha.slice(0, 7) },
    { sourceCommit: sha + "-dirty" },
    { buildRunId: 0 },
    { artifactId: "34" },
    { artifactDigest: "unknown" },
    { rollbackReference: "" },
  ])
    expect(() => parseManifest(body({ ...manifest, ...patch }))).toThrow();
  expect(() => parseManifest(body(manifest) + "\n" + body(manifest))).toThrow();
  for (const commit of [
    sha.slice(0, 7),
    sha + "-dirty",
    "unknown",
    "f".repeat(40),
  ])
    expect(() => assertArtifactCommit({ commit }, manifest)).toThrow();
  expect(() => assertArtifactCommit({ commit: sha }, manifest)).not.toThrow();
});
const env = () => ({
  name: "webapp-production",
  can_admins_bypass: false,
  protection_rules: [
    {
      type: "required_reviewers",
      prevent_self_review: true,
      reviewers: [{ type: "User", reviewer: { id: 1 } }],
    },
  ],
  deployment_branch_policy: {
    protected_branches: false,
    custom_branch_policies: true,
  },
});
it("fails closed for absent approval rules, bypass, self-review or non-master environment scope", () => {
  expect(() =>
    validateEnvironment(env(), {
      branch_policies: [{ name: "master", type: "branch" }],
    }),
  ).not.toThrow();
  for (const patch of [
    { can_admins_bypass: true },
    { protection_rules: [] },
    {
      protection_rules: [
        {
          type: "required_reviewers",
          prevent_self_review: false,
          reviewers: [1],
        },
      ],
    },
    {
      protection_rules: [
        {
          type: "required_reviewers",
          prevent_self_review: true,
          reviewers: [],
        },
      ],
    },
    { deployment_branch_policy: null },
  ])
    expect(() =>
      validateEnvironment(
        { ...env(), ...patch },
        { branch_policies: [{ name: "master", type: "branch" }] },
      ),
    ).toThrow();
  for (const policies of [
    [],
    [{ name: "*", type: "branch" }],
    [{ name: "master", type: "tag" }],
    [
      { name: "master", type: "branch" },
      { name: "main", type: "branch" },
    ],
  ])
    expect(() =>
      validateEnvironment(env(), { branch_policies: policies }),
    ).toThrow();
});
it("keeps production credentials and writes inside the approved manual master job", () => {
  const text = readFileSync(".github/workflows/web-release.yml", "utf8");
  expect(text).toContain("workflow_dispatch:");
  expect(text).not.toMatch(/^  (push|release|pull_request|workflow_run):/m);
  expect(text).toContain("github.ref == 'refs/heads/master'");
  expect(text).toContain("environment: webapp-production");
  expect(text).toContain("cancel-in-progress: false");
  expect(text).toContain("id-token: write");
  expect(text.indexOf("Revalidate after approval")).toBeLessThan(
    text.indexOf("aws-actions/configure-aws-credentials"),
  );
  expect(text.indexOf("Private rollback snapshot")).toBeLessThan(
    text.indexOf("Upload approved artifact"),
  );
  expect(text).toContain('--expect-commit "$SOURCE_COMMIT"');
  expect(text).toContain("if: always()");
  expect(text).not.toMatch(/contents: write|pull-requests: write/);
});
it("rejects corrupted downloaded archive bytes instead of accepting an action warning", async () => {
  const { assertArchiveDigest } = guard;
  const { createHash } = await import("node:crypto");
  const bytes = Buffer.from("archive");
  const hash = "sha256:" + createHash("sha256").update(bytes).digest("hex");
  expect(() => assertArchiveDigest(bytes, hash)).not.toThrow();
  expect(() => assertArchiveDigest(Buffer.from("modified"), hash)).toThrow(
    /SHA256/,
  );
});
