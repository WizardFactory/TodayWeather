# PWA user manual

[Read the seven-page PDF](user-manual.pdf). The [editable JSON](user-manual.json) contains the same instructions; [scenario screenshots and provenance](manual-images/provenance.json) come from the actual static PWA using synthetic weather data.

The manual covers display preferences, hourly comparison, daily ranges, air information, enlarged text, saved browser data and clean-checkout reproduction. Its S1–S7 scenarios match the [adoption plan](../../plans/pwa-design-adoption.md). Missing values remain dashes; timestamps and stale-data warnings remain visible. Browser text size is independent of system text size. The accepted iOS system comparison is 23pt / 17pt (about135%), while the PWA control offers exactly130%.

## Reproduce

Use Node >=22.12 and locked dependencies. Build before capturing:

```bash
npm ci
npm run typecheck
npm test
npm run build:web
node scripts/verification/pwa-manual-capture.mjs
```

Capture uses installed Playwright Chromium, a loopback static server and fixture responses. It blocks external traffic. The capture context bypasses CSP for Playwright's screenshot injection; the separate browser matrix enforces the shipped CSP. No personal locations or live observations are captured.

Install ReportLab in an isolated Python environment, then render:

```bash
python scripts/verification/pwa-manual-pdf.py
```

The source and selected screenshots are maintained deliverables. After updates, rasterize and inspect every PDF page for clipping, readable text and correct screenshots. Preserve the image digests in the provenance file. See [testing](testing.md) and the [physical comparison](../design-system/physical-pwa-comparison.md) for the limits of automated and device evidence.
