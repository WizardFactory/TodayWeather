# Correction publication contract

AK authorized correction implementation and updating existing PR #2562. Complete independent QA and pre-commit validation, commit the scoped source/tests/docs plus correction/assessment reports, push the existing feature branch, update the PR description with dispositions/current evidence, and verify CI on the published head. No merge, auto-merge, reviewer approval, thread resolution or deployment is authorized here.

The root native/legacy source trees have no diff against the pre-correction head; removing root ESM changes their loading semantics back to CommonJS. Candidate source hashes cover 65 source/test/docs files. Diagnostic runtime logs and application screenshots contain only explicit synthetic fixture data. Temporary diff snapshots, raw diagram-browser captures, test traces, build output and planning notebooks stay ignored under existing repository policy. The committed candidate plus predecessor d85960e0 permit reproduction of the actual source delta; changes.patch is a local gate input only.

Post-commit head, parent, candidate-hash match, PR state and CI run URLs will be recorded in the durable PR description after publication, without a recursive evidence-only commit. Preserve unresolved reviewer threads for reviewer examination. Issue #2558 stays open for the existing full-parity/device/provider/hosting release gates.
