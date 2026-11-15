// TodayWeather iOS ad request rule (#2945). Plain C: ios-ad-privacy.js copies this file into the generated AdMob
// plugin source, and client/test/ios-ad-privacy.test.cjs compiles and runs the same text.
// Status values are ATTrackingManagerAuthorizationStatus: 0 not determined, 1 restricted, 2 denied, 3 authorized.
#ifndef TW_AD_REQUEST_RULE_H
#define TW_AD_REQUEST_RULE_H

#define TW_ATT_UNAVAILABLE (-1L)

static inline const char *tw_att_status_name(long status) {
    switch (status) {
        case 0: return "not_determined";
        case 1: return "restricted";
        case 2: return "denied";
        case 3: return "authorized";
        default: return "unavailable";
    }
}

// gdpr_applies is IABTCF_gdprApplies and purpose_consents is IABTCF_PurposeConsents, both written by UMP. Ads are
// requested only after UMP has finished, so a value other than 1 means that UMP found no GDPR requirement. Where GDPR
// applies, personalization needs TCF purposes 1 (store or access information), 3 (personalized ads profile) and
// 4 (select personalized ads). The Ads SDK still applies its own consent checks to a personalized request.
static inline int tw_consent_allows_personalization(int gdpr_applies, const char *purpose_consents) {
    int i;
    if (gdpr_applies != 1) { return 1; }
    if (purpose_consents == 0) { return 0; }
    for (i = 0; i < 4; i++) {
        if (purpose_consents[i] == '\0') { return 0; }
        if (i != 1 && purpose_consents[i] != '1') { return 0; }
    }
    return 1;
}

// Personalized only with the user's ATT permission. Every other status keeps npa=1 and the first-party ID off.
static inline int tw_ad_request_personalized(long att_status, int gdpr_applies, const char *purpose_consents) {
    return att_status == 3 && tw_consent_allows_personalization(gdpr_applies, purpose_consents);
}

#endif
