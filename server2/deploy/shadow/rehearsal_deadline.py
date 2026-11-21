"""Arm a disposable rehearsal's independent host deadline."""

import re

from rehearsal_projection import DAY


def arm_stop(run_id, *, start_monotonic, boottime, run):
    """Start the real collection stop service at a fixed boot-clock time.

    Use the same Linux CLOCK_BOOTTIME origin for elapsed measurements. The
    transient timer survives a driver exit but will not outlive a guest reboot.
    Keep the original installed 168/170-hour timers as the host backstop.
    """
    if (type(run_id) is not str or not re.fullmatch(r'[a-z0-9-]{1,30}', run_id)
            or type(start_monotonic) is not int or not boottime() < start_monotonic):
        raise ValueError('invalid or expired rehearsal start')
    return _arm(run_id, start_monotonic + DAY, 'deadline', run)


def arm_startup_stop(run_id, *, deadline, boottime, run):
    if (type(run_id) is not str or not re.fullmatch(r'[a-z0-9-]{1,30}', run_id)
            or type(deadline) is not int or not boottime() < deadline):
        raise ValueError('invalid or expired startup deadline')
    return _arm(run_id, deadline, 'startup-deadline', run)


def _arm(run_id, end, suffix, run):
    service = f'server2-shadow-{run_id}-stop.service'
    timer = f'server2-shadow-{run_id}-{suffix}'
    run('systemd-run', f'--unit={timer}', f'--on-boot={end}s', '--timer-property=WakeSystem=true',
        '--timer-property=AccuracySec=1ms', '--timer-property=RandomizedDelaySec=0',
        '--', '/usr/bin/systemctl', '--no-block', 'start', service, timeout=10)
    status = run('systemctl', 'show', '--property=ActiveState', '--value', timer + '.timer', timeout=5)
    if status.stdout.strip() != 'active':
        raise ValueError('rehearsal stop timer is inactive')
    return end
