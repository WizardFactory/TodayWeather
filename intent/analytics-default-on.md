# Intent: usage analytics on by default outside the opt-in regions

## Source and authority

- AK, 2026-11-24: usage analytics (Firebase Analytics / GA4) in the native apps changes from "off until the user opts in" to "on by default", under the rules recorded in the [spec](../specs/analytics-default-on.md). AK accepted the recommended rules as given: the region rule, the stored choice winning (a stored `"false"` stays off), the consent signals, nothing collected before the decision, the menu and popup texts, and the backup, hand-back and upgrade semantics.
- Refs #2660 (terms, privacy policy, consent and store disclosures). The Android implementation is the first pull request; the iOS app follows in its own pull request against the same spec.

Mode: implementation. Endpoint for the Android pull request: **pre-merge** (no merge, release, signing, upload or Play Console action).

## Problem

Since AN-15 (#2894) the native Android app collects usage analytics only after an explicit opt-in on the menu's 선택적 이용 통계, as the Cordova build did. Usage data to judge weather loads, screens and ad changes by therefore comes only from users who find that row and allow it.

## Desired outcome

Outside the EEA, the United Kingdom and Switzerland, a user who has not chosen gets usage analytics from the first start, can see that it is on in the menu, and can turn it off there for good. In those regions, and when the region is unknown, nothing changes: collection waits for consent. A choice the user made is never overridden by the default, and nothing is collected before the app has decided.

## Constraints

- Advertising use stays denied: ad storage, ad user data and ad personalization are denied in every case.
- The rule must be portable: a plain list and a pure function the iOS app can mirror and test the same way.
- The Cordova app (`client/`) is not changed; native texts that differ from the imported Cordova catalogs live in native resources.
- Out of scope for the implementation pull requests: the privacy policy pages, store data-safety and privacy declarations, and operations documents, which the coordinator updates separately before release.

## Acceptance criteria

- **ADO1** — A fresh install outside the opt-in regions collects from the first start with analytics storage granted and advertising denied, and stores no choice.
- **ADO2** — A fresh install in an opt-in region, or with an unknown region, collects nothing until the user allows it.
- **ADO3** — A stored grant collects and a stored decline stays off in every region; turning usage analytics off or on in the menu stores that choice.
- **ADO4** — Nothing is collected before the decision is applied; a failure while enabling leaves everything off.
- **ADO5** — The menu row reads "Usage analytics" with On/Off (and the five other app languages), and the popup explains the default where it applies and asks for consent in the opt-in regions.
- **ADO6** — Backup exclusion, migration and rollback hand-back keep their stored-value semantics; an absent choice means the region default.
