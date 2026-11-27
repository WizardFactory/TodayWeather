-- GoogleSQL. Replace PROJECT.DATASET; @start_date/@end_date DATE, @app_version STRING.
-- Installation cohort, not a person/account cohort. Only complete D1/D7 windows are reported. Exclusions read every
-- version and every daily table, so an installation excluded on another version is dropped too; cohorts count
-- @app_version.
WITH raw AS (
  SELECT PARSE_DATE('%Y%m%d', event_date) AS date, event_name, user_pseudo_id, is_active_user, platform,
    app_info.version AS app_version
  FROM `PROJECT.DATASET.events_*`
  WHERE _TABLE_SUFFIX BETWEEN FORMAT_DATE('%Y%m%d', @start_date) AND FORMAT_DATE('%Y%m%d', DATE_ADD(@end_date, INTERVAL 7 DAY))
    AND app_info.id = 'net.wizardfactory.todayweather'
), release_dates AS (
  -- Public (production) release of each native version (KST; docs/operations/monetization.md gives each source). NULL:
  -- not released (internal or open testing, TestFlight). Add every native version when its first build is distributed
  -- and set released_at when it ships (release step in docs/operations/android-release.md and ios/README.md); a version
  -- missing here is not checked. Keep the three queries' lists identical (client/test/monetization.test.cjs).
  SELECT 'ANDROID' AS platform, '2.0.0' AS version, TIMESTAMP '2026-11-20 17:00:00+09' AS released_at
  UNION ALL SELECT 'ANDROID', '2.0.1', TIMESTAMP '2026-11-24 13:39:00+09'
  UNION ALL SELECT 'IOS', '2.0.1', TIMESTAMP '2026-11-21 00:00:00+09'
  UNION ALL SELECT 'IOS', '2.0.2', TIMESTAMP '2026-11-24 00:00:00+09'
  UNION ALL SELECT 'IOS', '2.0.3', TIMESTAMP '2026-11-25 00:05:47+09'
  UNION ALL SELECT 'IOS', '2.0.4', CAST(NULL AS TIMESTAMP)
), excluded AS (
  -- Developer and team installations, all their events dropped including native automatic events, found in every
  -- daily table since the export began (2026-10-01), whatever range the query reports: a later table can reveal a
  -- team installation for an earlier report. Daily tables only (an eight-digit suffix), not streaming ones such as
  -- events_intraday_*. Signals: development or internal traffic (the native apps tag TestFlight, Xcode and non-Play
  -- installs internal, #3228), debug mode, or an event of a listed version before its release (event time before the
  -- release time, or event date before the release day). docs/operations/monetization.md, "Team installations".
  SELECT DISTINCT e.user_pseudo_id FROM `PROJECT.DATASET.events_*` e
  LEFT JOIN release_dates u ON u.platform = e.platform AND u.version = e.app_info.version
  WHERE e._TABLE_SUFFIX >= '20261001' AND REGEXP_CONTAINS(e._TABLE_SUFFIX, r'^[0-9]{8}$')
    AND e.app_info.id = 'net.wizardfactory.todayweather' AND e.user_pseudo_id IS NOT NULL
    AND ((SELECT value.string_value FROM UNNEST(e.event_params) WHERE key = 'traffic_type') IN ('development', 'internal')
      OR (SELECT value.int_value FROM UNNEST(e.event_params) WHERE key = 'debug_mode') = 1
      OR (u.version IS NOT NULL AND (u.released_at IS NULL OR TIMESTAMP_MICROS(e.event_timestamp) < u.released_at
        OR PARSE_DATE('%Y%m%d', e.event_date) < DATE(u.released_at, 'Asia/Seoul'))))
), clean AS (
  -- An anti-join: BigQuery rejects NOT IN over a subquery that reads another table.
  SELECT r.* FROM raw r LEFT JOIN excluded x ON x.user_pseudo_id = r.user_pseudo_id
  WHERE r.user_pseudo_id IS NOT NULL AND x.user_pseudo_id IS NULL AND r.app_version = @app_version
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
