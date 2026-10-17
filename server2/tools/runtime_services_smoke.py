#!/usr/bin/env python3
"""Actual production-process lifecycle against owned peers; no .env or real credentials.
Usage: python3 tools/runtime_services_smoke.py --binary RETAINED_RUNTIME_SERVICES_TEST --out DIR
"""
import argparse, concurrent.futures, gzip, hashlib, importlib.util, json, os, pathlib, re, selectors, signal, socket, subprocess, tempfile, threading, time, urllib.request
ROOT = pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('s20b_peer',ROOT/'tests/runtime_services/peer.py')
peer_module=importlib.util.module_from_spec(spec);spec.loader.exec_module(peer_module)

def diagnostics(text):
    """Only operational NDJSON; readiness and Rust test harness stay stdout protocols."""
    return [json.loads(line) for line in text.splitlines() if line.startswith('{') and '"schema":1' in line]


def request(url, value=None, method=None):
    data=None if value is None else json.dumps(value).encode()
    req=urllib.request.Request(url,data=data,method=method,headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=15) as r:return r.status,r.read().decode()

def wait_for(fn, timeout=10):
    end=time.monotonic()+timeout
    while time.monotonic()<end:
        value=fn()
        if value:return value
        time.sleep(.02)
    raise AssertionError('phase not observed before timeout')

def account(path):
    der=(ROOT/'tests/delivery/fixtures/rfc7515-a2-key.pkcs8.b64').read_text().strip()
    key='-----BEGIN PRIVATE KEY-----\n'+'\n'.join(der[i:i+64] for i in range(0,len(der),64))+'\n-----END PRIVATE KEY-----\n'
    path.write_text(json.dumps(dict(project_id='synthetic-s20b',client_email='synthetic@example.invalid',private_key=key)))

def start(binary,root,account_path,trigger,log,metrics=None,logging=None):
    # Explicit allowlist: private.env, inherited provider credentials and dotenv never enter.
    env={'PATH':'/usr/bin:/bin:/usr/sbin:/sbin','LANG':'en_US.UTF-8','DYLD_LIBRARY_PATH':'/private/tmp/server2-s04-toolchain/rustup/toolchains/1.99.0-aarch64-apple-darwin/lib'}
    for name in ('SERVER2_LOG_LEVEL', 'SERVER2_LOG_RATE'):
        if logging and name in logging: env[name]=logging[name]
    p=subprocess.Popen([str(binary),'process::child','--exact','--ignored','--nocapture'],cwd=ROOT,env=env,stdin=subprocess.PIPE,stdout=log,stderr=subprocess.STDOUT,text=True)
    p.stdin.write(json.dumps(dict(root=root,account=str(account_path),listener_failure=trigger=='listener',metrics_addr=metrics)));p.stdin.close()
    return p

def case(binary,out,phase,trigger):
    peer=peer_module.make(phase)
    thread=threading.Thread(target=peer.serve_forever,daemon=True);thread.start()
    root=f'http://127.0.0.1:{peer.server_port}/'
    label=f'{trigger}-{phase}'
    logpath=out/(label+'.log')
    pool=concurrent.futures.ThreadPoolExecutor(max_workers=2)
    p=None
    try:
        with tempfile.TemporaryDirectory(prefix='server2-s20b-') as directory, logpath.open('w+') as log:
            account_path=pathlib.Path(directory)/'synthetic-account.json';account(account_path)
            p=start(binary,root,account_path,trigger,log)
            def startup():
                text=logpath.read_text();m=re.search(r'server2 public=(127\.0\.0\.1:\d+) metrics=',text)
                assert p.poll() is None, text
                return m.group(1) if m else None
            address=wait_for(startup)
            base='http://'+address
            assert request(base+'/health')==(200,'OK')
            assert request(base+'/v000903/notice/latest')==(200,'{"notice":null}')
            time.sleep(.1)
            # Ordinary legacy registration API; no extra production routes/modes.
            body=[dict(type='ios',fcmToken='synthetic-s20b',cityIndex=1,id=1,town={'first':'Seoul'},source='KMA',lang='ko',package='todayWeather',pushTime=420)]
            if phase=='happy':
                fixture=json.load(gzip.open(ROOT/'tests/delivery/fixtures/alerts-oracle.json.gz'))
                alert=next(c for c in fixture['cases'] if c['id']=='current-ko-1')['record'].copy()
                alert.update(category='alert',type='ios',fcmToken='synthetic-conditional',cityIndex=2,id=2,town={'first':'Busan'},source='KMA',package='todayWeather')
                alert.pop('geo',None)
                body.append(alert)
            future=pool.submit(request,base+'/v000902/push-list',body)
            if phase=='idle':
                assert future.result()[0]==200
                # No startup precollection/send: stop well before the next UTC minute.
                assert not [e for e in peer.events if e['kind'] in ('native','oauth','post')]
            elif phase=='happy':
                assert future.result()[0]==200
                wait_for(lambda: any(e['kind']=='post' for e in peer.events))
                wait_for(lambda: len([e for e in peer.events if e['kind']=='post'])==2)
                wait_for(lambda: sum(k.endswith('.result.json') for k in peer.objects)==2)
                wait_for(lambda: any('warning-feed/head.json' in k for k in peer.counts))
            elif phase=='ambiguous':
                assert future.result()[0]==200
                wait_for(lambda: any(e['kind']=='ambiguous' for e in peer.events))
                wait_for(lambda: any(k.endswith('.result.json') for k in peer.objects))
            else:
                wait_for(lambda: any(e['kind']=='held' and e['phase']==phase for e in peer.events))
            queued=None
            if phase=='registration':
                second=[dict(body[0],fcmToken='synthetic-queued',cityIndex=3,id=3)]
                queued=pool.submit(request,base+'/v000902/push-list',second)
                time.sleep(.05)
            began=time.monotonic()
            os.kill(p.pid,{'term':signal.SIGTERM,'int':signal.SIGINT,'listener':signal.SIGUSR1}[trigger])
            time.sleep(.15)
            if phase=='before-post': request(root+'release',method='POST')
            rc=p.wait(timeout=36)
            elapsed=time.monotonic()-began
            text=logpath.read_text()
            peer.release.set()
            assert rc==0,text
            assert elapsed<=35,text
            assert any(e['component']=='process' and e['stage']=='shutdown' and e['action']=='quiesce' and e.get('limit_seconds')==35 for e in diagnostics(text)),text
            if phase=='weather': assert 'S20B_PROVIDER_CANCELLED incomplete' in text,text
            assert ('listener-error' if trigger=='listener' else 'signal-ok') in text,text
            registration=[]
            for admitted in [future,queued]:
                if admitted is not None:
                    try: registration.append(dict(status='answered',response=admitted.result(timeout=1)))
                    except Exception as error: registration.append(dict(status='incomplete',error=type(error).__name__))
            events=list(peer.events);posts=[e for e in events if e['kind']=='post']
            if phase in ('idle','registration','weather','oauth','before-post'):assert not posts,events
            else:assert len(posts)==(2 if phase=='happy' else 1),events
            assert all(e['claims'] for e in posts),events
            assert all(e['path'].startswith('/v000902/kma/addr/') for e in events if e['kind']=='native')
            if phase=='happy': assert any('warning-feed/head.json' in k for k in peer.counts),peer.counts
            # Restart at the same next minute using durable state/claim. Never replay a claim,
            # including a missing/unknown send response or result write.
            if posts:
                old=len(posts)
                peer.phase='happy';peer.release.set()
                restartlog=out/(label+'-restart.log')
                with restartlog.open('w+') as restart:
                    p=start(binary,root,account_path,'term',restart)
                    wait_for(lambda: 'server2 public=' in restartlog.read_text())
                    time.sleep(1.6)
                    os.kill(p.pid,signal.SIGTERM);assert p.wait(timeout=36)==0
                assert len([e for e in peer.events if e['kind']=='post'])==old,peer.events
            result=dict(id=label,status='passed',shutdown_seconds=round(elapsed,3),posts=len(posts),claims=sum('/delivery/' in k and not k.endswith('.result.json') for k in peer.objects),log=logpath.name,registration=registration)
            print(json.dumps(result),flush=True)
            return result
    finally:
        if p and p.poll() is None:p.kill();p.wait()
        peer.release.set();pool.shutdown(wait=True,cancel_futures=True)
        peer.shutdown();peer.server_close();thread.join(timeout=5)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--binary',type=pathlib.Path,required=True);parser.add_argument('--out',type=pathlib.Path,required=True);parser.add_argument('--quick',action='store_true');args=parser.parse_args()
    args.out.mkdir(parents=True,exist_ok=True);binary=args.binary.resolve()
    results=[]
    phases=['idle','registration','weather','oauth','before-post','post','result','ambiguous','happy']
    triggers=['term'] if args.quick else ['term','int','listener']
    for trigger in triggers:
        for phase in phases:results.append(case(binary,args.out,phase,trigger))
    receipt=dict(binary_sha256=hashlib.sha256(binary.read_bytes()).hexdigest(),results=results,live_actions=False)
    (args.out/'results.json').write_text(json.dumps(receipt,indent=2)+'\n')
if __name__=='__main__':main()

# Individually callable additional process checks; the matrix uses the same helpers.
def bind_failure(binary,out):
    peer=peer_module.make('idle');thread=threading.Thread(target=peer.serve_forever,daemon=True);thread.start()
    root=f'http://127.0.0.1:{peer.server_port}/';p=None
    try:
        with tempfile.TemporaryDirectory(prefix='server2-s20b-bind-') as directory, socket.socket() as busy:
            busy.bind(('127.0.0.1',0));busy.listen(1)
            key=pathlib.Path(directory)/'synthetic-account.json';account(key)
            logpath=out/'bind-failure.log'
            with logpath.open('w+') as log:
                p=start(binary,root,key,'term',log,metrics=f'127.0.0.1:{busy.getsockname()[1]}')
                assert p.wait(timeout=36)==0
            text=logpath.read_text()
            assert 'S20B_PROCESS_RESULT listener-error' in text,text
            assert 'server2 public=' not in text,text
            assert not peer.events,peer.events
            assert not any('warning-feed' in k for k in peer.counts),peer.counts
            return dict(id='second-bind-failure',status='passed',delivery_started=False)
    finally:
        if p and p.poll() is None:p.kill();p.wait()
        peer.shutdown();peer.server_close();thread.join(timeout=5)

def two_workers(binary,out):
    peer=peer_module.make('happy');thread=threading.Thread(target=peer.serve_forever,daemon=True);thread.start()
    root=f'http://127.0.0.1:{peer.server_port}/';children=[]
    try:
        with tempfile.TemporaryDirectory(prefix='server2-s20b-overlap-') as directory:
            key=pathlib.Path(directory)/'synthetic-account.json';account(key)
            log1=out/'two-workers-1.log';log2=out/'two-workers-2.log'
            with log1.open('w+') as first,log2.open('w+') as second:
                p=start(binary,root,key,'term',first);children.append(p)
                address=wait_for(lambda:(m.group(1) if (m:=re.search(r'server2 public=(127\.0\.0\.1:\d+) metrics=',log1.read_text())) else None))
                time.sleep(.1)
                assert 'upserted' in request('http://'+address+'/v000902/push-list',[dict(type='ios',fcmToken='synthetic-overlap',cityIndex=1,id=1,town={'first':'Seoul'},source='KMA',pushTime=420)])[1]
                q=start(binary,root,key,'term',second);children.append(q)
                wait_for(lambda:'server2 public=' in log2.read_text())
                wait_for(lambda:any(e['cause']=='claim_exists' for e in diagnostics(log2.read_text())+diagnostics(log1.read_text())))
                assert len([e for e in peer.events if e['kind']=='post'])==1,peer.events
                for child in children:os.kill(child.pid,signal.SIGTERM)
                for child in children:assert child.wait(timeout=36)==0
            assert len([e for e in peer.events if e['kind']=='post'])==1
            return dict(id='two-actual-workers-one-minute',status='passed',posts=1)
    finally:
        for child in children:
            if child.poll() is None:child.kill();child.wait()
        peer.release.set();peer.shutdown();peer.server_close();thread.join(timeout=5)
