"""Fail-closed service EIP automation."""
import re
import datetime as dt
import ipaddress
import json
import math
import http.client
from http.client import HTTPException
import signal
import time

HTTP_DEADLINE = 3


def http_timeout(signum, frame):
    raise TimeoutError('http-deadline')


def http_get(ip, path):
    """Direct HTTP without proxy discovery, DNS or redirect handling."""
    conn = http.client.HTTPConnection(ip, timeout=2)
    previous = signal.signal(signal.SIGALRM, http_timeout)
    signal.setitimer(signal.ITIMER_REAL, HTTP_DEADLINE)
    try:
        conn.request('GET', path, headers={'Connection': 'close'})
        response = conn.getresponse()
        body = response.read(262145)
        if len(body) > 262144:
            raise ValueError('response-too-large')
        return response.status, body
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)
        conn.close()


DATA_PATH = '/v000903/kma/coord/37.5665,126.9780'
KST = dt.timezone(dt.timedelta(hours=9))


def _validate_ready(ip, http, now):
    """Read only the candidate IPv4, never the service EIP or a redirect."""
    try:
        address = ipaddress.ip_address(ip)
        if address.version != 4 or not address.is_global or address.is_multicast:
            return False
        if http(ip, '/health') != (200, b'OK'):
            return False
        status, body = http(ip, DATA_PATH)
        if status != 200:
            return False
        data = json.loads(body)
        stamp = data.get('currentPubDate')
        if not isinstance(stamp, str) or not re.fullmatch(r'[0-9]{12}', stamp):
            return False
        published = dt.datetime.strptime(stamp, '%Y%m%d%H%M').replace(tzinfo=KST)
        age = (now - published).total_seconds()
        current = data.get('current', {})
        temp, humidity = current.get('t1h'), current.get('reh')
        numeric = lambda x: type(x) in (float, int) and math.isfinite(x)
        return (0 <= age <= 21600 and numeric(temp) and -50 < temp <= 60
                and numeric(humidity) and 0 <= humidity <= 100
                and isinstance(data.get('shortest'), list) and bool(data['shortest']))
    except (ValueError, TypeError, AttributeError, OSError, HTTPException):
        return False


def safe_id(value):
    return value if isinstance(value, str) and re.fullmatch(r'[a-zA-Z0-9_-]{1,100}', value) else None


def emit_event(record):
    print(json.dumps(record, separators=(',', ':'), allow_nan=False))


def ready(ip, http, now, *, trace=None, emit=emit_event, monotonic=time.monotonic):
    """Retain validation while reporting only bounded diagnostic fields."""
    ordinal = (trace or {}).get('probe')
    trace = {k: safe_id((trace or {}).get(k)) for k in
             ('candidate_id', 'event_id', 'invocation_id', 'fleet_id')}
    if type(ordinal) is int and 1 <= ordinal <= 18:
        trace['probe'] = ordinal
    overall = monotonic()
    failed = False
    def observed_http(address, path):
        nonlocal failed
        start = monotonic()
        record = dict(trace, event='readiness.probe',
                      stage='health' if path == '/health' else 'weather',
                      socket_timeout_ms=2000, deadline_ms=HTTP_DEADLINE * 1000)
        try:
            status, body = http(address, path)
            record.update(http_status=status, reason='ok' if status == 200 else 'http-error')
            if path == '/health' and status == 200 and body != b'OK':
                record['reason'] = 'invalid-response'
            failed = record['reason'] != 'ok'
            return status, body
        except TimeoutError:
            failed = True
            record['reason'] = 'timeout'
            raise
        except (ValueError, TypeError, AttributeError):
            failed = True
            record['reason'] = 'invalid-response'
            raise
        except (OSError, HTTPException):
            failed = True
            record['reason'] = 'transport-error'
            raise
        finally:
            record['elapsed_ms'] = round(max(0, monotonic() - start) * 1000, 3)
            emit(record)
    result = _validate_ready(ip, observed_http, now)
    emit(dict(trace, event='readiness.result', stage='validation', ready=result,
              reason='ready' if result else ('probe-failed' if failed else 'invalid-response'),
              socket_timeout_ms=2000, deadline_ms=HTTP_DEADLINE * 1000,
              elapsed_ms=round(max(0, monotonic() - overall) * 1000, 3)))
    return result


class RetryableError(RuntimeError):
    """Sanitized failure that requests normal Lambda asynchronous retry."""


REQUIRED = ('TARGET_FLEET_ID', 'TARGET_AMI_ID', 'EIP_ALLOCATION_ID',
            'EXPECTED_ACCOUNT_ID', 'AWS_REGION')


def lambda_handler(event, context):
    """AWS entrypoint; dependencies are lazy and provider errors never logged."""
    import os
    import time
    env = dict(os.environ)
    if env.get('ATTACH_ENABLED') != 'true' or any(not env.get(k) for k in REQUIRED):
        return {'status': 'refused'}
    try:
        import boto3
        from botocore.config import Config
        ec2 = boto3.client('ec2', region_name=env['AWS_REGION'], config=Config(
            connect_timeout=2, read_timeout=3, retries={'total_max_attempts': 1}))
        result = handle(event, ec2=ec2, env=env, http=http_get, sleep=time.sleep,
                      now=lambda: dt.datetime.now(dt.timezone.utc),
                      remaining_ms=(context.get_remaining_time_in_millis if context else lambda: float('inf')),
                      invocation_id=getattr(context, 'aws_request_id', None))
        emit_event({'event': 'invocation.result', 'status': result['status'],
                    'invocation_id': safe_id(getattr(context, 'aws_request_id', None))})
        return result
    except RetryableError:
        raise
    except Exception:
        raise RetryableError('operation-failed') from None


def handle(event, *, ec2, env, http, sleep, now, remaining_ms=lambda: float('inf'), invocation_id=None):
    if env.get('ATTACH_ENABLED') != 'true' or any(not env.get(k) for k in REQUIRED):
        return {'status': 'refused'}
    if not isinstance(event, dict) or not isinstance(event.get('detail'), dict):
        return {'status': 'refused'}
    detail = event['detail']
    iid = detail.get('instance-id', '')
    if (event.get('source') != 'aws.ec2'
            or event.get('detail-type') != 'EC2 Instance State-change Notification'
            or event.get('account') != env['EXPECTED_ACCOUNT_ID']
            or event.get('region') != env['AWS_REGION']
            or detail.get('state') != 'running'
            or not isinstance(iid, str) or not re.fullmatch(r'i-(?:[0-9a-f]{8}|[0-9a-f]{17})', iid)):
        return {'status': 'refused'}
    instance = eligible(ec2, env, iid, retry_transient=True)
    if not instance:
        return {'status': 'refused'}
    address = get_address(ec2, env)
    if not address:
        return {'status': 'refused'}
    if address.get('InstanceId') == iid:
        return {'status': 'already-attached'}
    if not owner_safe(ec2, address):
        return {'status': 'refused'}
    last_probe = {}
    trace = dict(candidate_id=iid, event_id=safe_id(event.get('id')),
                 invocation_id=safe_id(invocation_id), fleet_id=safe_id(env['TARGET_FLEET_ID']))
    def record(value):
        if ((value.get('event') == 'readiness.probe' and value.get('reason') != 'ok')
                or (value.get('event') == 'readiness.result' and value.get('reason') == 'invalid-response')):
            last_probe.clear()
            last_probe.update({k: value[k] for k in
                              ('stage', 'reason', 'elapsed_ms', 'socket_timeout_ms', 'deadline_ms', 'http_status') if k in value})
        emit_event(value)
    for attempt in range(18):
        last_probe.clear()
        if remaining_ms() < 25000:
            raise RetryableError('time-budget')
        if ready(instance.get('PublicIpAddress'), http, now(),
                 trace=dict(trace, probe=attempt + 1), emit=record):
            break
        if attempt < 17:
            sleep(10)
    else:
        summary = dict(trace, event='invocation.failed', reason='candidate-not-ready',
                       last_probe=last_probe, probes=18)
        emit_event(summary)
        raise RetryableError(json.dumps(summary, separators=(',', ':'))) from None
    refreshed = eligible(ec2, env, iid)
    if not refreshed or refreshed.get('PublicIpAddress') != instance.get('PublicIpAddress'):
        return {'status': 'refused'}
    latest = get_address(ec2, env)
    if not latest:
        return {'status': 'refused'}
    ownership = lambda a: tuple(a.get(k) for k in ('InstanceId', 'NetworkInterfaceId', 'AssociationId'))
    if ownership(latest) != ownership(address) or not owner_safe(ec2, latest):
        return {'status': 'refused'}
    if remaining_ms() < 15000:
        raise RetryableError('time-budget')
    ec2.associate_address(AllocationId=env['EIP_ALLOCATION_ID'], InstanceId=iid,
                          AllowReassociation=True)
    verified = get_address(ec2, env)
    if not verified or verified.get('InstanceId') != iid:
        raise RetryableError('association-unverified')
    return {'status': 'attached'}


def get_address(ec2, env):
    items = ec2.describe_addresses(AllocationIds=[env['EIP_ALLOCATION_ID']]).get('Addresses', [])
    return (items[0] if len(items) == 1
            and items[0].get('AllocationId') == env['EIP_ALLOCATION_ID'] else None)


def owner_safe(ec2, address):
    owner = address.get('InstanceId')
    if not owner:
        return not any(address.get(k) for k in ('NetworkInterfaceId', 'AssociationId'))
    try:
        instance = get_instance(ec2, owner)
    except Exception as error:
        if getattr(error, 'response', {}).get('Error', {}).get('Code') == 'InvalidInstanceID.NotFound':
            return True
        raise
    return bool(instance and instance.get('State', {}).get('Name') in
                ('stopped', 'shutting-down', 'terminated'))


def get_instance(ec2, iid):
    items = [i for r in ec2.describe_instances(InstanceIds=[iid]).get('Reservations', [])
             for i in r.get('Instances', [])]
    return items[0] if len(items) == 1 and items[0].get('InstanceId') == iid else None


def eligible(ec2, env, iid, retry_transient=False):
    instance = get_instance(ec2, iid)
    if (not instance or instance.get('State', {}).get('Name') != 'running'
            or instance.get('InstanceLifecycle') != 'spot'
            or not instance.get('SpotInstanceRequestId')
            or instance.get('ImageId') != env['TARGET_AMI_ID']):
        return None
    fleet_tags = [t.get('Value') for t in instance.get('Tags', [])
                  if t.get('Key') == 'aws:ec2spot:fleet-request-id']
    if not fleet_tags and retry_transient:
        raise RetryableError('candidate-metadata-pending')
    if fleet_tags != [env['TARGET_FLEET_ID']]:
        return None
    fleets = ec2.describe_spot_fleet_requests(SpotFleetRequestIds=[env['TARGET_FLEET_ID']]).get('SpotFleetRequestConfigs', [])
    if len(fleets) != 1:
        return None
    fleet = fleets[0]
    config = fleet.get('SpotFleetRequestConfig', {})
    members = ec2.describe_spot_fleet_instances(SpotFleetRequestId=env['TARGET_FLEET_ID'])
    if (retry_transient and fleet.get('SpotFleetRequestId') == env['TARGET_FLEET_ID']
            and config.get('Type') == 'maintain' and config.get('TargetCapacity') == 1
            and (fleet.get('SpotFleetRequestState') in ('submitted', 'modifying')
                 or (fleet.get('SpotFleetRequestState') == 'active'
                     and not members.get('ActiveInstances') and not members.get('NextToken')))):
        raise RetryableError('candidate-metadata-pending')
    if (fleet.get('SpotFleetRequestId') != env['TARGET_FLEET_ID']
            or fleet.get('SpotFleetRequestState') != 'active'
            or config.get('Type') != 'maintain' or config.get('TargetCapacity') != 1
            or members.get('NextToken')
            or [m.get('InstanceId') for m in members.get('ActiveInstances', [])] != [iid]):
        return None
    return instance
