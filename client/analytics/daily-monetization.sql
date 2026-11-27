-- GoogleSQL. Replace PROJECT.DATASET with the linked GA4 daily export dataset.
-- Parameters: @start_date/@end_date DATE, @team_installations ARRAY<STRING> (the private team list; [] when empty). Reads one day past @end_date for the next-day return rate.
-- Impressions are the apps' own `ad_lifecycle` impression events, logged from the Mobile Ads SDK impression callback.
-- GA4 does not export the automatic AdMob `ad_impression` to BigQuery, and the default integration passes no
-- value, so this query reports no revenue. Take earnings from the AdMob report by platform and format
-- (docs/operations/monetization.md). Rows cover only installations with Analytics collection on.
-- Rates divide by reporting installations: active installations that sent an event carrying measurement_version
-- (any value type; iOS Cordova stores a double). Older Cordova builds (before 1.1) and sessions without the apps'
-- measurement events send automatic events only, so they count as active but cannot report impressions.
-- version_group: cordova = 1.x, native = 2.0 and later, other = older or missing versions. Uses completed daily partitions only; rerun the last three days.
WITH raw AS (
  SELECT event_date, PARSE_DATE('%Y%m%d', event_date) AS day, event_name, user_pseudo_id, is_active_user, platform,
    CASE WHEN STARTS_WITH(app_info.version, '1.') THEN 'cordova'
      WHEN SAFE_CAST(SPLIT(app_info.version, '.')[SAFE_OFFSET(0)] AS INT64) >= 2 THEN 'native'
      ELSE 'other' END AS version_group,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'traffic_type') AS traffic_type,
    EXISTS(SELECT 1 FROM UNNEST(event_params) WHERE key = 'measurement_version') AS reporting,
    (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'debug_mode') AS debug_mode,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'action') AS action,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'ad_format') AS ad_format
  FROM `PROJECT.DATASET.events_*`
  WHERE _TABLE_SUFFIX BETWEEN FORMAT_DATE('%Y%m%d', @start_date) AND FORMAT_DATE('%Y%m%d', DATE_ADD(@end_date, INTERVAL 1 DAY))
    AND app_info.id = 'net.wizardfactory.todayweather'
), release_dates AS (
  -- Public store release of each native version (KST; docs/operations/monetization.md gives each source). NULL: not
  -- released (TestFlight or other pre-release builds). Add every native build when it is first distributed and set
  -- released_at when it ships; a version missing here is not checked. Keep the three queries' lists identical.
  SELECT 'ANDROID' AS platform, '2.0.0' AS version, TIMESTAMP '2026-11-20 17:00:00+09' AS released_at
  UNION ALL SELECT 'ANDROID', '2.0.1', TIMESTAMP '2026-11-24 13:39:00+09'
  UNION ALL SELECT 'IOS', '2.0.1', TIMESTAMP '2026-11-21 00:00:00+09'
  UNION ALL SELECT 'IOS', '2.0.2', TIMESTAMP '2026-11-24 00:00:00+09'
  UNION ALL SELECT 'IOS', '2.0.3', TIMESTAMP '2026-11-25 00:05:47+09'
  UNION ALL SELECT 'IOS', '2.0.4', CAST(NULL AS TIMESTAMP)
), prerelease AS (
  -- Team installations by rule: any installation that ran a listed version before its release (event time before the
  -- release time, or event date before the release day), in every daily table since the export began (2026-10-01),
  -- whatever range the query reports: a later table can reveal a team installation for an earlier report.
  SELECT DISTINCT e.user_pseudo_id FROM `PROJECT.DATASET.events_*` e
  JOIN release_dates u ON u.platform = e.platform AND u.version = e.app_info.version
  WHERE e._TABLE_SUFFIX >= '20261001'
    AND e.app_info.id = 'net.wizardfactory.todayweather'
    AND (u.released_at IS NULL OR TIMESTAMP_MICROS(e.event_timestamp) < u.released_at
      OR PARSE_DATE('%Y%m%d', e.event_date) < DATE(u.released_at, 'Asia/Seoul'))
), excluded AS (
  -- Exclude all events of developer and team installations, including native automatic events: development traffic or
  -- debug mode in the window, the pre-release rule, and the private list @team_installations (ARRAY<STRING> of
  -- user_pseudo_id; docs/operations/monetization.md, "Team installations").
  SELECT user_pseudo_id FROM raw WHERE traffic_type = 'development' OR debug_mode = 1
  UNION DISTINCT SELECT user_pseudo_id FROM prerelease
  UNION DISTINCT SELECT id FROM UNNEST(@team_installations) AS id
), eligible AS (
  -- An anti-join: BigQuery rejects NOT IN over a subquery that reads another table.
  SELECT r.* FROM raw r LEFT JOIN excluded x ON x.user_pseudo_id = r.user_pseudo_id
  WHERE r.user_pseudo_id IS NOT NULL AND x.user_pseudo_id IS NULL
), daily AS (
  SELECT event_date, platform, version_group, ANY_VALUE(day) AS day,
    COUNT(DISTINCT IF(is_active_user, user_pseudo_id, NULL)) AS active_installations,
    COUNT(DISTINCT IF(is_active_user AND reporting, user_pseudo_id, NULL)) AS reporting_installations,
    COUNTIF(event_name = 'ad_lifecycle' AND action = 'impression' AND ad_format = 'banner') AS banner_impressions,
    COUNTIF(event_name = 'ad_lifecycle' AND action = 'impression' AND ad_format = 'native') AS native_impressions,
    COUNTIF(event_name = 'ad_lifecycle' AND action = 'impression' AND ad_format = 'interstitial') AS interstitial_impressions,
    COUNTIF(event_name = 'ad_lifecycle' AND action = 'request' AND ad_format = 'banner') AS initial_banner_requests,
    COUNTIF(event_name = 'ad_lifecycle' AND action = 'failed' AND ad_format = 'banner') AS banner_load_failures,
    COUNTIF(event_name = 'weather_load') AS weather_loads
  FROM eligible WHERE day BETWEEN @start_date AND @end_date
  GROUP BY event_date, platform, version_group
), exported_days AS (
  -- Days whose daily export table exists (table metadata, not rows: an empty table or one holding only other apps'
  -- events still counts). Needs metadata read access to the dataset.
  SELECT PARSE_DATE('%Y%m%d', SUBSTR(table_name, 8)) AS day FROM `PROJECT.DATASET.INFORMATION_SCHEMA.TABLES`
  WHERE REGEXP_CONTAINS(table_name, r'^events_[0-9]{8}$')
), active AS (
  SELECT DISTINCT day, platform, version_group, user_pseudo_id FROM eligible WHERE is_active_user
), reporting_active AS (
  SELECT DISTINCT day, platform, version_group, user_pseudo_id FROM eligible WHERE is_active_user AND reporting
), returns AS (
  -- Base: reporting installations. Returned = active again on the next day on the same platform, in either version
  -- group (an update counts), with any event.
  SELECT a.day, a.platform, a.version_group, COUNT(DISTINCT n.user_pseudo_id) AS returned_installations
  FROM reporting_active a
  LEFT JOIN (SELECT DISTINCT day, platform, user_pseudo_id FROM active) n
    ON n.platform = a.platform AND n.user_pseudo_id = a.user_pseudo_id AND n.day = DATE_ADD(a.day, INTERVAL 1 DAY)
  WHERE a.day BETWEEN @start_date AND @end_date
  GROUP BY a.day, a.platform, a.version_group
)
SELECT d.event_date, d.platform, d.version_group, d.active_installations, d.reporting_installations,
  d.banner_impressions, d.native_impressions, d.interstitial_impressions,
  d.banner_impressions + d.native_impressions + d.interstitial_impressions AS ad_impressions,
  SAFE_DIVIDE(d.banner_impressions + d.native_impressions + d.interstitial_impressions, d.reporting_installations)
    AS impressions_per_reporting_installation,
  SAFE_DIVIDE(d.banner_impressions, d.reporting_installations) AS banner_impressions_per_reporting_installation,
  SAFE_DIVIDE(d.native_impressions, d.reporting_installations) AS native_impressions_per_reporting_installation,
  SAFE_DIVIDE(d.interstitial_impressions, d.reporting_installations) AS interstitial_impressions_per_reporting_installation,
  -- NULL until the next day's daily table exists and that day has ended; late events can still raise it (rerun).
  IF(x.day IS NOT NULL AND DATE_ADD(d.day, INTERVAL 1 DAY) < CURRENT_DATE('Asia/Seoul'),
    SAFE_DIVIDE(r.returned_installations, d.reporting_installations), NULL) AS next_day_return_rate,
  d.initial_banner_requests, d.banner_load_failures, d.weather_loads
FROM daily d LEFT JOIN returns r USING (day, platform, version_group)
LEFT JOIN exported_days x ON x.day = DATE_ADD(d.day, INTERVAL 1 DAY)
ORDER BY d.event_date, d.platform, d.version_group;
