"""Validated, offline input and cumulative trace for SR-6 simulation."""

import hashlib
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from itertools import accumulate

import guard
import state
from coordinator import paid_prices_by_metric
from rehearsal_measurement import KST, S3_USAGE, projection_samples
from rehearsal_projection import DAY, HOUR, project_week


ARTIFACTS = {'server', 'collector', 'launch', 'reader'}
POLICY_FIELDS = {'schema', 'planned_epoch', 'measurement_sha256', 'allowance', 'cost_policy', 'paid_policy'}
PAID_METRICS = tuple(f'paid_units/{provider}' for provider in guard.PAID_PROVIDERS)
STATUS_METRICS = tuple(f'provider_http/{source}/{status}'
                       for source in sorted(guard.PROVIDER_SOURCES) for status in ('401', '403', '429'))
COUNTERS = (set(S3_USAGE) | set(PAID_METRICS) | set(STATUS_METRICS)
            | {'tx_iface_bytes', 'host_cpu_seconds', 'auth_failures', 'quota_failures',
               'storage_auth_failures', 'local_paid_exhaustions', 'standin_s3_reads',
               'standin_s3_writes', 'standin_s3_put_bytes', 'log_s3_writes', 'log_s3_put_bytes'})


def read_bound_json(path, limit):
    def unique(items):
        result = dict(items)
        if len(items) != len(result):
            raise ValueError('duplicate field in measured simulation input')
        return result

    def invalid_constant(_):
        raise ValueError('nonfinite number in measured simulation input')

    with path.open('rb') as source:
        raw = source.read(limit + 1)
    if len(raw) > limit:
        raise ValueError('measured simulation input exceeds its size limit')
    value = json.loads(raw, object_pairs_hook=unique, parse_constant=invalid_constant)
    if not isinstance(value, dict):
        raise ValueError('measured simulation input must be a JSON object')
    return value, hashlib.sha256(raw).hexdigest()


def measurement_hours(report):
    run_id, revision, artifacts = (report.get(key) for key in ('run_id', 'source_commit', 'artifact_sha256'))
    if (not isinstance(run_id, str) or not re.fullmatch(r'[a-z0-9-]{1,40}', run_id)
            or not isinstance(revision, str) or not re.fullmatch(r'[0-9a-f]{40}', revision)
            or not isinstance(artifacts, dict) or artifacts.keys() != ARTIFACTS
            or any(not isinstance(value, str) or not re.fullmatch(r'[0-9a-f]{64}', value)
                   for value in artifacts.values())):
        raise ValueError('invalid rehearsal run, revision or artifact provenance')
    start, cadence, tolerance = (report.get(key) for key in
                                 ('start_epoch', 'sample_cadence_seconds', 'tolerance_seconds'))
    if (type(report.get('schema')) is not int or report['schema'] != 1 or report.get('complete') is not True
            or report.get('elapsed_through') != DAY or not isinstance(report.get('hours'), list)
            or len(report['hours']) != 24 or not guard.integer(start, 1, 253402300799 - DAY - 36000)
            or not guard.integer(cadence, 1, HOUR) or HOUR % cadence or not guard.integer(tolerance, 0, cadence - 1)):
        raise ValueError('expected a complete 24-hour rehearsal')
    hours = report['hours']
    for index, row in enumerate(hours):
        begin, end = start + index * HOUR, start + (index + 1) * HOUR
        if not isinstance(row, dict):
            raise ValueError('invalid rehearsal hour record')
        first, last = row.get('first_observed_epoch'), row.get('last_observed_epoch')
        if (row.get('hour_index') != index or row.get('elapsed_seconds') != HOUR
                or row.get('start_epoch') != begin or row.get('end_epoch') != end or row.get('issues') != []
                or row.get('missed_samples') != 0 or row.get('valid_samples') != 1 + HOUR // cadence
                or not guard.integer(row.get('max_sample_drift_seconds'), 0, tolerance)
                or not guard.integer(first, begin - 2 * tolerance, begin + 2 * tolerance)
                or not guard.integer(last, end - 2 * tolerance, end + 2 * tolerance) or first >= last
                or (index > 0 and hours[index - 1]['last_observed_epoch'] != first)
                or not guard.integer(row.get('minimum_free_bytes'))):
            raise ValueError(f'invalid or incomplete rehearsal hour {index}')
        for suffix, zone in (('utc', timezone.utc), ('kst', KST)):
            if any(row.get(f'{edge}_{suffix}') != datetime.fromtimestamp(epoch, zone).isoformat()
                   for edge, epoch in (('start', begin), ('end', end))):
                raise ValueError(f'invalid calendar bounds for rehearsal hour {index}')
    for zone, offset in (('utc', 0), ('kst', 9 * HOUR)):
        boundary = ((start + offset) // DAY + 1) * DAY - offset
        if (not start < boundary < start + DAY or report.get(f'{zone}_midnight_elapsed') != boundary - start
                or not any(row['first_observed_epoch'] < boundary <= row['last_observed_epoch'] for row in hours)):
            raise ValueError(f'missing observed {zone.upper()} midnight')
    try:
        samples = projection_samples(report)
    except (KeyError, TypeError, ValueError):
        raise ValueError('invalid rehearsal hour counters or peaks') from None
    for sample in samples:
        counters = sample.counters
        if not isinstance(counters, dict) or not COUNTERS <= counters.keys():
            raise ValueError('required observed counters are missing')
        if (not all(guard.integer(counters[name], 0, 2**53) for name in COUNTERS)
                or counters['host_cpu_seconds'] > 2 * HOUR
                or counters['log_s3_writes'] > counters['standin_s3_writes']
                or counters['log_s3_put_bytes'] > counters['standin_s3_put_bytes']):
            raise ValueError('invalid measured counter or stand-in actor totals')
        if counters['local_paid_exhaustions']:
            raise ValueError('rehearsal demand was censored by local paid allowance exhaustion')
    return samples


@dataclass(frozen=True)
class MeasuredTrace:
    epoch: int
    allowance: dict
    cost_policy: dict
    paid_policy: dict
    cumulative: dict
    hourly_free_bytes: tuple
    daily_disk_loss: int

    def amount(self, name, elapsed):
        day, seconds = divmod(elapsed, DAY)
        hour, within = divmod(seconds, HOUR)
        prefix = self.cumulative[name]
        return day * prefix[-1] + prefix[hour] + (prefix[hour + 1] - prefix[hour]) * within // HOUR

    def apply(self, sample, elapsed):
        days, within_day = divmod(elapsed, DAY)
        free = self.hourly_free_bytes[within_day // HOUR] - days * self.daily_disk_loss
        sample.update(cpu_seconds=self.amount('host_cpu_seconds', elapsed),
                      tx_bytes=(self.amount('tx_iface_bytes', elapsed) + self.amount('standin_s3_put_bytes', elapsed)),
                      free_bytes=max(0, free))
        sample['metrics'].update({remaining: self.allowance[grant] - self.amount(name, elapsed)
                                  for name, (grant, remaining) in S3_USAGE.items()})
        for name in ('auth_failures', 'quota_failures', 'storage_auth_failures'):
            sample['metrics'][name] = self.amount(name, elapsed)
        diagnostics = sample['diagnostics']
        for name in STATUS_METRICS:
            if name in self.cumulative and (count := self.amount(name, elapsed)):
                _, source, status = name.split('/')
                diagnostics['provider_http'].setdefault(source, {})[status] = count
        diagnostics['paid_units'] = {}
        for metric, provider in zip(guard.PAID_PROVIDERS, state.PAID_PROVIDERS):
            initial = self.paid_policy['grants']['initial'][provider]
            diagnostics['paid_units'][metric] = dict(initial=initial, remaining=initial - self.amount(f'paid_units/{metric}', elapsed))
        return sample


def load_measurement(measurement_path, policy_path):
    report, digest = read_bound_json(measurement_path, 2 * 1024 * 1024)
    policy, policy_digest = read_bound_json(policy_path, 64 * 1024)
    if policy.keys() != POLICY_FIELDS or type(policy['schema']) is not int or policy['schema'] != 1:
        raise ValueError('invalid frozen measured policy fields')
    if policy['measurement_sha256'] != digest:
        raise ValueError('measured policy does not bind the measurement digest')
    samples = measurement_hours(report)
    epoch, allowance = policy['planned_epoch'], policy['allowance']
    if not guard.integer(epoch, samples[-1].end, 253402300799 - 170 * HOUR):
        raise ValueError('planned epoch must follow the complete rehearsal')
    cost, paid = policy['cost_policy'], policy['paid_policy']
    prices = state.validate_cost_policy(cost, epoch)
    state.validate_paid_policy(paid, epoch, budget=prices['ceiling'] - prices['prior'] - prices['reserve'])
    projection = project_week(samples, allocation_metrics=(*S3_USAGE, *PAID_METRICS))
    minimum = projection['min_allocations']
    if not isinstance(allowance, dict) or allowance.keys() != state.Journal.CAPS.keys():
        raise ValueError('invalid candidate S3 grants')
    for name, (grant, _) in S3_USAGE.items():
        if not guard.integer(allowance[grant], 1, state.Journal.CAPS[grant]):
            raise ValueError(f'S3 grant exceeds its cap or is invalid: {grant}')
        if allowance[grant] < minimum[name]:
            raise ValueError(f'S3 grant does not cover 2× projected demand: {grant}')
    for name, provider in zip(PAID_METRICS, state.PAID_PROVIDERS):
        if paid['grants']['initial'][provider] < minimum[name]:
            raise ValueError(f'paid grant does not cover 2× projected demand: {provider}')

    totals = projection['counter_totals_168h']
    paid_usd = sum(Decimal(paid['usd_per_unit'][provider]) * totals[name]
                   for name, provider in zip(PAID_METRICS, state.PAID_PROVIDERS) if totals[name])
    tx_proxy = totals['tx_iface_bytes'] + totals['standin_s3_put_bytes']
    estimate = state.estimate_cost(cost, epoch, epoch + 168 * HOUR, cpu_seconds=totals['host_cpu_seconds'],
                                   tx_bytes=tx_proxy, paid_usd=format(paid_usd, 'f'),
                                   s3_reads=totals['candidate_s3_reads'], s3_writes=totals['candidate_s3_writes'])
    headroom = Decimal(estimate['limit_usd']) - Decimal(estimate['accrued_usd'])
    cumulative = {name: tuple(accumulate((row.counters[name] for row in samples), initial=0))
                  for name in COUNTERS if name not in STATUS_METRICS or totals[name]}
    # Hourly minima include only 23 observed transitions. Ignore reclaimed
    # space and budget the largest observed decline for the unobserved transition.
    minima = [row['minimum_free_bytes'] for row in report['hours']]
    declines = [max(0, a - b) for a, b in zip(minima, minima[1:])]
    losses = tuple(accumulate(declines, initial=0))
    daily_loss = losses[-1] + max(declines)
    weekly_loss = 7 * daily_loss
    required_free = guard.DISK_RESERVE_BYTES + 2 * weekly_loss
    disk = dict(starting_hour_minimum_bytes=minima[0], daily_loss_bytes=daily_loss,
                weekly_loss_bytes=weekly_loss, reserve_bytes=guard.DISK_RESERVE_BYTES,
                required_starting_free_bytes=required_free, twofold_headroom_fits=minima[0] >= required_free)
    trace = MeasuredTrace(epoch, allowance, cost, paid, cumulative,
                          tuple(minima[0] - loss for loss in losses), daily_loss)
    evidence = {key: report[key] for key in ('run_id', 'source_commit', 'artifact_sha256')}
    evidence.update(measurement_sha256=digest, policy_sha256=policy_digest, planned_epoch=epoch,
                    allowance=allowance, cost_policy=cost, paid_policy=paid, projection=projection,
                    disk_projection=disk, estimate_168h=estimate, projected_budget_fits=estimate['stop'] is None,
                    projected_headroom_usd=format(headroom, 'f'), projected_tx_bytes=tx_proxy,
                    tx_assumption='external interface TX plus loopback S3 PUT payload lower bound; '
                                  'paired peer TX and wire overhead are unavailable',
                    s3_assumption='candidate counters plus the cost model background bound; '
                                  'observed stand-in operations remain separate')
    return trace, evidence
