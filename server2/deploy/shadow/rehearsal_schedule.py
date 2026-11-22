"""Observe the rehearsal on a monotonic schedule and report partial runs."""

import subprocess
import time

from rehearsal_measurement import Sample, aggregate
from rehearsal_projection import DAY, HOUR


FINAL_SAMPLE_LEAD_SECONDS = 1


def collect_day(*, observe, running, request_stop, publish, cadence=60, tolerance=2,
                monotonic=time.monotonic, wall=time.time, sleep=time.sleep, anchor=None):
    """Measure a ready workload until the deadline or an unexpected exit.

    The caller owns and arms a separate host deadline timer before entering.
    Observations and unit checks must have bounded I/O. Take the final sample
    just before the stop timer so it does not race against worker teardown.
    `request_stop` must confirm that the real stop service was requested. The
    caller separately verifies service exit and final evidence retrieval.
    """
    if (type(cadence) is not int or cadence < 2 or HOUR % cadence
            or type(tolerance) is not int or not FINAL_SAMPLE_LEAD_SECONDS <= tolerance < cadence):
        raise ValueError('invalid rehearsal cadence or drift tolerance')
    if anchor is None:
        start, start_utc = monotonic(), int(wall())
    else:
        start, start_utc = anchor
        if type(start) is not int or type(start_utc) is not int or start_utc < 0:
            raise ValueError('invalid rehearsal clock anchor')
    samples = []
    failures = []
    through = 0
    running_at_deadline = False
    early_stop_reason = 'workload-exited'

    def wait_until(slot):
        delay = start + slot - monotonic()
        while delay > 0:
            sleep(delay)
            delay = start + slot - monotonic()

    def checkpoint(*, deadline=False, confirmed=False):
        report = aggregate(samples, start_utc=start_utc, through=through, cadence=cadence,
                           tolerance=tolerance)
        report['deadline_reached'] = deadline
        report['stop_requested'] = confirmed
        report['stop_reason'] = ('deadline' if deadline else early_stop_reason) if confirmed else 'stop-unconfirmed'
        report['complete'] = report['complete'] and deadline and confirmed
        report['failed_observation_slots'] = list(failures)
        return report

    try:
        for slot in range(0, DAY + 1, cadence):
            wait_until(slot - FINAL_SAMPLE_LEAD_SECONDS if slot == DAY else slot)
            through = min(DAY, int(monotonic() - start))
            try:
                active = running()
            except (OSError, subprocess.SubprocessError):
                failures.append(slot)
                early_stop_reason = 'workload-status-unavailable'
                break
            if not active:
                break
            try:
                sampled = observe(slot, int(monotonic() - start))
                if not isinstance(sampled, Sample) or sampled.scheduled != slot:
                    raise ValueError('observation has an invalid slot')
                samples.append(sampled)
            except (OSError, ValueError):
                failures.append(slot)
            if slot == DAY:
                wait_until(DAY)
                through = DAY
                running_at_deadline = True
            elif slot and slot % HOUR == 0:
                interim = checkpoint()
                interim['stop_reason'] = 'in-progress'
                publish(interim)
    finally:
        try:
            confirmed = request_stop() is True
        except (OSError, subprocess.SubprocessError):
            confirmed = False
    result = checkpoint(deadline=running_at_deadline, confirmed=confirmed)
    publish(result)
    return result
