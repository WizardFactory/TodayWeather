# TodayWeather go-to-market information

This folder is the entry point for TodayWeather go-to-market work: what the product is, which metrics are tracked, where each figure comes from and where the records are kept. The repository is public. Daily figures, review bodies and account identifiers are **not** in Git; [sources](sources.md) records where they are.

| Document | Content |
| --- | --- |
| [Product context](product.md) | What the app is, who uses it and how the stores describe it. Read this first. |
| [Metrics](metrics.md) | Definition, source, day boundary and publication delay of each tracked figure. |
| [Sources and locations](sources.md) | Where records, credentials and consoles are, and what each source needs. |
| [GTM log](log.md) | Dated releases, listing changes, access changes and experiments. |
| [Store listing](listing/README.md) | Where the listing texts live and what was observed live. |
| [Research index](research/README.md) | Existing market, review and landing documents. |

Work is tracked in [#3145](https://github.com/WizardFactory/TodayWeather/issues/3145); the delivery plan is [plans/gtm.md](../plans/gtm.md) and the rules are in the [specification](../specs/gtm.md).

## Answering the daily question

The question is: per-store downloads, ad earnings, and review and rating changes for the latest day.

1. Read [metrics](metrics.md) for each source's day boundary and delay. Report the latest complete day per source with its date. The sources do not share one "yesterday".
2. Read the records in the private bucket named in [sources](sources.md), under the key layout described there.
3. Name every source without a record for that day and give its reason. Do not write or report a zero in its place.

## State on 2026-11-24

- Every planned source answered with the prepared credentials on 2026-11-24. App Store analytics reports still need an Admin key to be requested once. See [sources](sources.md).
- The private bucket exists and is empty. Collectors, the brief and the schedule are built on the Hermes host from another workspace; [sources](sources.md#running-on-another-host) lists what that host needs.
