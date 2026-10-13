#!/usr/bin/env python3
"""S15 O-2 checkpoint: run the KMA v000903 assembly workload and record time, peak RSS and CPU.

The example binary (`cargo build --release --example kma_checkpoint`) assembles every recorded
oracle request from in-memory store answers and prints timing JSON. Peak RSS and user/system CPU
come from the child rusage. A zero-round run measures the fixture load alone, so the assembly CPU
is reported both raw and with that baseline subtracted. Local fixtures only: no network, store or
provider I/O, and no gateway deadline is changed.
"""
import argparse
import json
import platform
import resource
import subprocess
import sys
from pathlib import Path


def measure(binary, rounds):
    before = resource.getrusage(resource.RUSAGE_CHILDREN)
    out = subprocess.run([str(binary), str(rounds)], check=True, capture_output=True, text=True).stdout
    after = resource.getrusage(resource.RUSAGE_CHILDREN)
    # ru_maxrss: KiB on Linux, bytes on macOS. RUSAGE_CHILDREN keeps the largest child so far,
    # so the baseline (smaller) run is measured first.
    scale = 1 if sys.platform == 'darwin' else 1024
    return json.loads(out), {
        'user_s': after.ru_utime - before.ru_utime,
        'system_s': after.ru_stime - before.ru_stime,
        'peak_rss_bytes': after.ru_maxrss * scale,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--binary', required=True, type=Path, help='built kma_checkpoint example')
    parser.add_argument('--rounds', type=int, default=40, help='passes over every oracle request')
    parser.add_argument('--report', type=Path, help='write the JSON report here')
    args = parser.parse_args()
    baseline, base_usage = measure(args.binary, 0)
    timing, usage = measure(args.binary, args.rounds)
    cpu = usage['user_s'] + usage['system_s']
    base_cpu = base_usage['user_s'] + base_usage['system_s']
    report = {
        'schema': 1,
        'host': {'system': platform.system(), 'machine': platform.machine(), 'python': platform.python_version()},
        'timing': timing,
        'process': usage,
        'baseline_fixture_load': {'process': base_usage, 'wall_s': baseline['wall_s']},
        'assembly_cpu_s_minus_baseline': cpu - base_cpu,
        'assembly_cpu_ms_per_request': (cpu - base_cpu) * 1000 / timing['assemblies'],
        'limitations': 'Local fixture workload in one process; RSS includes the decoded oracle fixture. '
                       'Not production latency, concurrency or memory evidence.',
    }
    text = json.dumps(report, indent=1, sort_keys=True)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(text + '\n')
    print(text)


if __name__ == '__main__':
    main()
