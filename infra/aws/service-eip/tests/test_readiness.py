import contextlib
import io
import http.client
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import lambda_function as checker

class ReadinessTests(unittest.TestCase):
    def test_health_timing_and_result(self):
        logs = []
        self.assertTrue(checker.ready('8.8.8.8', lambda ip, path: (200, b'OK'), emit=logs.append))
        probe, result = logs
        self.assertEqual(('health', 'ok', 200), (probe['stage'], probe['reason'], probe['http_status']))
        self.assertTrue(result['ready'])
        self.assertTrue(all(event['elapsed_ms'] >= 0 for event in logs))

    def test_unusable_health_response(self):
        for status, expected in [(503, 'http-error'), (302, 'http-error'), (200, 'invalid-response')]:
            with self.subTest(status=status):
                logs = []
                def http(ip, path):
                    return status, b'TOP_SECRET'
                self.assertFalse(checker.ready('8.8.8.8', http, emit=logs.append))
                self.assertEqual(expected, logs[0]['reason'])
                self.assertNotIn('TOP_SECRET', str(logs))

    def test_invalid_candidate_address_never_probed(self):
        for ip in [None, '127.0.0.1', 'example.com', '::1']:
            with self.subTest(ip=ip):
                self.assertFalse(checker.ready(ip, self.fail, emit=lambda event: None))


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
            return checker.handle(EVENT,ec2=ec2,env=ENV,http=http,sleep=sleep,invocation_id='request-123')
    def test_attach_on_health_without_requesting_weather(self):
        ec2 = FakeEC2()
        requests = []
        def health_only(ip, path):
            requests.append((ip, path))
            self.assertEqual('/health', path)
            return 200, b'OK'

        self.assertEqual({'status': 'attached'}, self.run_handle(ec2, health_only))
        self.assertEqual([('8.8.8.8', '/health')], requests)
        self.assertEqual(1, len(ec2.associations))

    def test_truncated_health_body_cannot_attach(self):
        ec2 = FakeEC2()
        def response():
            stream = io.BytesIO(b'HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\nOK')
            sock = Mock()
            sock.makefile.return_value = stream
            parsed = http.client.HTTPResponse(sock)
            parsed.begin()
            return parsed

        with patch.object(http.client, 'HTTPConnection') as connection:
            connection.return_value.getresponse.side_effect = response
            with self.assertRaises(checker.RetryableError) as failure:
                self.run_handle(ec2, checker.http_get)
        self.assertEqual('health', json.loads(str(failure.exception))['last_probe']['stage'])
        self.assertEqual([], ec2.associations)

    def test_eventual_success_once(self):
        ec2 = FakeEC2()
        paths = []
        def http(ip, path):
            paths.append(path)
            return (503, b'') if len(paths) == 1 else (200, b'OK')
        self.assertEqual({'status': 'attached'}, self.run_handle(ec2, http))
        self.assertEqual(['/health', '/health'], paths)
        self.assertEqual(1, len(ec2.associations))
    def test_exhaustion_no_association_or_later_loop(self):
        ec2=FakeEC2();calls=[]
        def http(ip,path):calls.append(path);return (503,b'')
        with self.assertRaises(checker.RetryableError) as error:self.run_handle(ec2,http)
        self.assertEqual('candidate-not-ready',json.loads(str(error.exception))['reason'])
        self.assertEqual(['/health'] * 18,calls);self.assertEqual([],ec2.associations)
        self.assertEqual('health',json.loads(str(error.exception))['last_probe']['stage'])
    def test_live_owner_and_wrong_ami_refused(self):
        for attr,value in [('state','running'),('image','ami-other')]:
            ec2=FakeEC2();setattr(ec2,attr,value)
            self.assertEqual({'status':'refused'},self.run_handle(ec2,lambda *x:self.fail('probe before guard')))
            self.assertEqual([],ec2.associations)
    def test_owner_changes_during_probe_refused(self):
        ec2=FakeEC2()
        def http(ip,path):
            ec2.owner='i-abcdef12'
            return 200, b'OK'
        self.assertEqual({'status':'refused'},self.run_handle(ec2,http));self.assertEqual([],ec2.associations)

class SocketTimeoutTests(unittest.TestCase):
    def test_socket_timeout_classified_across_local_runtimes(self):
        import socket
        def http(ip,path):raise socket.timeout('TOP_SECRET')
        events=[]
        self.assertFalse(checker.ready('8.8.8.8',http,emit=events.append))
        self.assertEqual('timeout',events[0]['reason'])
        self.assertNotIn('TOP_SECRET',str(events))
