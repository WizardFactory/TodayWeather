#!/usr/bin/env python3
"""Release narrative HTTP/S3 rehearsal on owned peers; never live providers or sends.

The release example uses a recorded native KMA snapshot and nation input doubles.
This proves the narrative acquisition/storage/serving layer, not full provider startup.
"""
import argparse
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import selectors
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('s20e_catalog_peer', ROOT/'tests/storage/catalog_peer.py')
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


class Handler(module.Handler):
    def dispatch(self):
        split = urlsplit(self.path)
        if split.path == '/1360000/VilageFcstMsgService/getWthrSituation':
            if (self.command != 'GET' or self.headers.get('Host') != f'127.0.0.1:{self.server.server_port}'):
                return self.error(400, 'OwnedTargetRequired')
            q = parse_qs(split.query)
            station = int(q.get('stnId', ['0'])[0])
            if q.get('serviceKey') != ['S20E_SMOKE_KEY_C+aaaaaaaaaaaaaaaa/='] or q.get('numOfRows') != ['10'] or q.get('pageNo') != ['1']:
                return self.error(400, 'SyntheticRequestContract')
            with self.server.lock:
                self.server.narrative_calls.append(station)
                enabled = self.server.narrative_enabled
            if not enabled:
                return self.send(503, b'disabled', {'Content-Type':'text/plain'})
            tm = time.strftime('%Y%m%d%H%M', time.gmtime(time.time()+9*3600))
            text = f'○ 관서 {station}: 흐리고 비\r\n<literal text> & 0'
            body = {'response':{'header':{'resultCode':'00'}, 'body':{'items':{'item':[{'stnId':station,'tmFc':tm,'wfSv1':text}]}}}}
            return self.send(getattr(self.server,'narrative_status',200), json.dumps(body).encode(), {'Content-Type':'application/json; charset=utf-8'})
        return super().dispatch()

    do_GET = do_HEAD = do_PUT = do_POST = do_DELETE = do_OPTIONS = dispatch


def env():
    return {k: os.environ[k] for k in ('PATH','TMPDIR','LANG','LC_ALL') if k in os.environ}


def line(process, timeout=15):
    with selectors.DefaultSelector() as selector:
        selector.register(process.stdout, selectors.EVENT_READ)
        if not selector.select(timeout):
            raise AssertionError('release entrypoint readiness timeout')
        raw = process.stdout.readline()
    if not raw:
        raise AssertionError('release entrypoint exited before readiness')
    return json.loads(raw)


def request(url, method='GET', headers=None):
    req = urllib.request.Request(url,method=method,headers=headers or {})
    try:
        response = urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=10)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, dict(response.headers), response.read()


def serve(binary, root, out, label, expected):
    with (out/(label+'.stderr.log')).open('w') as log:
        process = subprocess.Popen([str(binary),'serve',root],cwd=ROOT,env=env(),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=log,text=True)
        try:
            ready = line(process)
            (out/(label+'-ready.json')).write_text(json.dumps(ready,ensure_ascii=False,indent=2)+'\n')
            assert ready['production_eligible'] is False
            url = ready['public']+ready['path']
            status,headers,body = request(url)
            value = json.loads(body)
            narrative = value.pop('forecastNarrative',None)
            assert value == json.loads(ready['expected_base']), 'original weather fields changed'
            if expected:
                assert narrative['stationId'] == 109 and narrative['textFormat'] == 'plain'
                assert '<literal text> & 0' in narrative['text'] and '\r' not in narrative['text']
                assert 'max-age=' in headers['cache-control'].lower()
                assert 0 <= int(headers['cache-control'].split('=')[1]) <= 300
            else:
                assert narrative is None
            assert status == 200
            status,h,head = request(url,'HEAD')
            assert status == 200 and head == b'' and h['etag'] == headers['etag']
            status,h,not_modified = request(url,headers={'If-None-Match':headers['etag']})
            assert status == 304 and not_modified == b''
            if expected:
                assert h['cache-control'] == headers['cache-control']
            national = []
            for country in ('KR','kr','%4B%52','US'):
                status,_,raw = request(ready['public']+'/v000901/nation/'+country)
                nation = json.loads(raw)
                n = nation.get('forecastNarrative')
                assert status == 200 and len(nation['weather']) == 15
                assert not any('forecastNarrative' in city for city in nation['weather'])
                assert bool(n) is (expected and country != 'US')
                if n:
                    assert n['stationId'] == 108
                national.append({'country':country,'attached':bool(n),'children':15})
            process.stdin.close()
            stopped = line(process)
            assert stopped == {'read_provider_calls':0,'stopped':True}
            assert process.wait(timeout=10) == 0
            result = {'status':200,'head':200,'conditional':304,'original_weather_equal':True,
                      'regional':narrative,'national':national,'read_provider_calls':0,
                      'layer':ready['layer'],'production_eligible':False}
            (out/(label+'.json')).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
            return result
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=10)


def strict_status(binary, out):
    peer = module.make()
    peer.RequestHandlerClass = Handler
    peer.narrative_calls = []
    peer.narrative_enabled = True
    peer.narrative_status = 201
    thread = threading.Thread(target=peer.serve_forever,daemon=True)
    thread.start()
    try:
        with (out/'status201.stderr.log').open('w') as log:
            result = subprocess.run([str(binary),'acquire',f'http://127.0.0.1:{peer.server_port}/'],
                                    cwd=ROOT,env=env(),stdout=subprocess.PIPE,stderr=log,text=True,timeout=35)
        raw_or_index = sum(k.startswith(('raw/','index/')) for k in peer.objects)
        assert result.returncode == 0 and len(peer.narrative_calls) == 10
        assert raw_or_index == 0, 'strict non-200 reply must not become a publication'
        return {'status':201,'provider_gets':10,'raw_or_index_objects':0,'verdict':'PASS'}
    finally:
        peer.shutdown()
        peer.server_close()
        thread.join(timeout=5)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary',type=Path,required=True)
    parser.add_argument('--out',type=Path,required=True)
    args = parser.parse_args()
    binary = args.binary.resolve(strict=True)
    args.out.mkdir(parents=True,exist_ok=False)
    peer = module.make()
    peer.RequestHandlerClass = Handler
    peer.narrative_calls = []
    peer.narrative_enabled = True
    thread = threading.Thread(target=peer.serve_forever,daemon=True)
    thread.start()
    root = f'http://127.0.0.1:{peer.server_port}/'
    try:
        missing = serve(binary,root,args.out,'missing',False)
        assert peer.narrative_calls == [], 'serving must not acquire missing prose'
        with (args.out/'acquire.stderr.log').open('w') as log:
            acquired = subprocess.run([str(binary),'acquire',root],cwd=ROOT,env=env(),capture_output=False,stdout=subprocess.PIPE,stderr=log,text=True,timeout=35)
        (args.out/'acquire.json').write_text(acquired.stdout)
        assert acquired.returncode == 0, 'acquisition child failed'
        assert len(peer.narrative_calls) == 10 and len(set(peer.narrative_calls)) == 10
        with peer.lock:
            before = list(peer.narrative_calls)
            objects = sorted(peer.objects)
            raw_objects = [obj for key,obj in peer.objects.items() if key.startswith('raw/')]
            peer.narrative_enabled = False
        assert len(raw_objects) == 10
        for obj in raw_objects:
            encoded = next(value for key,value in obj.metadata.items() if key.lower().endswith('s2-record'))
            envelope = json.loads(base64.b64decode(encoded))
            assert envelope['status'] == 200 and envelope['content_type'] == 'application/json; charset=utf-8'
        assert not any('warning-feed' in k or 'push' in k or '.result.json' in k for k in objects)
        restored = serve(binary,root,args.out,'restored',True)
        restarted = serve(binary,root,args.out,'restarted',True)
        assert before == peer.narrative_calls, 'restart/HTTP triggered provider work'
        assert restored['regional'] == restarted['regional']
        rejected = strict_status(binary,args.out)
        report = {'verdict':'PASS','binary_sha256':hashlib.sha256(binary.read_bytes()).hexdigest(),
                  'tool_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                  'provider_posts':0,'provider_gets':len(before),'offices':before,
                  'total_provider_gets':len(before)+rejected['provider_gets'],
                  'missing':missing,'restored':restored,'restarted':restarted,
                  'stored_object_count':len(objects),'warning_or_push_objects':False,
                  'raw_protocol_metadata_preserved':True,
                  'strict_status201':rejected,
                  'live_actions':False,'production_eligible':False,
                  'limits':'Recorded KMA snapshot and nation city/air doubles; no full provider startup, IAM, host, quota or device qualification.'}
        (args.out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
        print(json.dumps({'verdict':'PASS','provider_gets':len(before),'offices':len(before),'restarts':2,'production_eligible':False}))
    finally:
        (args.out/'peer-observation.json').write_text(json.dumps({'provider_gets':peer.narrative_calls,
            'stored_object_count':len(peer.objects)},indent=2)+'\n')
        peer.shutdown()
        peer.server_close()
        thread.join(timeout=5)


if __name__ == '__main__':
    main()
