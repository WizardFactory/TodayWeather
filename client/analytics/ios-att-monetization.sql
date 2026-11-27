-- GoogleSQL. Replace PROJECT.DATASET with the linked GA4 daily export dataset.
-- Parameters: @start_date/@end_date DATE. iOS only, split by app version and ATT status (#2945).
-- att_status is a user property set by the app on iOS after the Analytics choice: authorized, denied, restricted,
-- not_determined or unavailable. Rows cover only installations with Analytics collection on (an opt-in, or the native
-- apps' region default since #2660), and builds before the
-- ATT release report '(not set)'. Impressions are the app's own `ad_lifecycle` impression events: GA4 does not export
-- the automatic AdMob `ad_impression` to BigQuery and the default integration passes no value, so revenue, eCPM,
-- match rate and show rate are not derivable here. Take them from the AdMob report by app version and serving
-- restriction (docs/operations/monetization.md). Rates divide by reporting installations (active installations that sent an
-- event carrying measurement_version, of any value type). Uses completed daily partitions only; rerun the last three days.
WITH raw AS (
  SELECT *,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'traffic_type') AS traffic_type,
    EXISTS(SELECT 1 FROM UNNEST(event_params) WHERE key = 'measurement_version') AS reporting,
    (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'debug_mode') AS debug_mode,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'action') AS action,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'ad_format') AS ad_format,
    IFNULL((SELECT value.string_value FROM UNNEST(user_properties) WHERE key = 'att_status'), '(not set)') AS att_status,
    app_info.version AS app_version
  FROM `PROJECT.DATASET.events_*`
  WHERE _TABLE_SUFFIX BETWEEN FORMAT_DATE('%Y%m%d', @start_date) AND FORMAT_DATE('%Y%m%d', @end_date)
    AND app_info.id = 'net.wizardfactory.todayweather'
    AND platform = 'IOS'
), untagged_versions AS (
  -- Native builds made before #3228 never send traffic_type=internal, so a team device running one is found by its
  -- events before that version's public store release (KST): event_timestamp before the release time, or event_date
  -- before the release day (docs/operations/monetization.md lists each source and the timestamp caveat).
  -- released_at NULL: not released, every event is pre-release. Add every further build made before #3228 and set
  -- released_at when it ships; builds from #3228 on tag themselves. Keep the three queries' lists identical.
  SELECT 'ANDROID' AS platform, '2.0.0' AS version, TIMESTAMP '2026-11-20 17:00:00+09' AS released_at
  UNION ALL SELECT 'ANDROID', '2.0.1', TIMESTAMP '2026-11-24 13:39:00+09'
  UNION ALL SELECT 'IOS', '2.0.1', TIMESTAMP '2026-11-21 00:00:00+09'
  UNION ALL SELECT 'IOS', '2.0.2', TIMESTAMP '2026-11-24 10:48:00+09'
  UNION ALL SELECT 'IOS', '2.0.3', CAST(NULL AS TIMESTAMP)
  UNION ALL SELECT 'IOS', '2.0.4', CAST(NULL AS TIMESTAMP)
), excluded AS (
  -- Exclude all events of known developer and team installations, including native automatic events: development or
  -- internal traffic, debug mode, or an event of an untagged version before its release.
  SELECT DISTINCT r.user_pseudo_id FROM raw r
  LEFT JOIN untagged_versions u ON u.platform = r.platform AND u.version = r.app_version
  WHERE r.traffic_type IN ('development', 'internal') OR r.debug_mode = 1
    OR (u.version IS NOT NULL AND (u.released_at IS NULL OR TIMESTAMP_MICROS(r.event_timestamp) < u.released_at
      OR PARSE_DATE('%Y%m%d', r.event_date) < DATE(u.released_at, 'Asia/Seoul')))
), eligible AS (
  SELECT * FROM raw
  WHERE user_pseudo_id IS NOT NULL
    AND user_pseudo_id NOT IN (SELECT user_pseudo_id FROM excluded WHERE user_pseudo_id IS NOT NULL)
), daily AS (
  SELECT event_date, app_version, att_status,
    COUNT(DISTINCT IF(is_active_user, user_pseudo_id, NULL)) AS active_installations,
    COUNT(DISTINCT IF(is_active_user AND reporting, user_pseudo_id, NULL)) AS reporting_installations,
    COUNTIF(event_name = 'ad_lifecycle' AND action = 'impression' AND ad_format = 'banner') AS banner_impressions,
    COUNTIF(event_name = 'ad_lifecycle' AND action = 'impression' AND ad_format = 'native') AS native_impressions,
    COUNTIF(event_name = 'ad_lifecycle' AND action = 'impression' AND ad_format = 'interstitial') AS interstitial_impressions,
    COUNTIF(event_name = 'ad_lifecycle' AND action = 'request' AND ad_format = 'banner') AS initial_banner_requests,
    COUNTIF(event_name = 'ad_lifecycle' AND action = 'failed' AND ad_format = 'banner') AS banner_load_failures
  FROM eligible GROUP BY event_date, app_version, att_status
)
SELECT *,
  banner_impressions + native_impressions + interstitial_impressions AS ad_impressions,
  SAFE_DIVIDE(banner_impressions + native_impressions + interstitial_impressions, reporting_installations)
    AS impressions_per_reporting_installation
FROM daily ORDER BY event_date, app_version, att_status;
