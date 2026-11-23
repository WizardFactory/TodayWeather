"""Offline elapsed-hour aggregation for validated shadow rehearsal observations."""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
import re

import guard
from rehearsal_projection import DAY, HOUR, HourSample


KST = timezone(timedelta(hours=9))
S3_USAGE = {
    'candidate_s3_reads': ('reads', 's3_reads'),
    'candidate_s3_writes': ('writes', 's3_writes'),
    'candidate_s3_put_bytes': ('put_bytes', 's3_put_bytes'),
}


@dataclass(frozen=True)
class Sample:
    """One observed checkpoint, with elapsed seconds from the runner's monotonic clock."""

    scheduled: int
    elapsed: int
    observed_at: int
    identity: tuple[str, int, int]
    counters: Mapping[str, int]
    gauges: Mapping[str, int]


def guard_sample(observation, allowance, *, scheduled, elapsed):
    """Extract fixed, nonsecret measurement fields from guard.collect's result."""
    try:
        if observation['accounting_valid'] is not True:
            raise ValueError('guard accounting unavailable')
        metrics = observation['metrics']
        diagnosis = guard.checked_diagnostics(observation['diagnostics'])
        if (not isinstance(metrics, Mapping) or set(metrics) != set(guard.METRICS.values())
                or not all(guard.integer(value) for value in metrics.values())
                or not isinstance(allowance, Mapping) or set(allowance) != {'reads', 'writes', 'put_bytes'}
                or not all(guard.integer(value) for value in allowance.values())):
            raise ValueError('guard allowance or metrics invalid')
        counters = {name: allowance[grant] - metrics[remaining]
                    for name, (grant, remaining) in S3_USAGE.items()}
        counters.update(tx_iface_bytes=observation['tx_bytes'], host_cpu_seconds=observation['cpu_seconds'],
                        auth_failures=metrics['auth_failures'], quota_failures=metrics['quota_failures'],
                        storage_auth_failures=metrics['storage_auth_failures'],
                        local_paid_exhaustions=diagnosis['local_paid_exhaustions'])
        # The guard's validated provider_http snapshot is sparse by design. An
        # absent status in that snapshot means the counter has never advanced.
        counters.update({f'provider_http/{source}/{status}': diagnosis['provider_http'].get(source, {}).get(status, 0)
                         for source in sorted(guard.PROVIDER_SOURCES) for status in ('401', '403', '429')})
        if diagnosis['paid_units'] is not None:
            counters.update({f'paid_units/{provider}': units['initial'] - units['remaining']
                             for provider, units in diagnosis['paid_units'].items()})
        values = Sample(scheduled, elapsed, observation['observed_at'],
                        (observation['boot_id'], observation['pid'], observation['start_ticks']),
                        counters, {'free_bytes': observation['free_bytes']})
    except (KeyError, TypeError, ValueError):
        raise ValueError('invalid guard measurement') from None
    if not _valid_sample(values):
        raise ValueError('invalid guard measurement')
    return values


def _valid_metrics(metrics):
    return isinstance(metrics, Mapping) and all(
        isinstance(name, str) and re.fullmatch(r'[a-z][a-z0-9_/]{0,79}', name) and guard.integer(value)
        for name, value in metrics.items()
    )


def _valid_sample(sample):
    identity = sample.identity
    return (type(identity) is tuple and len(identity) == 3
            and isinstance(identity[0], str) and re.fullmatch(r'[0-9a-f-]{36}', identity[0])
            and guard.integer(identity[1], 2, 2**31 - 1) and guard.integer(identity[2])
            and all(guard.integer(value) for value in (sample.scheduled, sample.elapsed, sample.observed_at))
            and bool(sample.counters) and _valid_metrics(sample.counters) and _valid_metrics(sample.gauges))


def _timestamp(epoch, zone):
    return datetime.fromtimestamp(epoch, zone).isoformat()


def _hour(index, start, cadence, samples, tolerance):
    begin = index * HOUR
    finish = begin + HOUR
    slots = range(begin, finish + 1, cadence)
    valid = []
    issues = set()
    max_drift = None
    for slot in slots:
        s = samples.get(slot)
        if s is None:
            issues.add('missing_sample')
        elif not _valid_sample(s):
            issues.add('invalid_sample')
        else:
            drift = abs(s.elapsed - slot)
            max_drift = drift if max_drift is None else max(max_drift, drift)
            if drift > tolerance:
                issues.add('sample_outside_slot')
            elif abs(s.observed_at - start - s.elapsed) > tolerance:
                issues.add('wall_clock_discontinuity')
            else:
                valid.append(s)
    for previous, current in zip(valid, valid[1:]):
        if previous.identity != current.identity:
            issues.add('candidate_identity_changed')
        if previous.elapsed >= current.elapsed or previous.observed_at > current.observed_at:
            issues.add('wall_clock_discontinuity')
        if previous.counters.keys() != current.counters.keys() or previous.gauges.keys() != current.gauges.keys():
            issues.add('measurement_shape_changed')
        elif any(value > current.counters[name] for name, value in previous.counters.items()):
            issues.add('counter_reset')
    begin_utc, end_utc = start + begin, start + finish
    row = dict(hour_index=index, start_epoch=begin_utc, end_epoch=end_utc,
               start_utc=_timestamp(begin_utc, timezone.utc), end_utc=_timestamp(end_utc, timezone.utc),
               start_kst=_timestamp(begin_utc, KST), end_kst=_timestamp(end_utc, KST), elapsed_seconds=HOUR,
               valid_samples=len(valid), missed_samples=len(slots) - len(valid),
               max_sample_drift_seconds=max_drift, complete=not issues, issues=sorted(issues),
               first_observed_epoch=None, last_observed_epoch=None,
               counters=None, peaks=None, minimum_free_bytes=None)
    if row['complete']:
        first, last = valid[0], valid[-1]
        row['first_observed_epoch'], row['last_observed_epoch'] = first.observed_at, last.observed_at
        row['counters'] = {name: value - first.counters[name] for name, value in last.counters.items()}
        row['peaks'] = {name: max(s.gauges[name] for s in valid)
                        for name in first.gauges if name != 'free_bytes'}
        if 'free_bytes' in first.gauges:
            row['minimum_free_bytes'] = min(s.gauges['free_bytes'] for s in valid)
    return row


def _covered_midnight(hours, start, offset=0):
    boundary = ((start + offset) // DAY + 1) * DAY - offset
    if boundary < start + DAY and any(
        row['complete'] and row['first_observed_epoch'] < boundary <= row['last_observed_epoch']
        for row in hours
    ):
        return boundary - start
    return None


def aggregate(samples, *, start_utc, through, cadence=60, tolerance=2):
    """Summarize closed elapsed hours, retaining gaps instead of interpolating.

    `through` is the elapsed whole-second horizon. `cadence` divides an hour and
    `tolerance` bounds both late observations and wall time versus monotonic time.
    The runner supplies every scheduled slot, omitting failed observations. Slots
    at hour boundaries are shared by both hours; missing ones affect both.
    """
    if (not guard.integer(start_utc) or not guard.integer(through, 0, DAY)
            or not guard.integer(cadence, 1, HOUR) or HOUR % cadence
            or not guard.integer(tolerance, 0, cadence - 1)):
        raise ValueError('invalid rehearsal timing or cadence')
    checkpoints = {}
    for sample in samples:
        if (not isinstance(sample, Sample) or not guard.integer(sample.scheduled, 0, through)
                or sample.scheduled % cadence or sample.scheduled in checkpoints):
            raise ValueError('invalid or duplicate rehearsal sample slot')
        checkpoints[sample.scheduled] = sample
    hours = [_hour(index, start_utc, cadence, checkpoints, tolerance) for index in range(through // HOUR)]
    utc = _covered_midnight(hours, start_utc)
    kst = _covered_midnight(hours, start_utc, offset=9 * HOUR)
    complete = (len(hours) == 24 and all(row['complete'] for row in hours)
                and utc is not None and kst is not None)
    return dict(schema=1, start_epoch=start_utc, elapsed_through=through, sample_cadence_seconds=cadence,
                tolerance_seconds=tolerance, hours=hours, utc_midnight_elapsed=utc,
                kst_midnight_elapsed=kst, complete=complete)


def projection_samples(report):
    """Adapt a verified day directly to the existing seven-day projection input."""
    if report['schema'] != 1 or report['complete'] is not True or len(report['hours']) != 24:
        raise ValueError('projection needs a complete 24-hour measurement')
    if any(row['complete'] is not True for row in report['hours']):
        raise ValueError('projection needs every hour complete')
    return [HourSample(row['start_epoch'], row['end_epoch'], row['counters'], row['peaks'])
            for row in report['hours']]


def write_measurement(path, report, *, run_id, source_commit, artifact_sha256=None):
    """Atomically publish an aggregate result in the existing private evidence directory."""
    if (not isinstance(run_id, str) or not re.fullmatch(r'[a-z0-9-]{1,40}', run_id)
            or not isinstance(source_commit, str) or not re.fullmatch(r'[0-9a-f]{40}', source_commit)):
        raise ValueError('invalid rehearsal evidence identity')
    output = dict(report, run_id=run_id, source_commit=source_commit)
    if artifact_sha256 is not None:
        if (not isinstance(artifact_sha256, Mapping)
                or artifact_sha256.keys() != {'server', 'collector', 'launch', 'reader'}
                or any(not isinstance(value, str) or not re.fullmatch(r'[0-9a-f]{64}', value)
                       for value in artifact_sha256.values())):
            raise ValueError('invalid rehearsal artifact fingerprints')
        output['artifact_sha256'] = dict(artifact_sha256)
    elif report.get('complete') is True:
        raise ValueError('complete rehearsal evidence requires artifact fingerprints')
    guard.save(Path(path), output)
