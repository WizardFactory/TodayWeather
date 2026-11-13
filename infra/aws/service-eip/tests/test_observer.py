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
 def test_terminal_preserves_status_and_original_event_id(self):
  e=copy.deepcopy(EVENT);e['requestPayload']['id']='event-original'
  e['responsePayload']['errorMessage']=json.dumps({'reason':'candidate-not-ready','last_probe':{'stage':'weather','reason':'http-error','http_status':503}})
  calls=[];observer.handle(e,env=ENV,publish=lambda **x:calls.append(x),emit=lambda x:None)
  self.assertEqual(503,json.loads(calls[-1]['Message'])['last_probe'].get('http_status'))
  self.assertEqual('event-original',json.loads(calls[-1]['Message'])['event_id'])
  e['responsePayload']['errorMessage']='time-budget'
  observer.handle(e,env=ENV,publish=lambda **x:calls.append(x),emit=lambda x:None)
  self.assertEqual('event-original',json.loads(calls[-1]['Message'])['event_id'])
 def test_untrusted_status_is_not_copied(self):
  for value in [True,'TOP_SECRET',99,600]:
   e=copy.deepcopy(EVENT);summary=json.loads(e['responsePayload']['errorMessage']);summary['last_probe']['http_status']=value;e['responsePayload']['errorMessage']=json.dumps(summary)
   calls=[];observer.handle(e,env=ENV,publish=lambda **x:calls.append(x),emit=lambda x:None)
   self.assertNotIn('http_status',json.loads(calls[-1]['Message'])['last_probe'])
