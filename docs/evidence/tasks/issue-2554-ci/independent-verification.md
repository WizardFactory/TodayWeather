# Independent verification: issue-2554 CI follow-up

Verdict: PASS for the local configuration and command behavior. No mandatory findings.

Performed by the independent Codex verification agent, not the implementation owner. This is independent local verification, not formal cross-provider PR review or hosted Actions execution.

## Scope and observations

- Read the task intent, spec, plan and test plan; independently parsed YAML with PyYAML BaseLoader (preserves the GitHub `on` key).
- Checked push + pull_request events, one Ubuntu job, ten-minute timeout, Node 22, UTC, contents read, event-default checkout without persisted credentials, explicitly disabled package cache, pinned action revisions and no step/job failure suppression, conditional skip, services or deployment.
- Checked the exact dependency command: four pinned direct smoke dependencies, `--ignore-scripts`, isolated RUNNER_TEMP prefix, no server package installation. README workflow link resolves correctly; described counts and isolation match the actual suites.
- Executed the unmodified YAML regression and smoke run strings with their declared environment locally. Results: 43 regression tests and 36 synthetic full-router cases passed.
- Injected failing node (23) and npm (37) executables using a temporary PATH. All three actual run strings preserved their nonzero exit under fail-fast bash. No production source or repository files were changed by verification.
- The legacy Travis and npm test definitions remain untouched by this candidate. Separate CI avoids the legacy Node 6 runtime and deployment hook.
- Read the official action manifests at their exact pinned revisions: inputs used here are supported; both actions themselves use node24, while setup-node selects Node22 for the weather test steps. Action runtime and tested app runtime are separate.

Official manifest sources:
- https://raw.githubusercontent.com/actions/checkout/3d3c42e5aac5ba805825da76410c181273ba90b1/action.yml
- https://raw.githubusercontent.com/actions/setup-node/820762786026740c76f36085b0efc47a31fe5020/action.yml

## Limits

The verifier reused the existing temporary installation whose direct package versions were independently checked (async 2.5.0, express 4.13.4, sprintf 0.1.5, xml2js 0.4.23). It did not execute network installation or hosted checkout/setup; the implementation owner's fresh install and future hosted result are separate evidence. The smoke's configured context string is github-actions because the YAML environment was exercised verbatim; this was local emulation. No database, provider, origin, CDN, production deployment, mobile test or formal review was performed. Direct dependencies are pinned; transitive dependencies remain registry-resolved without a committed lockfile, consistent with the existing isolated smoke setup.

## Exact consumed hashes and execution evidence

```json
{
  "createdAt": "2026-09-24T03:51:21.624460+00:00",
  "head": "658605dba6cf56b90b5bba3ef9dd307438e69484",
  "runtime": "v22.22.2",
  "hashes": {
    ".github/workflows/rss-offline.yml": "84a6132154cad649bc9262b45ffc35b773ad5a500ce8763acf16ca1cdd88f448",
    "server/test/offline/README.md": "e720a0c143780d69e9131991a7f5388aefc6ec9e9942abd9d8b0ed726069fcce",
    "server/test/offline/rss-wind.test.js": "778b4e63af6a41aa478ecc00b9cdb7badd734b73b23863eb07f18618cc9efbfb",
    "server/test/offline/rss-response-smoke.js": "47fcb72dd9c95c42061d97ce24778d2cd89897d7cd93e549b3e4f4617445fb3b",
    "intent/issue-2554-ci.md": "552bf6af87f2e7e2c101f8f975acfc3220adaa15f8678f885cd2bb0ef20e9440",
    "specs/issue-2554-ci.md": "2a942a669c78ff8afefa8d98fd9e225ae4ccde5c84f732c9686ddfad06520ef6",
    "plans/issue-2554-ci.md": "b1b1bbd530bfe5c3d1eed1cc83c16a7c0e8ef31fe279ba091675889dc92416c8",
    "reports/sdlc/issue-2554-ci/test-plan.md": "bff168be7b8667bc4cb56f48783464aa949f5564f5cfac8e7cd16a24288d9f6d",
    ".travis.yml": "d48774f16c8acd1cc0075246b7e8cf13fce8a181fa90101f780291b3541b30b3",
    "server/package.json": "d535bb0ce97e438e48ce4e127a810ca5afbe8e2757a91e3033092698a2b77088"
  },
  "checks": [
    {
      "step": "RSS regression tests",
      "command": "node server/test/offline/rss-wind.test.js",
      "exitCode": 0,
      "log": "/tmp/issue-2554-ci-independent-dxg0m_oh/step-2.log"
    },
    {
      "step": "Full RSS response smoke",
      "command": "node server/test/offline/rss-response-smoke.js",
      "exitCode": 0,
      "log": "/tmp/issue-2554-ci-independent-dxg0m_oh/step-4.log"
    },
    {
      "step": "RSS regression tests",
      "check": "nonzero command status propagates",
      "injectedExit": 23,
      "exitCode": 23
    },
    {
      "step": "Install isolated smoke dependencies",
      "check": "nonzero command status propagates",
      "injectedExit": 37,
      "exitCode": 37
    },
    {
      "step": "Full RSS response smoke",
      "check": "nonzero command status propagates",
      "injectedExit": 23,
      "exitCode": 23
    }
  ],
  "verdict": "PASS"
}
```
