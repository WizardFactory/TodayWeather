-- GoogleSQL. Replace PROJECT.DATASET with the linked GA4 daily export dataset.
-- Parameters: @start_date/@end_date DATE. iOS only, split by app version and ATT status (#2945).
-- att_status is a user property set by the app on iOS after the Analytics choice: authorized, denied, restricted,
-- not_determined or unavailable. Rows cover only installations that opted in to Analytics, and builds before the
-- ATT release report '(not set)'. Match rate and show rate are not derivable here: SDK refresh requests are not
-- observed by the app. Take them from the AdMob report by app version and serving restriction
-- (docs/operations/monetization.md). Uses completed daily partitions only; rerun the last three days.
WITH raw AS (
  SELECT *,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'traffic_type') AS traffic_type,
    (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'debug_mode') AS debug_mode,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'action') AS action,
    IFNULL((SELECT value.string_value FROM UNNEST(user_properties) WHERE key = 'att_status'), '(not set)') AS att_status,
    app_info.version AS app_version
  FROM `PROJECT.DATASET.events_*`
  WHERE _TABLE_SUFFIX BETWEEN FORMAT_DATE('%Y%m%d', @start_date) AND FORMAT_DATE('%Y%m%d', @end_date)
    AND app_info.id = 'net.wizardfactory.todayweather'
    AND platform = 'IOS'
), excluded AS (
  -- Exclude all events for known developer installations, including native automatic ads.
  SELECT DISTINCT user_pseudo_id FROM raw WHERE traffic_type = 'development' OR debug_mode = 1
), eligible AS (
  SELECT * FROM raw
  WHERE user_pseudo_id IS NOT NULL
    AND user_pseudo_id NOT IN (SELECT user_pseudo_id FROM excluded WHERE user_pseudo_id IS NOT NULL)
), daily AS (
  SELECT event_date, app_version, att_status,
    COUNT(DISTINCT IF(is_active_user, user_pseudo_id, NULL)) AS dau,
    COUNTIF(event_name = 'ad_impression') AS ad_impressions,
    COUNTIF(event_name = 'ad_impression' AND event_value_in_usd IS NOT NULL) AS valued_impressions,
    SUM(IF(event_name = 'ad_impression', event_value_in_usd, NULL)) AS estimated_revenue_usd,
    COUNTIF(event_name = 'ad_lifecycle' AND action = 'request') AS initial_banner_requests,
    COUNTIF(event_name = 'ad_lifecycle' AND action = 'failed') AS banner_load_failures
  FROM eligible GROUP BY event_date, app_version, att_status
)
SELECT *,
  SAFE_DIVIDE(estimated_revenue_usd * 1000, ad_impressions) AS estimated_ecpm_usd,
  SAFE_DIVIDE(estimated_revenue_usd, dau) AS estimated_arpdau_usd,
  SAFE_DIVIDE(valued_impressions, ad_impressions) AS revenue_value_coverage
FROM daily ORDER BY event_date, app_version, att_status;
