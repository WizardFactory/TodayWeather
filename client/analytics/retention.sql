-- GoogleSQL. Replace PROJECT.DATASET; @start_date/@end_date DATE, @app_version STRING.
-- Installation cohort, not a person/account cohort. Only complete D1/D7 windows are reported.
WITH raw AS (
  SELECT PARSE_DATE('%Y%m%d', event_date) AS date, event_name, user_pseudo_id, is_active_user, platform,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'traffic_type') AS traffic_type
  FROM `PROJECT.DATASET.events_*`
  WHERE _TABLE_SUFFIX BETWEEN FORMAT_DATE('%Y%m%d', @start_date) AND FORMAT_DATE('%Y%m%d', DATE_ADD(@end_date, INTERVAL 7 DAY))
    AND app_info.id = 'net.wizardfactory.todayweather' AND app_info.version = @app_version
), clean AS (
  SELECT * FROM raw WHERE user_pseudo_id IS NOT NULL AND user_pseudo_id NOT IN (
    SELECT user_pseudo_id FROM raw WHERE traffic_type = 'development' AND user_pseudo_id IS NOT NULL
  )
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
