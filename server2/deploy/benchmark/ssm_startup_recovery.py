#!/usr/bin/env python3
"""Stock-only pre-Online readiness; never fetch credential bodies or agent logs."""
import argparse
import hashlib
import hmac
import json
import os
from pathlib import Path
import subprocess
import time

UNITS = ('amazon-ssm-agent.service', 'snap.amazon-ssm-agent.amazon-ssm-agent.service')

ROLE = 'server2-s09-benchmark-20261008'
READINESS_SECONDS = 180
ADMISSION_SECONDS = 300


def imds_ready(role, run=subprocess.run):
    """Profile visibility only, NOT proof of issued credentials or SSM auth.

    Token lives only in the bounded child. Never request the credential body.
    Direct HTTPConnection uses no proxy, DNS, redirects or configurable endpoint.
    """
    if role != ROLE:
        return False
    script = """import http.client,json,sys
role=sys.argv[1]
def request(method,path,headers,maximum):
    conn=http.client.HTTPConnection('169.254.169.254',80,timeout=2)
    try:
        conn.request(method,path,headers=headers)
        response=conn.getresponse()
        if response.status != 200: raise ValueError('status')
        body=response.read(maximum+1)
        if len(body)>maximum: raise ValueError('size')
        return body.decode('utf-8')
    finally: conn.close()
try:
    token=request('PUT','/latest/api/token',{'X-aws-ec2-metadata-token-ttl-seconds':'60'},1024)
    if not token or any(ord(c)<33 or ord(c)>126 for c in token): raise ValueError('token')
    headers={'X-aws-ec2-metadata-token':token}
    info=json.loads(request('GET','/latest/meta-data/iam/info',headers,4096))
    roles=request('GET','/latest/meta-data/iam/security-credentials/',headers,1024).splitlines()
    ready=isinstance(info,dict) and info.get('Code')=='Success' and roles==[role]
    print(json.dumps({'info':{'Code':'Success' if ready else 'NotReady'},'roles':[role] if ready else []}))
except Exception:
    sys.exit(1)
"""
    try:
        result = run(['/usr/bin/python3', '-I', '-c', script, role], timeout=8,
                     stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        if result.returncode or len(result.stdout) > 1024:
            return False
        value = json.loads(result.stdout)
        return (isinstance(value, dict) and isinstance(value.get('info'), dict)
                and value['info'].get('Code') == 'Success' and value.get('roles') == [role])
    except (OSError, subprocess.SubprocessError, ValueError, TypeError):
        return False


def https_ready(run=subprocess.run):
    # Child deadline includes DNS; no HTTP request, credentials or response body.
    script = """import socket,ssl
context=ssl.create_default_context()
for host in ('ssm.ap-northeast-2.amazonaws.com','ssmmessages.ap-northeast-2.amazonaws.com'):
    with socket.create_connection((host,443),timeout=3) as raw:
        with context.wrap_socket(raw,server_hostname=host): pass
"""
    try:
        return run(['/usr/bin/python3', '-c', script], timeout=8,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def host_guard(deadline, run=subprocess.run, wall=time.time):
    if wall() >= deadline:
        raise ValueError('deadline')
    for unit in ('server2-s09-expiry.timer', 'server2-s09-meter.service'):
        if run(['systemctl', 'is-active', '--quiet', unit], timeout=3,
               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
            raise ValueError('inactive guard')
    result = run(['nft', '-j', 'list', 'table', 'inet', 'server2_s09'], timeout=3,
                 stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    if result.returncode or len(result.stdout) > 32768:
        raise ValueError('guard readback')
    table = json.loads(result.stdout)
    quotas = {x['quota']['name']: x['quota'] for x in table['nftables'] if 'quota' in x}
    for name, cap in [('global_rx', 30064771072), ('bootstrap_rx', 2147483648)]:
        quota = quotas[name]
        if quota['bytes'] != cap or type(quota['used']) is not int or not 0 <= quota['used'] < cap:
            raise ValueError('quota')
    if wall() >= deadline:
        raise ValueError('deadline')


def recover(guard, probe, restart, admitted, emit, clock, sleep, on_ready=None):
    start = clock()
    attempts = 0
    restarts = 0
    def record(status, reason):
        emit({'status': status, 'reason': reason, 'probes': attempts, 'restarts': restarts})
    previous = start
    def elapsed():
        nonlocal previous
        current = clock()
        if current < previous:
            raise ValueError('clock')
        previous = current
        return current - start
    try:
        while elapsed() < READINESS_SECONDS:
            guard()
            attempts += 1
            if probe():
                guard()
                if elapsed() >= READINESS_SECONDS:
                    record('failed', 'transport_or_role_unavailable')
                    return 1
                ready_elapsed = elapsed()
                if on_ready is not None:
                    on_ready(ready_elapsed)
                    guard()
                    if elapsed() >= READINESS_SECONDS:
                        record('failed', 'transport_or_role_unavailable')
                        return 1
                restart()
                restarts = 1
                record('restarted', 'transport_and_role_ready')
                break
            sleep(5)
        else:
            record('failed', 'transport_or_role_unavailable')
            return 1
        while elapsed() - ready_elapsed < ADMISSION_SECONDS:
            guard()
            if elapsed() - ready_elapsed >= ADMISSION_SECONDS:
                break
            if admitted():
                guard()
                if elapsed() - ready_elapsed >= ADMISSION_SECONDS:
                    break
                record('admitted', 'controller_marker')
                return 0
            sleep(5)
        record('failed', 'admission_unconfirmed')
        return 1
    except Exception:
        record('failed', 'guard_or_local_failure')
        return 1


class ReadinessSession:
    """Private per-launch proof; not credential issuance or SSM authentication."""
    def __init__(self, identity, deadline_ms, private, wall, clock, emit):
        self.identity, self.deadline_ms, self.private = identity, deadline_ms, private
        self.wall, self.clock, self.emit = wall, clock, emit
        self.started_at_ms = int(wall()*1000)
        self.record = None

    def ready(self, elapsed, observed=None):
        at, monotonic = observed if observed is not None else (int(self.wall()*1000), int(self.clock()*1000))
        proof = {k:self.identity[k] for k in ('run_id','nonce','source_revision')}
        proof.update(schema=1, deadline_ms=self.deadline_ms, role=ROLE,
            started_at_ms=self.started_at_ms, ready_at_ms=at,
            readiness_elapsed_ms=int(elapsed*1000), ready_monotonic_ms=monotonic,
            status='transport_and_role_ready')
        if (self.record is not None or not 0 <= elapsed < READINESS_SECONDS
                or abs(proof['ready_at_ms']-self.started_at_ms-proof['readiness_elapsed_ms']) > 1000
                or proof['ready_at_ms'] >= self.deadline_ms):
            raise ValueError('readiness clock or replay')
        raw = json.dumps(proof, sort_keys=True, separators=(',', ':')).encode()
        mac = hmac.new(bytes.fromhex(self.identity['key']), raw, hashlib.sha256).hexdigest()
        self.record = {'proof':proof, 'mac':mac}
        fd = os.open(self.private/'readiness.json', os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'w') as output:
            json.dump(self.record, output, sort_keys=True, separators=(',', ':'))
            output.flush(); os.fsync(output.fileno())
        self.emit(self.record)

    def admitted(self):
        path = self.private/'controller-start'
        if self.record is None or not path.is_file():
            return False
        matched = path.read_text() == self.record['mac']
        proof = self.record['proof']
        age = int(self.clock()*1000)-proof['ready_monotonic_ms']
        wall = int(self.wall()*1000)
        return (matched and 0 <= age < ADMISSION_SECONDS*1000
                and wall < self.deadline_ms
                and abs(wall-proof['ready_at_ms']-age) <= 1000)


def main(argv=None, run=subprocess.run, wall=time.time, private=Path('/opt/server2-s09/private')):
    parser = argparse.ArgumentParser()
    parser.add_argument('--unit', required=True, choices=UNITS)
    parser.add_argument('--role', required=True, choices=(ROLE,))
    parser.add_argument('--deadline-ms', required=True, type=int)
    args = parser.parse_args(argv)
    deadline = min(args.deadline_ms, 1791642600000) / 1000
    session = None
    def emit(record):
        print('S09_SSM_RECOVERY_V1 ' + json.dumps(record, separators=(',', ':')), flush=True)
    def restart():
        result = run(['systemctl', 'restart', args.unit], timeout=15,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if result.returncode:
            raise ValueError('restart failed')
    def guard():
        host_guard(deadline, run=run, wall=wall)
    def ready():
        if not https_ready(run=run):
            return False
        # Recheck expiry and both quota guards between network probes.
        guard()
        return imds_ready(args.role, run=run)
    # Capture the start wall clock before recover; emit exactly once after both
    # probes and the fresh guard, BEFORE restart latency consumes the window.
    started = int(wall()*1000)
    def publish(elapsed):
        nonlocal session
        observed = (int(wall()*1000), int(time.monotonic()*1000))
        identity = json.loads((private/'readiness-context.json').read_text())
        session = ReadinessSession(identity, int(deadline*1000), private, wall,
            time.monotonic, lambda record: print('S09_SSM_READY_V1 '+json.dumps(record, separators=(',', ':')), flush=True))
        session.started_at_ms = started
        session.ready(elapsed, observed=observed)
    code = recover(guard, ready, restart, lambda: session.admitted(),
                   emit, clock=time.monotonic, sleep=time.sleep, on_ready=publish)
    if code == 0:
        # write_files already ran before this final-stage runcmd. File existence
        # alone is not admission; publish the bound acknowledgement separately.
        (private/'controller-admitted').write_text(session.record['mac'])
    # Ordinary recovery failure only reports/returns. The controller captures
    # bounded evidence before its final cleanup phase; expiry/meter emergency
    # protection remains independently armed on the owned benchmark host.
    return code


if __name__ == '__main__':
    raise SystemExit(main())
