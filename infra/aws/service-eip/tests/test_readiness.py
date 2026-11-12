import contextlib
import datetime as dt
import io
import json
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import lambda_function as checker

NOW=dt.datetime(2026,11,12,0,tzinfo=dt.timezone.utc)
BODY=json.dumps({'currentPubDate':'202611120900','current':{'t1h':12,'reh':55},'shortest':[{}]}).encode()
class ReadinessTests(unittest.TestCase):
    def test_success_reports_both_probe_timings(self):
        output=io.StringIO()
        with contextlib.redirect_stdout(output):
            result=checker.ready('8.8.8.8',lambda ip,path:(200,b'OK') if path=='/health' else (200,BODY),NOW)
        self.assertTrue(result)
        events=[json.loads(x) for x in output.getvalue().splitlines()]
        self.assertEqual(['health','weather'],[x['stage'] for x in events if x.get('event')=='readiness.probe'])
        self.assertTrue(all(x['elapsed_ms']>=0 for x in events))
if __name__=='__main__': unittest.main()

class FailureTests(unittest.TestCase):
    def test_classified_failures_without_raw_values(self):
        for mode,expected in [('timeout','timeout'),('status','http-error'),('json','invalid-response')]:
            logs=[]
            def http(ip,path):
                if path=='/health': return (200,b'OK')
                if mode=='timeout': raise TimeoutError('TOP_SECRET')
                return (503,b'TOP_SECRET') if mode=='status' else (200,b'TOP_SECRET')
            self.assertFalse(checker.ready('8.8.8.8',http,NOW,emit=logs.append))
            if mode!='json':self.assertEqual(expected,logs[1]['reason'])
            else:self.assertEqual(expected,logs[-1]['reason'])
            self.assertNotIn('TOP_SECRET',str(logs))
    def test_health_alone_never_passes(self):
        calls=[]
        def http(ip,path):
            calls.append(path)
            return (200,b'OK') if path=='/health' else (200,b'{}')
        self.assertFalse(checker.ready('8.8.8.8',http,NOW,emit=lambda x:None))
        self.assertEqual(2,len(calls))

class FakeEC2:
    def __init__(self):
        self.owner='i-87654321';self.associations=[];self.state='stopped';self.image='ami-test'
    def describe_instances(self,InstanceIds):
        iid=InstanceIds[0]
        instance={'InstanceId':iid,'State':{'Name':self.state}} if iid=='i-87654321' else {'InstanceId':iid,'State':{'Name':'running'},'InstanceLifecycle':'spot','SpotInstanceRequestId':'sir-test','ImageId':self.image,'PublicIpAddress':'8.8.8.8','Tags':[{'Key':'aws:ec2spot:fleet-request-id','Value':'fleet-test'}]}
        return {'Reservations':[{'Instances':[instance]}]}
    def describe_addresses(self,AllocationIds):return {'Addresses':[{'AllocationId':'eipalloc-test','InstanceId':self.owner,'AssociationId':'assoc-test'}]}
    def describe_spot_fleet_requests(self,**kwargs):return {'SpotFleetRequestConfigs':[{'SpotFleetRequestId':'fleet-test','SpotFleetRequestState':'active','SpotFleetRequestConfig':{'Type':'maintain','TargetCapacity':1}}]}
    def describe_spot_fleet_instances(self,**kwargs):return {'ActiveInstances':[{'InstanceId':'i-12345678'}]}
    def associate_address(self,**kwargs):self.associations.append(kwargs);self.owner=kwargs['InstanceId']

ENV={'ATTACH_ENABLED':'true','TARGET_FLEET_ID':'fleet-test','TARGET_AMI_ID':'ami-test','EIP_ALLOCATION_ID':'eipalloc-test','EXPECTED_ACCOUNT_ID':'123456789012','AWS_REGION':'ap-northeast-2'}
EVENT={'id':'event-123','source':'aws.ec2','detail-type':'EC2 Instance State-change Notification','account':'123456789012','region':'ap-northeast-2','detail':{'state':'running','instance-id':'i-12345678'}}
class GuardTests(unittest.TestCase):
    def run_handle(self,ec2,http,sleep=lambda x:None):
        with contextlib.redirect_stdout(io.StringIO()):
            return checker.handle(EVENT,ec2=ec2,env=ENV,http=http,sleep=sleep,now=lambda:NOW,invocation_id='request-123')
    def test_eventual_success_once(self):
        ec2=FakeEC2();weather=[]
        def http(ip,path):
            if path=='/health':return 200,b'OK'
            weather.append(path);return (200,BODY) if len(weather)>1 else (503,b'bad')
        self.assertEqual({'status':'attached'},self.run_handle(ec2,http))
        self.assertEqual(1,len(ec2.associations));self.assertEqual(2,len(weather))
    def test_exhaustion_no_association_or_later_loop(self):
        ec2=FakeEC2();calls=[]
        def http(ip,path):calls.append(path);return (200,b'OK') if path=='/health' else (200,b'{}')
        with self.assertRaises(checker.RetryableError) as error:self.run_handle(ec2,http)
        self.assertEqual('candidate-not-ready',json.loads(str(error.exception))['reason'])
        self.assertEqual(36,len(calls));self.assertEqual([],ec2.associations)
        self.assertEqual('validation',json.loads(str(error.exception))['last_probe']['stage'])
    def test_live_owner_and_wrong_ami_refused(self):
        for attr,value in [('state','running'),('image','ami-other')]:
            ec2=FakeEC2();setattr(ec2,attr,value)
            self.assertEqual({'status':'refused'},self.run_handle(ec2,lambda *x:self.fail('probe before guard')))
            self.assertEqual([],ec2.associations)
    def test_owner_changes_during_probe_refused(self):
        ec2=FakeEC2()
        def http(ip,path):
            ec2.owner='i-abcdef12'
            return (200,b'OK') if path=='/health' else (200,BODY)
        self.assertEqual({'status':'refused'},self.run_handle(ec2,http));self.assertEqual([],ec2.associations)
