# Spec: usage analytics on by default outside the opt-in regions

Consumes the [intent](../intent/analytics-default-on.md) (AK, 2026-11-24; Refs #2660). This is the cross-platform contract for the native apps; each platform records its implementation in its own README. Android: [`android/README.md`](../android/README.md#ads-usage-analytics-and-crash-reports-an-15). iOS mirrors the same rule, lists and tests in its own pull request.

## Terms

- **Stored choice**: the value the app keeps under `twAnalyticsConsentV1`: `"true"`, `"false"` or none. Only the user's choice in the menu and the existing failure fallbacks write it. `"false"` therefore means a decline or a failure fallback; both stay off.
- **Device region**: the region of the device's system locale (the first system locale), as an ISO 3166-1 alpha-2 code. It is not the app's own language choice. Android reads `Resources.getSystem().configuration.locales[0].country`.
- **Opt-in regions**: the EEA, the United Kingdom and Switzerland, as the region codes in [Region list](#region-list).
- **Decision**: whether the app collects in this process, made once at the start before the analytics SDK may collect.

## Rule

1. The choice is read only through the platform's preference API. A stored `"true"` collects; any other stored value (`"false"`, a value the app never writes) or a read error does not collect. A stored `"true"` counts only while the app's own record of the SDK's collection state confirms it (Android AN-15; otherwise it is rewritten as `"false"`, a failure fallback).
   **Withdrawal.** A withdrawal stops the SDK and denies every consent type, then writes `"false"` (see the order of writes below for SDK errors). If that write fails, collection stays off for the rest of the session and the save-failed notice is shown; the stored value stays as it was (an old grant is then withdrawn at the next start by the collection-state check above). A grant that cannot be written also keeps the previous stored value.
2. Without a stored choice, the device region decides: collect when the region is a known region outside the opt-in regions; otherwise do not collect.
3. A region is known when, after trimming, it is two ASCII letters (in any case) that form one of the 249 officially assigned ISO 3166-1 alpha-2 codes. An empty or missing region, a UN M.49 number (`150`, `419`), and reserved or user-assigned codes (`EU`, `UK`, `EL`, `IC`, `EA`, `XK`, `XA`, `ZZ` …) are unknown and keep the opt-in.
4. Applying the region default writes no choice record, so the stored values keep meaning "the user chose". Recording the SDK's collection state (the flag that tells the next start whether collection was on) is allowed. The region is evaluated again at each start while no choice is stored.

### Scope of the guarantee (coordinator decision, 2026-11-24)

- Failure or corruption of the app's private preference storage is outside the guarantee. Android loads a damaged preference file as empty, which reads as "no choice", so the region default may apply; a withdrawal whose `"false"` cannot be persisted before the process ends may likewise give way to the region default at the next start. Both are accepted, documented residuals.
- The Cordova hand-back and fallback path is historical: releases no longer consider Cordova compatibility (AK, 2026-11-24). It keeps compiling and its existing behavior, with no new guarantee.
- The design reads and writes the choice only through the platform's preference API; it does not parse preference files itself or keep extra recovery records.

The same check as a function, in the order the apps apply it. `stored` is the value after the collection-state check: a stored `"true"` that the collection-state record does not confirm has already been read as `"false"`.

```
collects(stored, region) = stored == "true"                      if stored is present
                         = known(region) and region ∉ OPT_IN     otherwise
```

### Region list

The opt-in regions (39 codes):

| Group | Codes |
| --- | --- |
| EU member states (27) | AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE |
| EU territories with their own ISO code | GF (French Guiana), GP (Guadeloupe), MQ (Martinique), RE (Réunion), YT (Mayotte), MF (Saint-Martin), AX (Åland Islands) |
| Other EEA states | IS LI NO |
| United Kingdom, Switzerland | GB CH |

The EU territories are part of the EU and so of the EEA; listing their codes keeps a device set to, for example, `fr-RE` in the opt-in. **Decided (AK, 2026-11-24): the seven EU territory codes stay in the opt-in list.** Territories outside the EU with their own code (for example GL, FO, SJ, BL, PM, NC, PF), the Crown dependencies (GG, JE, IM) and Gibraltar (GI) are known regions outside the list and are on by default.

## Consent signals and order

- **Collecting**: analytics storage granted; ad storage, ad user data and ad personalization denied.
- **Not collecting**: all four denied; collection disabled.
- **Nothing before the decision** (AK's rule 4): the SDK's own collection stays disabled until the decision is applied (manifest or plist default off, the SDK's persisted collection flags cleared before the SDK starts), so nothing is collected before it. The manifest's consent defaults are denied; consent signals an earlier run set through the API may persist in the SDK until the decision replaces them. On Android the decision is applied in `EarlyStartProvider`, which runs before `FirebaseInitProvider`; the app's first SDK call there initializes measurement, and the decision replaces the signals before collection is enabled. The SDK's intake of TCF consent strings is turned off (`google_analytics_tcf_data_enabled` false), so an advertising consent form cannot overwrite the denied ad storage, ad user data and ad personalization. The app disables collection, sets all four consent signals and, when collecting, enables collection.
- **Failure**: a failure while enabling leaves collection disabled and every type denied. When the value came from a stored or chosen value the app stores `"false"` (as before); when it came from the region default it stores nothing, so the next start applies the default again.
- **Order of writes**: when collecting, the app records the collection state before it lets the SDK collect; on a withdrawal or a failure it first asks the SDK to stop collecting and to deny every type, then writes the choice. An SDK error at that first step does not hold the withdrawal back: `"false"` is still written, and the decision is applied again after the write, which shows the save-failed notice if the SDK still fails.

## Menu and popup

- Row label: "Usage analytics" (en), "이용 통계" (ko), "利用状況分析" (ja), "Nutzungsanalyse" (de), "使用情况分析" (zh-CN), "使用情況分析" (zh-TW), with the state On/Off (켜짐/꺼짐, オン/オフ, An/Aus, 已开启/已关闭, 已開啟/已關閉) of the current decision.
- Popup where the device region is on by default: it says what is collected, that usage analytics stays on unless the user turns it off in this menu, and that weather works either way; buttons Turn off / Turn on. Turning it off stores `"false"`, turning it on stores `"true"`.
- Popup in the opt-in regions (and for an unknown region): the existing consent question with Decline / withdraw and Allow; the title is the row label. Allow stores `"true"`, Decline / withdraw stores `"false"`. The consent text and buttons are shown in the app language with no English fallback: English, Korean and Japanese keep the Cordova wording; German, Simplified Chinese and Traditional Chinese translate it with the same meaning (decided by AK, 2026-11-24).
- Back closes the popup without a choice (Android only). A failed save shows the existing "could not fully apply" alert and leaves collection off.
- **iOS** (coordinator decision, 2026-11-24, CODEX-3187-11): the popup closes only through its two buttons; there is no Back button and no close without a choice, as in the Cordova iOS build. A choice that matches the current state (Turn on in a default-on region, Decline / withdraw in an opt-in region) changes nothing the user sees, but it is stored as the user's choice.

## Backup, migration, rollback and upgrade

- The stored choice and the SDK state stay excluded from backup and device transfer; after a restore no choice is stored, so the region default applies.
- An update from the Cordova app carries no choice (the Cordova choice was only in WebView storage), so the region default applies.
- Rollback hand-back (Android AN-17): historical (see the scope above); the handed-back text is the stored value (`"true"`, `"false"` or none), as before; an absent choice means "region default" in the native app and "off" in the fallback Cordova build. A native grant stands at the start only while the suite's choice says `"true"` once anything was handed over (unchanged). Without a native stored choice no suite choice is adopted: the suite is backed up and the native choice is not, so a suite value (under a native or a fallback build's marker) cannot be told apart from an old device's choice after a restore, which must leave the region default. Consequence: a withdrawal made in a fallback build while the native app had no stored choice is not carried back (as a grant made there is not); the region default applies again. This is a known limitation of the rollback path.

### Declines that are not carried over (decided, AK 2026-11-24)

A decline the native app cannot see, a Cordova 1.1.1 decline kept only in WebView storage or a withdrawal made in the Cordova fallback build while the native app had no stored choice, gets the region default. There is no migration of it and no new consent prompt.

## User scenarios

| ID | User and goal | Prerequisites | Steps | Expected | Failure path | AC |
| --- | --- | --- | --- | --- | --- | --- |
| ADO-US1 | Korean user installs the app | System region KR, no stored choice | Open the app; open the menu | Collection on from the first start; row "이용 통계 · 켜짐"; nothing stored | SDK failure while enabling: everything off, nothing stored, next start tries again | ADO1, ADO4 |
| ADO-US2 | German user installs the app | System region DE | Open the app; open 이용 통계 / Nutzungsanalyse | Nothing collected; row shows Off; the popup asks for consent | – | ADO2, ADO5 |
| ADO-US3 | Korean user turns usage analytics off | ADO-US1 | Menu → 이용 통계 → 끄기; restart the app | Collection stops at once; `"false"` stored; still off after the restart | Save fails: alert, collection off | ADO3, ADO5 |
| ADO-US4 | German user allows usage analytics | ADO-US2 | Menu → popup → Allow; restart | Collection on; `"true"` stored; on after the restart | Save fails: alert, collection off | ADO3 |
| ADO-US5 | User with an unknown region | System locale without a region (for example `en`) or `es-419` | Open the app | Nothing collected; consent popup | – | ADO2 |
| ADO-US6 | User restores a backup on a new phone | Backup from a device with a stored choice | Restore; open the app | No stored choice; the region default applies | – | ADO6 |
| ADO-US7 | User returns from a rollback build | Native grant handed back; the fallback Cordova build withdrew analytics | Install the native app again; open it | Off; `"false"` stored natively (unchanged AN-17 rule) | No native choice before the rollback: the region default applies (known limitation) | ADO6 |
| ADO-US8 | Korean user turns usage analytics off while storage fails | ADO-US1; the choice file cannot be written | Menu → 끄기; restart | Alert; off now; an old grant is withdrawn at the next start by the collection-state check | No stored grant and the withdrawal cannot be written before the process ends: the region default may apply at the next start (accepted residual) | ADO3, ADO4 |

## Verification

- Pure-function tests of the rule: the exact opt-in list, the known-region list equal to the platform's ISO country list, all 676 two-letter combinations in both cases, unknown forms, and the stored-choice table (Android: `AnalyticsDefaultTest` in core-domain).
- Start, choice, failure and consent-signal tests with an SDK double (Android: `AnalyticsTest`), menu and popup tests in both regimes, and hand-back tests.
- A device check: a fresh install with a KR system region enables collection; a DE region does not until allowed; turning it off holds after a restart.
