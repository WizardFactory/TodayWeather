-- GoogleSQL. Replace PROJECT.DATASET with the linked GA4 daily export dataset.
-- Parameters: @start_date/@end_date DATE. Reads one day past @end_date for the next-day return rate.
-- Impressions are the apps' own `ad_lifecycle` impression events, logged from the Mobile Ads SDK impression callback.
-- GA4 does not export the automatic AdMob `ad_impression` to BigQuery, and the default integration passes no
-- value, so this query reports no revenue. Take earnings from the AdMob report by platform and format
-- (docs/operations/monetization.md). Rows cover only installations with Analytics collection on.
-- version_group: cordova = 1.x, native = 2.0 and later, other = older or missing versions. Uses completed daily partitions only; rerun the last three days.
WITH raw AS (
  SELECT event_date, PARSE_DATE('%Y%m%d', event_date) AS day, event_name, user_pseudo_id, is_active_user, platform,
    CASE WHEN STARTS_WITH(app_info.version, '1.') THEN 'cordova'
      WHEN SAFE_CAST(SPLIT(app_info.version, '.')[SAFE_OFFSET(0)] AS INT64) >= 2 THEN 'native'
      ELSE 'other' END AS version_group,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'traffic_type') AS traffic_type,
    (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'debug_mode') AS debug_mode,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'action') AS action,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'ad_format') AS ad_format
  FROM `PROJECT.DATASET.events_*`
  WHERE _TABLE_SUFFIX BETWEEN FORMAT_DATE('%Y%m%d', @start_date) AND FORMAT_DATE('%Y%m%d', DATE_ADD(@end_date, INTERVAL 1 DAY))
    AND app_info.id = 'net.wizardfactory.todayweather'
), excluded AS (
  -- Exclude all events for known developer installations, including native automatic events.
  SELECT DISTINCT user_pseudo_id FROM raw WHERE traffic_type = 'development' OR debug_mode = 1
), eligible AS (
  SELECT * FROM raw
  WHERE user_pseudo_id IS NOT NULL
    AND user_pseudo_id NOT IN (SELECT user_pseudo_id FROM excluded WHERE user_pseudo_id IS NOT NULL)
), daily AS (
  SELECT event_date, platform, version_group, ANY_VALUE(day) AS day,
    COUNT(DISTINCT IF(is_active_user, user_pseudo_id, NULL)) AS active_installations,
    COUNTIF(event_name = 'ad_lifecycle' AND action = 'impression' AND ad_format = 'banner') AS banner_impressions,
    COUNTIF(event_name = 'ad_lifecycle' AND action = 'impression' AND ad_format = 'native') AS native_impressions,
    COUNTIF(event_name = 'ad_lifecycle' AND action = 'impression' AND ad_format = 'interstitial') AS interstitial_impressions,
    COUNTIF(event_name = 'ad_lifecycle' AND action = 'request' AND ad_format = 'banner') AS initial_banner_requests,
    COUNTIF(event_name = 'ad_lifecycle' AND action = 'failed' AND ad_format = 'banner') AS banner_load_failures,
    COUNTIF(event_name = 'weather_load') AS weather_loads
  FROM eligible WHERE day BETWEEN @start_date AND @end_date
  GROUP BY event_date, platform, version_group
), exported_days AS (
  -- Days whose daily export table exists, whatever app or stream its rows belong to.
  SELECT DISTINCT PARSE_DATE('%Y%m%d', _TABLE_SUFFIX) AS day FROM `PROJECT.DATASET.events_*`
  WHERE _TABLE_SUFFIX BETWEEN FORMAT_DATE('%Y%m%d', @start_date) AND FORMAT_DATE('%Y%m%d', DATE_ADD(@end_date, INTERVAL 1 DAY))
), active AS (
  SELECT DISTINCT day, platform, version_group, user_pseudo_id FROM eligible WHERE is_active_user
), returns AS (
  -- Returned = active again on the next day on the same platform, in either version group (an update counts).
  SELECT a.day, a.platform, a.version_group, COUNT(DISTINCT n.user_pseudo_id) AS returned_installations
  FROM active a
  LEFT JOIN (SELECT DISTINCT day, platform, user_pseudo_id FROM active) n
    ON n.platform = a.platform AND n.user_pseudo_id = a.user_pseudo_id AND n.day = DATE_ADD(a.day, INTERVAL 1 DAY)
  WHERE a.day BETWEEN @start_date AND @end_date
  GROUP BY a.day, a.platform, a.version_group
)
SELECT d.event_date, d.platform, d.version_group, d.active_installations,
  d.banner_impressions, d.native_impressions, d.interstitial_impressions,
  d.banner_impressions + d.native_impressions + d.interstitial_impressions AS ad_impressions,
  SAFE_DIVIDE(d.banner_impressions + d.native_impressions + d.interstitial_impressions, d.active_installations)
    AS impressions_per_active_installation,
  SAFE_DIVIDE(d.banner_impressions, d.active_installations) AS banner_impressions_per_active_installation,
  SAFE_DIVIDE(d.native_impressions, d.active_installations) AS native_impressions_per_active_installation,
  SAFE_DIVIDE(d.interstitial_impressions, d.active_installations) AS interstitial_impressions_per_active_installation,
  -- NULL until the next day's daily table exists and that day has ended; late events can still raise it (rerun).
  IF(x.day IS NOT NULL AND DATE_ADD(d.day, INTERVAL 1 DAY) < CURRENT_DATE('Asia/Seoul'),
    SAFE_DIVIDE(r.returned_installations, d.active_installations), NULL) AS next_day_return_rate,
  d.initial_banner_requests, d.banner_load_failures, d.weather_loads
FROM daily d LEFT JOIN returns r USING (day, platform, version_group)
LEFT JOIN exported_days x ON x.day = DATE_ADD(d.day, INTERVAL 1 DAY)
ORDER BY d.event_date, d.platform, d.version_group;
