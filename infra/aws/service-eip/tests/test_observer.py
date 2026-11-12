import copy
import json
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import failure_observer as observer

SOURCE='arn:aws:lambda:ap-northeast-2:123456789012:function:AttachEIPToSpot'
ENV={'SOURCE_FUNCTION_ARN':SOURCE,'ALERT_TOPIC_ARN':'arn:aws:sns:ap-northeast-2:123456789012:operator'}
EVENT={'requestContext':{'functionArn':SOURCE+':$LATEST','condition':'RetriesExhausted','requestId':'request-123'},'requestPayload':{'source':'aws.ec2','detail-type':'EC2 Instance State-change Notification','account':'123456789012','region':'ap-northeast-2','detail':{'state':'running','instance-id':'i-12345678'}},'responsePayload':{'errorMessage':json.dumps({'reason':'candidate-not-ready','fleet_id':'fleet-1','last_probe':{'stage':'weather','reason':'timeout','elapsed_ms':2000,'socket_timeout_ms':2000,'deadline_ms':3000},'secret':'TOP_SECRET'})}}
class ObserverTests(unittest.TestCase):
 def test_terminal(self):
  calls=[]
  self.assertEqual({'status':'notified'},observer.handle(EVENT,env=ENV,publish=lambda **x:calls.append(x),emit=lambda x:None))
  message=json.loads(calls[0]['Message'])
  self.assertEqual('weather',message['last_probe']['stage'])
  self.assertNotIn('TOP_SECRET',str(calls))
  self.assertEqual('request-123',message['source_invocation_id'])
 def test_intermediate_or_wrong_source_refused(self):
  for name,value in [('condition','Error'),('functionArn',SOURCE+'other')]:
   e=copy.deepcopy(EVENT);e['requestContext'][name]=value
   self.assertEqual({'status':'refused'},observer.handle(e,env=ENV,publish=lambda **x:self.fail('unsafe notification')))
 def test_publish_failure_visible_and_sanitized(self):
  logs=[]
  def fail(**kwargs):raise ValueError('TOP_SECRET')
  with self.assertRaisesRegex(RuntimeError,'notification-delivery-failed'):
   observer.handle(EVENT,env=ENV,publish=fail,emit=logs.append)
  self.assertEqual('delivery',logs[-1]['reason']);self.assertNotIn('TOP_SECRET',str(logs))
 def test_bad_configuration_visible(self):
  logs=[]
  with self.assertRaisesRegex(RuntimeError,'notification-configuration'):
   observer.handle(EVENT,env={},publish=lambda **x:None,emit=logs.append)
  self.assertEqual('configuration',logs[-1]['reason'])
