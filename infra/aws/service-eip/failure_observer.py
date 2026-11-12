"""Consume Lambda OnFailure records; deliberately has no EC2 dependency."""
import json
import math
import os
import re

MANUAL_REFERENCE = 'docs/operations/service-eip-readiness.md#manual-recheck'
REASONS = {'candidate-not-ready', 'time-budget', 'association-unverified',
           'candidate-metadata-pending', 'operation-failed'}
PROBE_REASONS = {'timeout', 'transport-error', 'http-error', 'invalid-response'}


def emit_event(record):
    print(json.dumps(record, separators=(',', ':'), allow_nan=False))


def identifier(value, pattern=r'[a-zA-Z0-9_-]{1,100}'):
    return value if isinstance(value, str) and re.fullmatch(pattern, value) else None


def handle(event, *, env, publish, emit=emit_event):
    source = env.get('SOURCE_FUNCTION_ARN', '')
    topic = env.get('ALERT_TOPIC_ARN', '')
    if (not re.fullmatch(r'arn:aws:lambda:[a-z0-9-]+:[0-9]{12}:function:AttachEIPToSpot', source)
            or not re.fullmatch(r'arn:aws:sns:[a-z0-9-]+:[0-9]{12}:[a-zA-Z0-9_-]+', topic)
            or source.split(':')[3:5] != topic.split(':')[3:5]):
        emit({'event': 'notification.failed', 'reason': 'configuration'})
        raise RuntimeError('notification-configuration')
    event = event if isinstance(event, dict) else {}
    context = event.get('requestContext')
    request = event.get('requestPayload')
    if not isinstance(context, dict) or not isinstance(request, dict):
        return {'status': 'refused'}
    arn = context.get('functionArn')
    condition = context.get('condition')
    account, region = source.split(':')[4], source.split(':')[3]
    detail = request.get('detail')
    if (arn not in (source, source + ':$LATEST')
            or condition not in ('RetriesExhausted', 'EventAgeExceeded')
            or request.get('source') != 'aws.ec2'
            or request.get('detail-type') != 'EC2 Instance State-change Notification'
            or request.get('account') != account or request.get('region') != region
            or not isinstance(detail, dict) or detail.get('state') != 'running'):
        return {'status': 'refused'}
    candidate = identifier(detail.get('instance-id'), r'i-(?:[0-9a-f]{8}|[0-9a-f]{17})')
    invocation = identifier(context.get('requestId'))
    if not candidate or not invocation:
        return {'status': 'refused'}
    payload = event.get('responsePayload')
    error = payload.get('errorMessage') if isinstance(payload, dict) else None
    diagnostic = {}
    if isinstance(error, str) and len(error) <= 4096:
        try:
            value = json.loads(error)
            if isinstance(value, dict):
                diagnostic = value
        except ValueError:
            if error in REASONS:
                diagnostic = {'reason': error}
    message = {'event': 'readiness.terminal', 'candidate_id': candidate,
               'source_invocation_id': invocation, 'condition': condition,
               'reason': diagnostic.get('reason') if isinstance(diagnostic.get('reason'), str) and diagnostic.get('reason') in REASONS else 'unknown',
               'manual_reference': MANUAL_REFERENCE}
    for name in ('fleet_id', 'event_id'):
        message[name] = identifier(diagnostic.get(name))
    probe = diagnostic.get('last_probe')
    if isinstance(probe, dict):
        clean = {}
        if probe.get('stage') in ('health', 'weather', 'validation'):
            clean['stage'] = probe['stage']
        if isinstance(probe.get('reason'), str) and probe.get('reason') in PROBE_REASONS:
            clean['reason'] = probe['reason']
        for key in ('elapsed_ms', 'socket_timeout_ms', 'deadline_ms'):
            n = probe.get(key)
            if type(n) in (int, float) and math.isfinite(n) and 0 <= n <= 3600000:
                clean[key] = n
        message['last_probe'] = clean
    try:
        publish(TopicArn=topic, Subject='Spot EIP readiness terminal failure',
                Message=json.dumps(message, separators=(',', ':'), allow_nan=False))
    except Exception:
        emit({'event': 'notification.failed', 'reason': 'delivery',
              'source_invocation_id': invocation, 'candidate_id': candidate})
        raise RuntimeError('notification-delivery-failed') from None
    emit({'event': 'notification.sent', 'source_invocation_id': invocation,
          'candidate_id': candidate})
    return {'status': 'notified'}


def lambda_handler(event, context):
    import boto3
    from botocore.config import Config
    client = boto3.client('sns', config=Config(connect_timeout=2, read_timeout=3,
                          retries={'total_max_attempts': 1}))
    return handle(event, env=dict(os.environ), publish=client.publish)
