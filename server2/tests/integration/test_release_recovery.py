#!/usr/bin/env python3
"""Admission/retention controls. Fake executable inputs never attest product behavior."""
import importlib.util,json,pathlib,tempfile,unittest,hashlib
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('release_recovery',ROOT/'tools/shadow/release_recovery.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
ROLES=('server2','loopback_server','kma_s3_replay','domestic','summary','state','runtime_services','warnings_smoke','notice_smoke','conditional_alert_smoke','warning_push_smoke')
class Admission(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.temp.name);self.manifest=self.root/'pair.json';self.data={'schema':1,'releases':{}}
  for index,role in enumerate(('current','previous')):
   artifacts={}
   for name in ROLES:
    p=self.root/role/('examples/'+name if name in ('loopback_server','kma_s3_replay') else name);p.parent.mkdir(parents=True,exist_ok=True);p.write_text('#!/bin/sh\nexit 0\n# admission-only '+role+'/'+name+'\n');p.chmod(0o700)
    artifacts[name]={'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'profile':'release'}
   self.data['releases'][role]={'revision':str(index+1)*40,'artifacts':artifacts}
  self.write()
 def tearDown(self):self.temp.cleanup()
 def write(self):self.manifest.write_text(json.dumps(self.data))
 def rejected(self):
  self.write()
  with self.assertRaises(ValueError):module.validate_pair(self.manifest)
 def test_valid_complete_distinct_pair_admits(self):
  try:answer=module.validate_pair(self.manifest)
  except ValueError:answer=None
  self.assertIsNotNone(answer,'a complete distinct pair must admit the fixed local capabilities')
 def test_equal_revision_rejected(self):self.data['releases']['previous']['revision']='1'*40;self.rejected()
 def test_missing_role_rejected(self):del self.data['releases']['previous']['artifacts']['state'];self.rejected()
 def test_unknown_role_rejected(self):self.data['releases']['previous']['artifacts']['shell_command']={};self.rejected()
 def test_bad_hash_in_unselected_role_rejected(self):self.data['releases']['previous']['artifacts']['runtime_services']['sha256']='0'*64;self.rejected()
 def test_nonrelease_rejected(self):self.data['releases']['current']['artifacts']['state']['profile']='debug';self.rejected()
 def test_equal_worker_bytes_rejected(self):self.data['releases']['previous']['artifacts']['runtime_services']=self.data['releases']['current']['artifacts']['runtime_services'];self.rejected()
 def test_unknown_manifest_key_rejected(self):self.data['command']='sh';self.rejected()
 def test_noop_execution_cannot_pass(self):
  out=self.root/'noop'
  with patch.object(module,'run',return_value=None):code=module.main(['--artifacts',str(self.manifest),'--out',str(out)])
  self.assertEqual(code,1,'missing layer/phase evidence must fail closed')
  self.assertEqual(json.loads((out/'report.json').read_text())['verdict'],'FAIL')
 def test_corrupt_unselected_role_never_launches(self):
  self.data['releases']['previous']['artifacts']['runtime_services']['sha256']='0'*64;self.write()
  with patch.object(module,'run') as child:
   self.assertEqual(module.main(['--artifacts',str(self.manifest),'--out',str(self.root/'bad')]),2);child.assert_not_called()
 def test_existing_output_is_untouched(self):
  out=self.root/'existing';out.mkdir();sentinel=out/'report.json';sentinel.write_text('original')
  with patch.object(module,'run') as child:
   self.assertEqual(module.main(['--artifacts',str(self.manifest),'--out',str(out)]),2);child.assert_not_called()
  self.assertEqual(sentinel.read_text(),'original')
 def test_unsupported_production_scope_never_launches(self):
  with patch.object(module,'run') as child:
   self.assertEqual(module.main(['--artifacts',str(self.manifest),'--out',str(self.root/'scope'),'--scope','whole-service']),2);child.assert_not_called()
 def test_child_failure_is_retained(self):
  out=self.root/'child-fail'
  def fail(pair,path,report):report['layers']['durable-workers']=[{'id':'current-post','status':'FAIL'}];raise RuntimeError('synthetic private error must not enter report')
  with patch.object(module,'run',side_effect=fail):self.assertEqual(module.main(['--artifacts',str(self.manifest),'--out',str(out)]),1)
  report=json.loads((out/'report.json').read_text());self.assertEqual(report['layers']['durable-workers'][0]['status'],'FAIL');self.assertNotIn('synthetic private',json.dumps(report))
if __name__=='__main__':unittest.main()
