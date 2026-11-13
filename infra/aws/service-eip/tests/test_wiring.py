import json
import unittest
from pathlib import Path
class WiringTests(unittest.TestCase):
 def test_bounded_destination_and_no_ec2_observer_permissions(self):
  x=json.loads((Path(__file__).resolve().parents[1]/'notification-stack.json').read_text())['Resources']
  p=x['SourceFailureDestination']['Properties']
  self.assertEqual((2,1800),(p['MaximumRetryAttempts'],p['MaximumEventAgeInSeconds']))
  self.assertEqual({'Fn::GetAtt':['Observer','Arn']},p['DestinationConfig']['OnFailure']['Destination'])
  permissions=x['ObserverRole']['Properties']['Policies'][0]['PolicyDocument']['Statement']
  actions=[a for s in permissions for a in (s['Action'] if isinstance(s['Action'],list) else [s['Action']])]
  self.assertEqual({'logs:CreateLogStream','logs:PutLogEvents','sns:Publish'},set(actions))
  metrics=[v['Properties'].get('MetricName') for v in x.values() if v['Type']=='AWS::CloudWatch::Alarm']
  self.assertEqual({'DestinationDeliveryFailures','Errors','AsyncEventsDropped'},set(metrics))
