"""Project a complete 24-hour shadow rehearsal onto the seven-day allocation plan."""

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass


HOUR = 3600
DAY = 24 * HOUR
PLAN_DAYS = 7


@dataclass(frozen=True)
class HourSample:
    """One verified elapsed hour with UTC epoch bounds `[start, end)`.

    The collector adapter validates sample coverage and clock continuity before
    building these rows. Counters are per-hour increments in integral units.
    Peaks are observed maxima for stock measurements such as RSS or disk use.
    """

    start: int
    end: int
    counters: Mapping[str, int]
    peaks: Mapping[str, int]


def _validate_metrics(values, expected):
    if not isinstance(values, Mapping) or values.keys() != expected:
        raise ValueError('hourly metric names must match across all 24 hours')
    if any(not isinstance(name, str) or not name.strip() or type(value) is not int or value < 0
           for name, value in values.items()):
        raise ValueError('each hourly metric needs a name and a nonnegative integer value')


def _day_windows(samples, metric, offset):
    windows = {}
    for sample in samples:
        start = ((sample.start + offset) // DAY) * DAY - offset
        count = sample.counters[metric]
        while start < sample.end:
            overlap = min(sample.end, start + DAY) - max(sample.start, start)
            window = windows.setdefault(start, dict(start_utc=start, observed_seconds=0, count_lower=0, count_upper=0))
            window['observed_seconds'] += overlap
            window['count_upper'] += count
            # Hourly totals cannot locate events within a bin that straddles midnight.
            if overlap == HOUR:
                window['count_lower'] += count
            start += DAY
    return list(windows.values())


def project_week(
    samples: Sequence[HourSample],
    *,
    allocation_metrics: Iterable[str] = (),
    daily_offsets_hours: Mapping[str, int] | None = None,
) -> dict:
    """Return a JSON-compatible projection and observed daily-window bounds.

    Project additive counters by repeating the measured day seven times. An
    allocation floor is twice its weekly counter projection or observed peak.
    Daily windows describe the observed portions only, with lower and upper
    counts when an hour spans two windows. Tariffs and operational reserves are
    supplied separately to the supervisor's existing cost estimator.
    """
    if len(samples) != 24:
        raise ValueError('projection needs exactly 24 hourly samples')
    first = samples[0]
    if not isinstance(first.counters, Mapping) or not isinstance(first.peaks, Mapping):
        raise ValueError('hourly metrics must be mappings')
    counter_names = first.counters.keys()
    peak_names = first.peaks.keys()
    if counter_names & peak_names or not (counter_names | peak_names):
        raise ValueError('counter and peak metrics must be distinct and at least one metric is required')
    for index, sample in enumerate(samples):
        if (type(sample.start) is not int or type(sample.end) is not int
                or sample.start < 0 or sample.end - sample.start != HOUR
                or (index and sample.start != samples[index - 1].end)):
            raise ValueError('projection needs contiguous one-hour sample bounds')
        _validate_metrics(sample.counters, counter_names)
        _validate_metrics(sample.peaks, peak_names)

    totals = {name: sum(row.counters[name] for row in samples) for name in counter_names}
    weekly = {name: value * PLAN_DAYS for name, value in totals.items()}
    counter_max = {name: max(row.counters[name] for row in samples) for name in counter_names}
    peaks = {name: max(row.peaks[name] for row in samples) for name in peak_names}
    demand = weekly | peaks
    min_allocations = {}
    for name in allocation_metrics:
        if name not in demand:
            raise ValueError('unobserved allocation metric')
        min_allocations[name] = 2 * demand[name]

    daily_windows = {}
    for name, offset in (daily_offsets_hours or {}).items():
        if name not in totals or type(offset) is not int or not -12 <= offset <= 14:
            raise ValueError('daily window needs an observed counter and integral UTC offset hours')
        daily_windows[name] = _day_windows(samples, name, offset * HOUR)

    return dict(counter_totals_24h=totals, counter_totals_168h=weekly,
                counter_max_hour=counter_max, peak_values=peaks,
                min_allocations=min_allocations, observed_daily_windows=daily_windows)
