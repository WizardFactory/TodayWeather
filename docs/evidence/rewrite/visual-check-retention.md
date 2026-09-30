# Archify visual-check artifact retention

## What the installed skill actually defines

Inspected 2026-09-23: Archify SKILL.md, references/delivery-contract.md (Automated browser evidence, lines27–56), and bin/visual-check.mjs (sidecarPaths, lines59–74). The installed skill is at /Users/ak/.codex/skills/archify; that machine path is a provenance reference, not a project dependency.

For each delivered HTML, visual-check writes four PNG screenshots, one relative-image HTML contact sheet and one JSON browser receipt. The receipt records the inspected artifact hash/size, automated measurements and a visual-review status that remains pending until separate perceptual review. These outputs do not modify or supply content to the delivered inline-SVG HTML. This naming/behavior applies across diagram types.

The skill requires truthful artifact/browser/perceptual evidence and reporting; it does **not** mandate Git inclusion or Git exclusion. Calling all these files disposable by skill requirement would be inaccurate, especially for the JSON evidence receipt.

## Policy chosen for this repository

At the user's request, all raw visual-check outputs are local-only regardless of directory/type/extension. Canonical sidecars and renamed copies are untracked, preserved locally, and may instead be retained as CI artifacts. Authored verification summaries and hashes remain in Markdown. Editable diagram JSON, delivered main HTML, and separate validate/deliver receipts remain versioned. App screenshot PNGs are intentional deliverables and remain versioned.

The global naming rules cover `*.visual-check*`, `*-visual-check.*` and `visual-check.*`. Specific rules cover existing renamed raw receipts identified by `command: visual-check` or `evidenceKind: automated-browser`, including historical revision directories; those are not identified merely by the word browser in their filename.

## Audit and checks

- Content inspection identified26 tracked raw browser JSON receipts:9 canonical sidecars and17 renamed copies (2 rewrite receipts plus15 historical report copies).
- All26 were removed from the index with local files preserved. Previously excluded9 contact-sheet HTML and8 renamed PNG copies remain local-only.
- Artifact validation/delivery receipts were not classified as visual-check receipts.
- Remaining source/HTML assets and app screenshots are checked separately by the package validator.
- Git exclusion does not undo historical verification, but a fresh checkout cannot inspect the raw evidence files without rerunning the check or retrieving an archived artifact. Old written summaries are dated observations, not new verification claims.
