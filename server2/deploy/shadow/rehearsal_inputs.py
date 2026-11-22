"""Pure preflight for the dedicated KMA and AirKorea rehearsal inputs."""

from collections.abc import Mapping
from datetime import date
from hashlib import sha256
import hmac
import importlib.util
import json
import os
import re
import stat
from pathlib import Path
from urllib.parse import unquote


KEY_VARIABLES = ('DONGNAE_SECRET_KEYS', 'AIRKOREA_SECRET_KEYS')
MAX_PRIVATE_BYTES = 64 * 1024

# The supported DataGoKrApi paths and development limits from src/domestic/quota.rs.
API_LIMITS = dict.fromkeys((
    '1360000/VilageFcstInfoService_2.0',
    '1360000/VilageFcstMsgService',
    '1360000/MidFcstInfoService',
    '1360000/FcstZoneInfoService',
    '1360000/WthrWrnInfoService',
    '1360000/AsosHourlyInfoService',
    '1360000/AsosDalyInfoService',
    '1360000/LivingWthrIdxServiceV5',
    '1360000/HealthWthrIdxServiceV3',
    'B090041/openapi/service/RiseSetInfoService',
), 10_000) | dict.fromkeys((
    'B552584/ArpltnInforInqireSvc',
    'B552584/MsrstnInfoInqireSvc',
    'B552584/ArpltnStatsSvc',
), 500)

# The explicit candidate environment comes from coordinator.candidate_environment.
# Add only rehearsal settings that have been reviewed for the restricted network.
ENVIRONMENT_NAMES = {
    'PATH', 'PORT', 'OPENSHIFT_NODEJS_IP', 'AWS_ACCESS_KEY', 'AWS_SECRET_KEY',
    'SERVER2_S3_BUCKET', 'SERVER2_S3_REGION', 'SERVER2_NATIVE_FAMILIES',
    'SERVER2_GATEWAY_LEGACY_URL', 'SERVER2_SHADOW_S3_LIMITS',
    'SERVER2_SHADOW_PROVIDER_UNITS', 'SERVER2_LOG_LEVEL',
}
KMA_FAMILIES = {'kma', 'kma-v000901', 'kma-v000902', 'town'}


def _read_private(path):
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, 'rb') as stream:
            info = os.fstat(stream.fileno())
            if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid()
                    or stat.S_IMODE(info.st_mode) != 0o600):
                raise ValueError('rehearsal input must be an owner-only regular file (0600)')
            data = stream.read(MAX_PRIVATE_BYTES + 1)
        if not data or len(data) > MAX_PRIVATE_BYTES:
            raise ValueError('invalid rehearsal input size')
        return data.decode('utf-8')
    except (OSError, UnicodeError):
        raise ValueError('rehearsal input unavailable or unsafe') from None


def _decode_key(value):
    if (type(value) is not str or len(value) < 20 or not value.isascii()
            or re.search(r'%(?![0-9a-fA-F]{2})', value)):
        raise ValueError('invalid dedicated key shape')
    try:
        key = unquote(value, errors='strict')
    except UnicodeError:
        raise ValueError('invalid dedicated key encoding') from None
    if len(key) < 20 or not re.fullmatch(r'[!-~]+', key):
        raise ValueError('invalid dedicated key shape')
    return key


def _check_dedicated_config(config, reference):
    # Use the same dotenv grammar that the installed collector and server use.
    path = Path(__file__).resolve().parents[1] / 'logging' / 'render.py'
    spec = importlib.util.spec_from_file_location('shadow_rehearsal_dotenv', path)
    renderer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(renderer)
    expected = _decode_key(reference.rstrip('\r\n'))
    found = {}
    for line in re.split(r'\r\n|\n|\r', config):
        stripped = line.strip(renderer.JS_SPACE)
        if not stripped or stripped.startswith('#'):
            continue
        parsed = renderer.parse_dotenv(line, names=KEY_VARIABLES)
        if not parsed or parsed.keys() & found:
            raise ValueError('rehearsal config must contain only one assignment to each key variable')
        name, value = next(iter(parsed.items()))
        try:
            keys = json.loads(value)
        except ValueError:
            raise ValueError('rehearsal key variable requires a JSON key list') from None
        if type(keys) is not list or len(keys) != 1:
            raise ValueError('rehearsal requires exactly one dedicated key per variable')
        if not hmac.compare_digest(_decode_key(keys[0]), expected):
            raise ValueError('rehearsal key does not match the approved reference')
        found[name] = keys[0]
    if set(found) != set(KEY_VARIABLES):
        raise ValueError('missing dedicated rehearsal key variables')
    return found, expected


def _check_environment(environment):
    if (not isinstance(environment, Mapping) or set(environment) - ENVIRONMENT_NAMES
            or any(type(value) is not str for value in environment.values())):
        raise ValueError('candidate environment contains an unapproved override')
    families = environment.get('SERVER2_NATIVE_FAMILIES', '').split(',')
    if set(families) - KMA_FAMILIES or len(set(families)) != len(families):
        raise ValueError('candidate must use only the native KMA family routes')
    if (environment.get('AWS_ACCESS_KEY') or environment.get('AWS_SECRET_KEY')
            or environment.get('OPENSHIFT_NODEJS_IP', '127.0.0.1') != '127.0.0.1'
            or environment.get('SERVER2_GATEWAY_LEGACY_URL', 'http://127.0.0.1:9') != 'http://127.0.0.1:9'):
        raise ValueError('candidate environment permits a non-rehearsal destination')
    if (environment.get('SERVER2_SHADOW_PROVIDER_UNITS', '0,0,0,0') != '0,0,0,0'
            or environment.get('SERVER2_S3_REGION', 'ap-northeast-2') != 'ap-northeast-2'
            or ('SERVER2_S3_BUCKET' in environment and not re.fullmatch(
                r'server2-shadow-[a-z0-9-]{1,30}-raw', environment['SERVER2_S3_BUCKET']))):
        raise ValueError('candidate has non-rehearsal provider grants or storage scope')


def _check_daily_calls(daily_calls):
    if type(daily_calls) not in (list, tuple) or not daily_calls:
        raise ValueError('rehearsal requires explicit daily quota inputs')
    seen = set()
    result = []
    for row in daily_calls:
        if type(row) is not dict or set(row) != {'api', 'kst_day', 'used', 'planned'}:
            raise ValueError('invalid daily quota fields')
        api, day, used, planned = (row[name] for name in ('api', 'kst_day', 'used', 'planned'))
        if (type(api) is not str or api not in API_LIMITS or type(day) is not str
                or type(used) is not int or used < 0 or type(planned) is not int or planned < 0):
            raise ValueError('invalid API, day or daily call counts')
        try:
            valid_day = date.fromisoformat(day).isoformat() == day
        except ValueError:
            valid_day = False
        if not valid_day or (api, day) in seen:
            raise ValueError('invalid or duplicate API quota day')
        seen.add((api, day))
        limit = API_LIMITS[api]
        headroom = limit - used - planned
        if headroom < 0:
            raise ValueError('planned calls exceed the dedicated API daily quota')
        result.append(dict(api=api, kst_day=day, used=used, planned=planned,
                           limit=limit, headroom=headroom))
    if not any(row['planned'] for row in result):
        raise ValueError('rehearsal has no planned provider calls')
    return result


def validated_config(config_path, dedicated_key_path, *, environment, daily_calls):
    """Return privately scoped configuration, quota ceilings and sanitized requirements.

    The operator chooses the trusted dedicated reference. Pass only an explicit
    candidate environment and one quota row per scheduled API and KST day, with
    current usage and a bound including retries. The caller must install this
    checked two-variable config and verify the network from inside the VM.
    """
    _check_environment(environment)
    quota = _check_daily_calls(daily_calls)
    keys, decoded = _check_dedicated_config(_read_private(config_path), _read_private(dedicated_key_path))
    config = ''.join(f'{name}={json.dumps([keys[name]])}\n' for name in KEY_VARIABLES)
    config += 'SERVER2_LOG_LEVEL=debug\n'
    caps = {}
    for row in quota:
        api = row['api']
        day = row['kst_day']
        # Match the persisted Rust budget IDs for each acquirer (live.rs and observe.rs).
        if api.startswith('B552584/'):
            domain, window = 'AIRKOREA_SECRET_KEYS', 'kst-' + day.replace('-', '')
        else:
            domain, window = 'DONGNAE_SECRET_KEYS', day
        owner = sha256(f'server2-data-go-kr-api-quota-v2\0{domain}\0{api}\0{decoded}'.encode()).hexdigest()
        caps[f'budgets/v2/data_go_kr/{owner}/{window}/authority.json'] = row['planned']
    receipt = dict(
        key_scope='dedicated-mukhwa9', credential_variables=list(KEY_VARIABLES),
        quota_timezone='Asia/Seoul', daily_calls=quota,
        network=dict(
            outbound_https=[dict(host='apis.data.go.kr', port=443)],
            default_egress='deny-ipv4-and-ipv6',
            comparison_origin=dict(host='todayweather.wizardfactory.net', routing='loopback-standin'),
            s3='loopback-standin', instance_metadata='local-standin-only',
        ),
    )
    return config, caps, receipt


def preflight(config_path, dedicated_key_path, *, environment, daily_calls):
    """Return the sanitized rehearsal receipt without configuration or quota keys."""
    return validated_config(config_path, dedicated_key_path, environment=environment, daily_calls=daily_calls)[2]
