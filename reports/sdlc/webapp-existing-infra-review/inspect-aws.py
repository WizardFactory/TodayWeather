"""Bounded read-only control-plane inspection; never serialize credentials/environment."""
from pathlib import Path
from datetime import datetime, timezone
import json
import os
import boto3
from botocore.config import Config

root = Path(__file__).resolve().parents[3]
credential_file = root / '.aws/credentials'
if not credential_file.is_file():
    credential_file = Path('/root/workspace/TodayWeather/.aws/credentials')
os.environ['AWS_SHARED_CREDENTIALS_FILE'] = str(credential_file)
session = boto3.Session(profile_name='141248341265', region_name='ap-northeast-2')
config = Config(connect_timeout=6, read_timeout=12, retries={'max_attempts': 0})
client = lambda name: session.client(name, config=config)
account = client('sts').get_caller_identity()['Account']
assert account == '141248341265', 'Unexpected AWS account'
result = {'observed_at': datetime.now(timezone.utc).isoformat(), 'account': account}
distribution = client('cloudfront').get_distribution_config(Id='E3QLRH0LJD07QR')
dist = distribution['DistributionConfig']
def behavior(item):
    return {k: item[k] for k in ('PathPattern', 'TargetOriginId', 'ViewerProtocolPolicy', 'AllowedMethods', 'ForwardedValues', 'MinTTL', 'DefaultTTL', 'MaxTTL', 'CachePolicyId', 'OriginRequestPolicyId', 'ResponseHeadersPolicyId', 'FunctionAssociations', 'LambdaFunctionAssociations') if k in item}
result['cloudfront'] = {
    'id': 'E3QLRH0LJD07QR', 'etag': distribution['ETag'],
    'aliases': dist.get('Aliases', {}).get('Items', []),
    'default_behavior': behavior(dist['DefaultCacheBehavior']),
    'behaviors': [behavior(b) for b in dist.get('CacheBehaviors', {}).get('Items', [])],
    'origins': [{k: o[k] for k in ('Id', 'DomainName', 'OriginPath', 'CustomOriginConfig', 'S3OriginConfig') if k in o} for o in dist['Origins']['Items']],
}
gateway = client('apigateway')
stage = gateway.get_stage(restApiId='5hktkqusyb', stageName='production')
result['api_stage'] = {k: stage[k] for k in ('stageName', 'deploymentId', 'cacheClusterEnabled', 'methodSettings') if k in stage}
resources = []
for page in gateway.get_paginator('get_resources').paginate(restApiId='5hktkqusyb'):
    resources.extend({'path': r['path'], 'methods': sorted(r.get('resourceMethods', {}))} for r in page['items'] if r.get('resourceMethods'))
result['api_resources_current_control_plane_not_stage_export'] = resources
lam = client('lambda')
result['lambdas'] = []
for suffix in ('weatherbycoord', 'weatherbyaddr', 'geoinfobycoord', 'geoinfobyaddr'):
    info = lam.get_function_configuration(FunctionName='tw-backend-functions-production-' + suffix)
    result['lambdas'].append({k: info[k] for k in ('FunctionName', 'Runtime', 'LastModified', 'CodeSha256', 'Timeout')})
output = Path(__file__).with_name('aws-evidence.json')
output.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'output': str(output.relative_to(root)), 'observed_at': result['observed_at'], 'origins': len(result['cloudfront']['origins']), 'functions': len(result['lambdas'])}))
