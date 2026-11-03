#!/usr/bin/env python3
"""Owned release WW smoke: raw contract, warm/S3 recovery, no geocoder or legacy.

Uses the existing world smoke's synthetic VC/WAQI and local S3 peers. No public
provider, AWS, production data, client build, device delivery or cutover is run.
"""
import argparse
import hashlib
import http.server
import json
import os
from pathlib import Path
import re
import select
import subprocess
import tempfile
import threading
from datetime import datetime, timezone
import urllib.error
import urllib.request
import world_smoke as world

ROOT = Path(__file__).resolve().parents[1]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class Fixture(world.Fixture):
    geocode = 0
    unexpected = 0

    def do_GET(self):
        if self.path.startswith(('/maps/', '/geocode/')):
            Fixture.geocode += 1
        if not self.path.startswith(('/maps/', '/geocode/', '/v00090', '/feed/geo:', '/timeline/')):
            Fixture.unexpected += 1
        super().do_GET()


def call(base, path, method='GET', headers=None):
    req = urllib.request.Request(base+path, method=method, headers=headers or {})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        reply = opener.open(req, timeout=15)
    except urllib.error.HTTPError as error:
        reply = error
    with reply:
        return reply.status, dict(reply.headers.items()), reply.read()


def start(command, env, cwd, log):
    child = subprocess.Popen(command, env=env, cwd=cwd, stdout=subprocess.PIPE,
                             stderr=log, text=True, start_new_session=True)
    try:
        ready, _, _ = select.select([child.stdout], [], [], 10)
        assert ready, 'startup deadline'
        line = child.stdout.readline().strip()
        match = re.fullmatch(r'server2 public=(127\.0\.0\.1:\d+) metrics=(127\.0\.0\.1:\d+)', line)
        assert match, line
        return child, 'http://'+match[1]
    except BaseException:
        stop(child)
        raise


def stop(child):
    if child.poll() is None:
        child.terminate()
        try:
            assert child.wait(timeout=8)==0
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait(timeout=5)
            raise
    if child.stdout is not None:
        child.stdout.close()


def run(binary, peer_binary, out):
    identities = {str(p): sha(p) for p in (binary, peer_binary)}
    report = dict(schema=1, verdict='FAIL', scope='owned local widget layer',
                  started_at=datetime.now(timezone.utc).isoformat(),
                  artifacts=identities, production_eligible=False, live_actions=False)
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Fixture)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    s3_process = None
    try:
        s3_process, s3 = world.s3_peer()
        fixture = 'http://127.0.0.1:%d' % server.server_port
        env = {k:v for k,v in os.environ.items() if k in ('PATH','SYSTEMROOT','TMPDIR')}
        env.update(PORT='0', SERVER2_NATIVE_FAMILIES='dsf', SERVER2_S3_BUCKET='server2-local',
                   AWS_ACCESS_KEY='server2-local', AWS_SECRET_KEY='server2-local-secret',
                   VC_SECRET_KEY='local-dummy-vc-key', VC_DAILY_RECORD_LIMIT='1000',
                   WAQI_SECRET_KEY='local-dummy-waqi-key', GEOCODER_KAKAO_KEYS='["local-dummy-kakao-key"]',
                   GEOCODER_GOOGLE_KEY='local-dummy-google-key')
        # No SERVER2_GATEWAY_LEGACY_URL: there is no legacy origin to fall back to.
        command = [str(peer_binary),'--s3',s3,'--vc',fixture+'/timeline/',
                   '--waqi',fixture+'/', '--google',fixture,'--kakao',fixture]
        path = '/ww/010000/current/2?gcode=51.507,-0.128'
        with tempfile.TemporaryDirectory(prefix='server2-widget-') as cwd:
            with (out/'cold.ndjson').open('w') as log:
                child, base = start(command,env,cwd,log)
                try:
                    status, headers, first = call(base,path)
                    assert status == 200, (status,first)
                    data = json.loads(first)
                    assert data['source']=='VC' and len(data['thisTime'])==2 and len(data['daily'])==9
                    current = data['thisTime'][1]
                    assert 'temp_c' in current and 't1h' not in current
                    assert 'tempMin_c' in data['daily'][1] and 'tmn' not in data['daily'][1]
                    assert data['location']=={'lat':51.507,'lon':-0.128}
                    assert current.get('airSource')=='aqicn' and 'pm25Value' in current and 'arpltn' not in current
                    assert not any(k.lower()=='cache-control' for k in headers)
                    assert len(world.Fixture.vc_paths)==1 and len(world.Fixture.air_paths)==1
                    assert call(base,path)[2]==first, 'warm body differs'
                    tag = next(v for k,v in headers.items() if k.lower()=='etag')
                    assert call(base,path,headers={'If-None-Match':tag})[0]==304
                    assert call(base,path,method='HEAD')[2]==b''
                    assert call(base,'/ww/010000/current/2')[0]==400
                    assert len(world.Fixture.vc_paths)==1 and len(world.Fixture.air_paths)==1
                    report['cold_warm']={'status':status,'body_sha256':hashlib.sha256(first).hexdigest(),
                                         'daily':len(data['daily']),'hourly':len(data['hourly']),
                                         'raw_temp_c':current['temp_c'],'raw_icon':current['skyIcon'],
                                         'etag_status':304,'head_body_bytes':0,'missing_gcode_status':400}
                    (out/'body.json').write_bytes(first)
                finally:
                    stop(child)
            world.Fixture.down = True
            with (out/'restored.ndjson').open('w') as log:
                child, base = start(command,env,cwd,log)
                try:
                    status, _, restored = call(base,path)
                    assert status==200 and restored==first, 'empty-memory S3 restore differs'
                    assert len(world.Fixture.vc_paths)==1 and len(world.Fixture.air_paths)==1
                    report['restore']={'status':status,'identical_body':True,'providers_disabled':True,
                                       'extra_weather_calls':0,'extra_air_calls':0}
                finally:
                    stop(child)
            with (out/'disabled.ndjson').open('w') as log:
                child, base = start(command,dict(env,SERVER2_NATIVE_FAMILIES=''),cwd,log)
                try:
                    assert call(base,path)[0]==404, 'unselected widget must not acquire or forward'
                finally:
                    stop(child)
        assert Fixture.geocode==0 and world.Fixture.legacy==0 and Fixture.unexpected==0
        report.update(geocode_calls=0, legacy_calls=0, weather_calls=len(world.Fixture.vc_paths),
                      air_calls=len(world.Fixture.air_paths), family_disabled_status=404,
                      s3_objects=len(world.dump(s3)), device_sends=0)
        assert all(sha(Path(p))==h for p,h in identities.items())
        report['verdict']='PASS'
    finally:
        if s3_process is not None:
            s3_process.terminate()
            s3_process.wait(timeout=5)
            s3_process.stdout.close()
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
        report['finished_at']=datetime.now(timezone.utc).isoformat()
        (out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps(report))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary',required=True)
    parser.add_argument('--peer-binary')
    parser.add_argument('--output',required=True)
    args=parser.parse_args()
    binary=Path(args.binary).resolve()
    peer=Path(args.peer_binary).resolve() if args.peer_binary else binary.parent/'examples/loopback_server'
    out=Path(args.output).resolve()
    if not binary.is_file() or not peer.is_file() or out.exists() or out==ROOT or ROOT in out.parents:
        parser.error('existing release pair and new output outside server2 required')
    out.mkdir(parents=True)
    run(binary,peer,out)
