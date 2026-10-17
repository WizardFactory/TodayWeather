#!/usr/bin/env python3
"""Fixed, local release-pair evidence. Not a deployment, replay or rollback command."""
import argparse,gzip,hashlib,json,os,re,signal,sys,tempfile,threading,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools'));sys.path.insert(0,str(ROOT/'tools/shadow'))
import native_suite
import native_rollback
import runtime_services_smoke as workers
ROLES=set(native_suite.ROLES)
FAMILIES=[c.id for c in native_suite.CHECKS if c.id not in ('world','workers')]
PHASES=('weather','oauth','before-post','post','result','ambiguous','happy')
SCOPE='local-layers'

def digest(path):return native_suite.sha256(path)
def verify(pair):
 for release in pair.values():
  for name,item in release['artifacts'].items():native_suite.verify_artifact(name,item)

def validate_pair(path):
 path=Path(path).resolve();data=json.loads(path.read_text())
 if not isinstance(data,dict) or set(data)!={'schema','releases'} or data['schema']!=1 or not isinstance(data['releases'],dict) or set(data['releases'])!={'current','previous'}:raise ValueError('exact current/previous release manifest required')
 pair={}
 for role,release in data['releases'].items():
  if not isinstance(release,dict) or set(release)!={'revision','artifacts'} or not isinstance(release['revision'],str) or not re.fullmatch('[0-9a-f]{40}',release['revision']) or not isinstance(release['artifacts'],dict) or set(release['artifacts'])!=ROLES:raise ValueError('every release requires exactly eleven artifact roles and a full revision')
  artifacts={}
  for name,item in release['artifacts'].items():
   if not isinstance(item,dict) or set(item)!={'path','sha256','profile'} or item['profile']!='release' or not isinstance(item['path'],str) or not item['path'] or not isinstance(item['sha256'],str) or not re.fullmatch('[0-9a-f]{64}',item['sha256']):raise ValueError('explicit executable path, SHA256 and release profile required')
   artifacts[name]=dict(item,path=str((path.parent/item['path']).resolve()))
  expected=Path(artifacts['server2']['path']).parent/'examples/kma_s3_replay'
  if expected.resolve()!=Path(artifacts['kma_s3_replay']['path']):raise ValueError('KMA replay must be beside the selected server2')
  pair[role]=dict(revision=release['revision'],artifacts=artifacts)
 if pair['current']['revision']==pair['previous']['revision']:raise ValueError('distinct release revisions required')
 for name in ROLES:
  if pair['current']['artifacts'][name]['sha256']==pair['previous']['artifacts'][name]['sha256']:raise ValueError('distinct corresponding artifact bytes required: '+name)
 verify(pair)
 return pair

def prepare_output(out):
 out=Path(out).resolve()
 if out==ROOT or ROOT in out.parents:raise ValueError('output must be outside server2')
 out.mkdir(parents=True,exist_ok=False)
 return out

def save(out,report):
 temporary=out/'report.tmp';temporary.write_text(json.dumps(report,indent=2)+'\n');temporary.replace(out/'report.json')

def boot(binary,root,key,path,children):
 log=path.open('w+');p=workers.start(binary,root,key,'term',log);children.append((p,log))
 def address():
  text=path.read_text();match=re.search(r'server2 public=(127\.0\.0\.1:\d+) metrics=',text)
  assert p.poll() is None,'process exited before readiness'
  return 'http://'+match[1] if match else None
 base=workers.wait_for(address)
 assert workers.request(base+'/health')==(200,'OK')
 assert workers.request(base+'/v000903/notice/latest')==(200,'{"notice":null}')
 return p,base

def stop(p):
 if p.poll() is None:os.kill(p.pid,signal.SIGTERM)
 assert p.wait(timeout=36)==0,'unclean production-lifecycle child stop'

def claims(peer):
 with peer.lock:return {k:hashlib.sha256(v.body).hexdigest() for k,v in peer.objects.items() if '/delivery/' in k and not k.endswith('.result.json')}

def admission_count(peer):
 with peer.lock:return sum(n for k,n in peer.counts.items() if k.startswith('PUT ') and '/delivery/' in k and not k.endswith('.result.json'))

def posts(peer):return sum(e['kind']=='post' for e in list(peer.events))

def ledger_outcomes(peer):
 with peer.lock: bodies=[v.body for k,v in peer.objects.items() if k.endswith('.result.json')]
 return sorted(row['outcome'] for body in bodies for row in json.loads(body).get('deliveries',[]))

def durable_case(pair,out,role,phase):
 peer=workers.peer_module.make(phase);thread=threading.Thread(target=peer.serve_forever,daemon=True);thread.start();root=f'http://127.0.0.1:{peer.server_port}/';children=[]
 other='previous' if role=='current' else 'current';label=role+'-'+phase;result=dict(id=label,status='RUNNING',phases=[],native_fetch='injected recorded HTTP, not full provider startup')
 try:
  with tempfile.TemporaryDirectory(prefix='server2-release-pair-') as directory:
   key=Path(directory)/'synthetic-account.json';workers.account(key)
   binary=Path(pair[role]['artifacts']['runtime_services']['path']);p,base=boot(binary,root,key,out/(label+'-initial.log'),children)
   # Restore completes before registration, as required by the existing admission contract.
   time.sleep(.1)
   body=[dict(type='ios',fcmToken='synthetic-release-pair',cityIndex=1,id=1,town={'first':'Seoul'},source='KMA',lang='ko',package='todayWeather',pushTime=420)]
   if phase=='happy':
    fixture=json.load(gzip.open(ROOT/'tests/delivery/fixtures/alerts-oracle.json.gz'));alert=next(c for c in fixture['cases'] if c['id']=='current-ko-1')['record'].copy();alert.update(category='alert',type='ios',fcmToken='synthetic-release-alert',cityIndex=2,id=2,town={'first':'Busan'},source='KMA',package='todayWeather');alert.pop('geo',None);body.append(alert)
   answer=workers.request(base+'/v000902/push-list',body);assert answer[0]==200 and 'upserted' in answer[1],'initial registration was not acknowledged'
   if phase=='happy':
    workers.wait_for(lambda:posts(peer)==2);workers.wait_for(lambda:sum(k.endswith('.result.json') for k in peer.objects)==2)
   elif phase=='ambiguous':
    workers.wait_for(lambda:any(e['kind']=='ambiguous' for e in peer.events));workers.wait_for(lambda:any(k.endswith('.result.json') for k in peer.objects))
   else:workers.wait_for(lambda:any(e['kind']=='held' and e['phase']==phase for e in peer.events))
   before_posts=posts(peer);expected=2 if phase=='happy' else 1 if phase in ('post','result','ambiguous') else 0
   assert before_posts==expected,'unexpected original send count'
   original_claims=claims(peer);assert len(original_claims)==(2 if phase=='happy' else 1),'expected durable claim missing'
   began=time.monotonic();os.kill(p.pid,signal.SIGTERM)
   if phase=='before-post':peer.release.set()
   assert p.wait(timeout=36)==0,'initial stop failed'
   elapsed=time.monotonic()-began;assert elapsed<=35,'existing process stop bound exceeded'
   peer.release.set();peer.phase='happy'
   outcomes=ledger_outcomes(peer)
   if phase=='ambiguous':assert 'unknown' in outcomes,'ambiguous send was not recorded as unknown'
   if phase=='happy':assert outcomes==['accepted','accepted'],'successful peer acceptance outcome absent'
   result['phases'].append(dict(role=role,stage='initial',posts=before_posts,claims=len(original_claims),shutdown_seconds=round(elapsed,3)))
   for number,restored_role in enumerate((other,role),1):
    before=admission_count(peer);binary=Path(pair[restored_role]['artifacts']['runtime_services']['path']);p,base=boot(binary,root,key,out/(label+'-restore'+str(number)+'.log'),children)
    # An attempted durable claim proves the scheduled restored cycle ran; a sleep alone cannot pass.
    workers.wait_for(lambda:admission_count(peer)>before,timeout=10)
    assert posts(peer)==before_posts,'retained claim was replayed after release change'
    assert claims(peer)==original_claims,'claim bytes/ownership changed during restore'
    # Public update must match acknowledged old state, never silently create a replacement record.
    update=[dict(body[0],name='synthetic-restored-'+str(number))]
    response=workers.request(base+'/v000902/push-list',update)
    decoded=json.loads(response[1]);assert response[0]==200 and decoded[0].get('nModified')==1 and not decoded[0].get('upserted'),'acknowledged registration did not restore as an existing record'
    stop(p);assert posts(peer)==before_posts,'extra post during restored drain';assert claims(peer)==original_claims
    result['phases'].append(dict(role=restored_role,stage='restore',claim_admission_observed=True,posts=posts(peer),claims=len(original_claims),existing_registration_modified=1))
   assert all(e.get('path','').startswith('/v000902/kma/addr/') for e in peer.events if e['kind']=='native'),'unexpected native request path'
   result.update(status='PASS',posts=before_posts,claims=len(original_claims),claim_hashes=sorted(original_claims.values()),unknown_send_preserved=phase=='ambiguous' and 'unknown' in outcomes,initial_ledger_outcomes=outcomes,device_sends=0)
   return result
 finally:
  for p,log in children:
   if p.poll() is None:p.kill();p.wait()
   log.close()
  peer.release.set();peer.shutdown();peer.server_close();thread.join(timeout=5)

def overlap(pair,out):
 peer=workers.peer_module.make('happy');thread=threading.Thread(target=peer.serve_forever,daemon=True);thread.start();root=f'http://127.0.0.1:{peer.server_port}/';children=[]
 try:
  with tempfile.TemporaryDirectory(prefix='server2-release-overlap-') as directory:
   key=Path(directory)/'synthetic-account.json';workers.account(key)
   p,base=boot(Path(pair['current']['artifacts']['runtime_services']['path']),root,key,out/'overlap-current.log',children);time.sleep(.1)
   body=[dict(type='ios',fcmToken='synthetic-release-overlap',cityIndex=1,id=1,town={'first':'Seoul'},source='KMA',pushTime=420)]
   response=workers.request(base+'/v000902/push-list',body);assert 'upserted' in response[1]
   before=admission_count(peer);q,_=boot(Path(pair['previous']['artifacts']['runtime_services']['path']),root,key,out/'overlap-previous.log',children)
   workers.wait_for(lambda:posts(peer)==1);workers.wait_for(lambda:admission_count(peer)>=before+2)
   for child,_ in children:stop(child)
   assert posts(peer)==1 and len(claims(peer))==1,'mixed releases had multiple delivery owners'
   with peer.response_lock: conflicts=sum(n for k,n in peer.response_counts.items() if k.startswith('STATUS 412 ') and '/delivery/' in k and not k.endswith('.result.json'))
   assert conflicts>=1,'second release did not observe a conditional claim conflict'
   return dict(status='PASS',id='mixed-release-overlap',posts=1,claims=1,admission_attempts=admission_count(peer)-before,device_sends=0)
 finally:
  for child,log in children:
   if child.poll() is None:child.kill();child.wait()
   log.close()
  peer.release.set();peer.shutdown();peer.server_close();thread.join(timeout=5)

def run(pair,out,report):
 report['layers']={};save(out,report)
 for role in ('current','previous'):
  verify(pair);manifest=out/(role+'-artifacts.json');manifest.write_text(json.dumps(dict(schema=1,**pair[role]),indent=2)+'\n')
  code,result=native_suite.run(manifest,out/(role+'-families'),FAMILIES)
  report['layers'][role+'-families']=dict(verdict=result['verdict'],report=str(Path(role+'-families')/'report.json'),sha256=digest(out/(role+'-families')/'report.json'),selected=result['selected'],full_coverage=False)
  save(out,report)
  if code:raise AssertionError('family contract layer failed: '+role)
  print('PASS '+role+': nine family contract layers',flush=True)
 verify(pair);api_pair={r:dict(pair[r]['artifacts']['loopback_server'],revision=pair[r]['revision']) for r in pair}
 api_report={};report['layers']['native-api']=api_report
 try:api_report.update(native_rollback.run(api_pair,api_report));api_report['verdict']='PASS'
 finally:save(out,report)
 # Sequential, owned fixture per case; no concurrent Cargo build or shared mutable peer between cases.
 rows=report['layers']['durable-workers']=[]
 for role in ('current','previous'):
  for phase in PHASES:
   verify(pair);row=dict(id=role+'-'+phase,status='RUNNING');rows.append(row);save(out,report)
   try:row.update(durable_case(pair,out,role,phase))
   except Exception as error:row.update(status='FAIL',error_class=type(error).__name__);raise
   finally:save(out,report)
   print('PASS '+row['id']+': opposite/original restore, no replay',flush=True)
 verify(pair);report['layers']['overlap']=overlap(pair,out);save(out,report);print('PASS mixed-release overlap: one owner',flush=True)
 verify(pair)

def assess(report):
 layers=report.get('layers',{})
 assert set(layers)=={'current-families','previous-families','native-api','durable-workers','overlap'},'required layer evidence missing'
 for role in ('current','previous'):
  family=layers[role+'-families']
  assert family.get('verdict')=='PASS' and family.get('selected')==FAMILIES,'family results incomplete'
 api=layers['native-api'];assert api.get('verdict')=='PASS' and api.get('legacy_http')==0 and api.get('weather_restore_calls')==0,'native API recovery incomplete'
 assert len(api.get('phases',[]))==3 and all(p.get('complete') for p in api['phases']),'native API phase missing'
 rows=layers['durable-workers'];expected={r+'-'+p for r in ('current','previous') for p in PHASES}
 assert len(rows)==len(expected) and {x.get('id') for x in rows}==expected,'durable phase inventory incomplete'
 for row in rows:
  assert row.get('status')=='PASS' and len(row.get('phases',[]))==3,'durable phase failed or absent'
  assert all(p.get('claim_admission_observed') and p.get('existing_registration_modified')==1 for p in row['phases'][1:]),'restored process did not exercise the contract'
 overlap=layers['overlap'];assert overlap.get('status')=='PASS' and overlap.get('posts')==1 and overlap.get('claims')==1,'overlap did not establish one owner'

def main(argv=None):
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--artifacts',type=Path,required=True);parser.add_argument('--out',type=Path,required=True);parser.add_argument('--validate-only',action='store_true');parser.add_argument('--scope',default=SCOPE);args=parser.parse_args(argv)
 report=dict(schema=1,scope=SCOPE,verdict='BLOCKED',started_at_utc=native_suite.utc(),layers={},live_actions=False,whole_service_eligible=False,limitations=['Paired family library/HTTP layers are separate from a full application rollback.', 'Worker process uses production lifecycle with injected NativeFetch and clock.', 'No production host/configuration, live provider/device, live shadow or2724 evidence.', 'Caller release revisions/profiles are provenance declarations, not signed attestations.'])
 out=None
 try:
  out=prepare_output(args.out)
  if args.scope!=SCOPE:raise ValueError('unsupported scope; whole-service/production eligibility is not implemented')
  pair=validate_pair(args.artifacts);report['artifacts']=pair;report['manifest_sha256']=digest(args.artifacts)
  if args.validate_only:report['verdict']='ELIGIBLE';return_code=0
  else:
   report['verdict']='RUNNING';run(pair,out,report);assess(report);report['verdict']='PASS';return_code=0
 except Exception as error:
  report['error_class']=type(error).__name__;report['error']=str(error) if isinstance(error,ValueError) else 'Execution failed; inspect retained layer and owned process logs.'
  if report['verdict']=='RUNNING':report['verdict']='FAIL'
  return_code=2 if report['verdict']=='BLOCKED' else 1
 finally:
  report['finished_at_utc']=native_suite.utc()
  if out:
   report['evidence']=[dict(path=str(p.relative_to(out)),sha256=digest(p)) for p in sorted(out.rglob('*')) if p.is_file() and p!=out/'report.json' and p!=out/'report.tmp']
   save(out,report)
 print(report['verdict']+' local paired-release verification',flush=True)
 return return_code
if __name__=='__main__':raise SystemExit(main())
