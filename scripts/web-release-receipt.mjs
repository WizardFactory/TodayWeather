/** Sanitized rollout record. Publication remains untouched; no GitHub writes. */
import { readFile, writeFile } from "node:fs/promises";
let manifest = {
  sourceCommit: process.env.SOURCE_COMMIT,
  tag: process.env.RELEASE_TAG,
};
try {
  manifest = JSON.parse(await readFile("approved/candidate.json", "utf8"));
} catch {
  /* interrupted before candidate download */
}
let smoke;
try {
  smoke = JSON.parse(
    await readFile("test-results/web-live-smoke.json", "utf8"),
  );
} catch {
  /* interrupted before smoke */
}
const status =
  process.env.JOB_STATUS === "success" && process.env.SMOKE_STATUS === "success"
    ? "deployed"
    : process.env.JOB_STATUS === "cancelled"
      ? "pending"
      : "failed";
const receipt = {
  schemaVersion: 1,
  target: "webapp",
  publication: "published",
  deploymentStatus: status,
  sourceCommit: manifest.sourceCommit,
  tag: manifest.tag,
  releaseId: manifest.releaseId,
  buildRunId: manifest.buildRunId,
  artifactId: manifest.artifactId,
  artifactDigest: manifest.artifactDigest,
  rollbackReference: manifest.rollbackReference,
  snapshotId: process.env.WEB_SNAPSHOT_ID,
  snapshotComplete: process.env.SNAPSHOT_STATUS === "success",
  runUrl: process.env.RUN_URL,
  checkedAt: new Date().toISOString(),
  smokeRecorded: Boolean(smoke),
  operatorReconciliationRequired: status !== "deployed",
};
await writeFile(
  "test-results/rollout.json",
  JSON.stringify(receipt, null, 2) + "\n",
);
console.log(`Rollout ${status}; publication is separate. ${receipt.runUrl}`);
