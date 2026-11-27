-- GoogleSQL. Replace PROJECT.DATASET; @start_date/@end_date DATE, @app_version STRING.
-- Installation cohort, not a person/account cohort. Only complete D1/D7 windows are reported.
WITH raw AS (
  SELECT PARSE_DATE('%Y%m%d', event_date) AS date, event_timestamp, event_name, user_pseudo_id, is_active_user, platform,
    app_info.version AS app_version,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'traffic_type') AS traffic_type,
    (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'debug_mode') AS debug_mode
  FROM `PROJECT.DATASET.events_*`
  WHERE _TABLE_SUFFIX BETWEEN FORMAT_DATE('%Y%m%d', @start_date) AND FORMAT_DATE('%Y%m%d', DATE_ADD(@end_date, INTERVAL 7 DAY))
    AND app_info.id = 'net.wizardfactory.todayweather' AND app_info.version = @app_version
), untagged_versions AS (
  -- Native builds made before #3228 never send traffic_type=internal, so a team device running one is found by its
  -- events before that version's public store release (KST; docs/operations/monetization.md lists each source).
  -- released_at NULL: not released, every event is pre-release. Add every further build made before #3228 and set
  -- released_at when it ships; builds from #3228 on tag themselves. Keep the three queries' lists identical.
  SELECT 'ANDROID' AS platform, '2.0.0' AS version, TIMESTAMP '2026-11-20 17:00:00+09' AS released_at
  UNION ALL SELECT 'ANDROID', '2.0.1', TIMESTAMP '2026-11-24 13:39:00+09'
  UNION ALL SELECT 'IOS', '2.0.1', TIMESTAMP '2026-11-21 00:00:00+09'
  UNION ALL SELECT 'IOS', '2.0.2', TIMESTAMP '2026-11-24 10:48:00+09'
  UNION ALL SELECT 'IOS', '2.0.3', CAST(NULL AS TIMESTAMP)
  UNION ALL SELECT 'IOS', '2.0.4', CAST(NULL AS TIMESTAMP)
), excluded AS (
  -- Development or internal traffic, debug mode, or an event of an untagged version before its release.
  SELECT DISTINCT r.user_pseudo_id FROM raw r
  LEFT JOIN untagged_versions u ON u.platform = r.platform AND u.version = r.app_version
  WHERE r.traffic_type IN ('development', 'internal') OR r.debug_mode = 1
    OR (u.version IS NOT NULL AND (u.released_at IS NULL OR TIMESTAMP_MICROS(r.event_timestamp) < u.released_at))
), clean AS (
  SELECT * FROM raw WHERE user_pseudo_id IS NOT NULL
    AND user_pseudo_id NOT IN (SELECT user_pseudo_id FROM excluded WHERE user_pseudo_id IS NOT NULL)
), cohorts AS (
  SELECT user_pseudo_id, platform, MIN(date) AS cohort_date FROM clean
  WHERE event_name = 'first_open' GROUP BY user_pseudo_id, platform
), users AS (
  SELECT c.*,
    COUNTIF(a.is_active_user AND a.date = DATE_ADD(c.cohort_date, INTERVAL 1 DAY)) > 0 AS retained_d1,
    COUNTIF(a.is_active_user AND a.date = DATE_ADD(c.cohort_date, INTERVAL 7 DAY)) > 0 AS retained_d7
  FROM cohorts c LEFT JOIN clean a USING (user_pseudo_id, platform)
  WHERE c.cohort_date BETWEEN @start_date AND @end_date GROUP BY c.user_pseudo_id, c.platform, c.cohort_date
)
SELECT cohort_date, platform, COUNT(*) AS installations,
  IF(DATE_ADD(cohort_date, INTERVAL 1 DAY) < CURRENT_DATE('Asia/Seoul'), AVG(IF(retained_d1, 1.0, 0.0)), NULL) AS d1_retention,
  IF(DATE_ADD(cohort_date, INTERVAL 7 DAY) < CURRENT_DATE('Asia/Seoul'), AVG(IF(retained_d7, 1.0, 0.0)), NULL) AS d7_retention
FROM users GROUP BY cohort_date, platform ORDER BY cohort_date, platform;
