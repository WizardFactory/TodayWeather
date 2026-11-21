"""Network start gate for the disposable KMA/AirKorea rehearsal guest."""

from collections.abc import Mapping
from contextlib import contextmanager
from dataclasses import dataclass
from ipaddress import IPv4Address
import re
from types import MappingProxyType


PROVIDER = 'apis.data.go.kr'
PRODUCTION = 'todayweather.wizardfactory.net'
REGIONAL_S3 = 's3.ap-northeast-2.amazonaws.com'
TABLE = 'server2_shadow_rehearsal'
DENIALS = {'ipv4_tcp', 'ipv4_udp', 'ipv6'}


@dataclass(frozen=True)
class NetworkPlan:
    bindings: Mapping[str, tuple[str, ...]]
    rules: str

    @property
    def standin_tls_names(self):
        return tuple(host for host in self.bindings if host != PROVIDER)


def plan_network(run_id, interface, provider_ipv4, local_peer_names):
    """Freeze previously checked provider addresses and build the owned rules."""
    if not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])?', run_id):
        raise ValueError('invalid rehearsal run ID')
    if not re.fullmatch(r'[A-Za-z0-9_.-]{1,15}', interface) or interface == 'lo':
        raise ValueError('invalid rehearsal egress interface')
    if not 1 <= len(provider_ipv4) <= 8 or any(type(value) is not str for value in provider_ipv4):
        raise ValueError('expected one to eight pinned IPv4 addresses')
    pins = sorted(IPv4Address(value) for value in provider_ipv4)
    if (len(set(pins)) != len(pins)
            or any(not pin.is_global or pin.is_multicast or pin.is_reserved for pin in pins)):
        raise ValueError('provider pins must be distinct public IPv4 addresses')

    bindings = {REGIONAL_S3: ('127.0.0.1',), PRODUCTION: ('127.0.0.2',)}
    for kind in ('raw', 'state'):
        bindings[f'server2-shadow-{run_id}-{kind}.{REGIONAL_S3}'] = ('127.0.0.1',)
    for host in local_peer_names:
        if (len(host) > 253 or not re.fullmatch(r'(?:[a-z0-9-]+\.)+[a-z0-9-]+', host)
                or host == PROVIDER or host in bindings):
            raise ValueError('invalid additional rehearsal stand-in host')
        bindings[host] = ('127.0.0.2',)
    bindings[PROVIDER] = tuple(map(str, pins))

    # Use a single transaction so a conflict cannot modify an existing table.
    # The reply-direction rule preserves the guest's inbound IPv4 TCP control
    # channel without preserving pre-existing guest-initiated connections.
    chain = f'inet {TABLE} output'
    provider_set = ', '.join(bindings[PROVIDER])
    rules = f'''create table inet {TABLE}
add chain {chain} {{ type filter hook output priority -5; policy drop; }}
add rule {chain} oifname "lo" ip daddr 127.0.0.0/8 accept
add rule {chain} oifname "lo" ip daddr 169.254.169.254 tcp dport 80 accept
add rule {chain} oifname "lo" ip saddr 169.254.169.254 tcp sport 80 ct direction reply ct state established accept
add rule {chain} oifname "{interface}" ip daddr {{ {provider_set} }} tcp dport 443 accept
add rule {chain} oifname "{interface}" meta nfproto ipv4 ct direction reply ct state established meta l4proto tcp accept
add rule {chain} ip daddr 192.0.2.1 tcp dport 9 counter reject comment "ipv4_tcp"
add rule {chain} ip daddr 192.0.2.1 udp dport 9 counter reject comment "ipv4_udp"
add rule {chain} ip6 daddr ::1 tcp dport 9 counter reject comment "ipv6"
add rule {chain} counter reject
'''
    return NetworkPlan(MappingProxyType(bindings), rules)


def _mapped_hosts(original, bindings):
    for line in original.decode('utf-8').splitlines():
        words = line.partition('#')[0].split()
        if any(host.lower().rstrip('.') in bindings for host in words[1:]):
            raise ValueError('a rehearsal host is already mapped')
    lines = ''.join(f'{address} {host}\n' for host, addresses in bindings.items() for address in addresses).encode()
    return (b'\n' if original and not original.endswith(b'\n') else b'') + lines


@contextmanager
def enforce_network(plan, *, disposable_host, start, hosts_path, run, resolve, inspect_denials,
                    verify_loopback_tls, verify_provider_tls, release=lambda: True):
    """Hold the guest isolation until the caller has stopped its services.

    The caller owns the disposable Linux host check, stand-in startup and
    shutdown. The command runner must raise on errors. ``resolve`` uses the
    workload's effective resolver. The IPv4 TCP, IPv4 UDP and IPv6 denial
    probes must show that the owned rules rejected synthetic attempts. The
    loopback TLS probe uses the fixture CA. The provider probe uses public trust,
    the pinned address and the provider name.
    """
    if disposable_host is not True or start is not True:
        raise ValueError('network setup requires disposable host and explicit start')
    original = hosts_path.read_bytes()
    mappings = _mapped_hosts(original, plan.bindings)
    run('nft', '-f', '-', input=plan.rules)
    try:
        hosts_path.write_bytes(original + mappings)
        for host, expected in plan.bindings.items():
            if set(resolve(host)) != set(expected):
                raise ValueError(f'unexpected rehearsal host binding for {host}')
        denied = inspect_denials()
        if (not isinstance(denied, Mapping) or set(denied) != DENIALS
                or any(denied[kind] is not True for kind in DENIALS)):
            raise ValueError('rehearsal egress denial check failed')
        loopback_tls = plan.standin_tls_names
        for host in loopback_tls:
            if verify_loopback_tls(plan.bindings[host][0], host) is not True:
                raise ValueError(f'rehearsal loopback TLS check failed for {host}')
        provider_ipv4 = plan.bindings[PROVIDER]
        for address in provider_ipv4:
            if verify_provider_tls(address, PROVIDER) is not True:
                raise ValueError('rehearsal provider TLS identity check failed')
        yield {'provider_ipv4': list(provider_ipv4), 'loopback_tls': list(loopback_tls), 'denied': dict(denied)}
    finally:
        if release() is not True:
            raise RuntimeError('rehearsal shutdown unconfirmed; isolation retained')
        current = hosts_path.read_bytes()
        if current.endswith(mappings):
            hosts_path.write_bytes(current[:-len(mappings)])
        elif current != original:
            # Keep the restrictive table if host mappings could not be undone.
            raise RuntimeError('rehearsal host mappings changed during isolation')
        run('nft', 'delete', 'table', 'inet', TABLE)
