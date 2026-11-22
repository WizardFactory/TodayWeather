"""Synthetic checks of the SR-6 network start gate."""

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'deploy/shadow'))

import rehearsal_network as network
import linux_check


class RehearsalNetworkTests(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        self.hosts = Path(scratch.name) / 'hosts'
        self.original = b'127.0.0.1 localhost\r\n::1 localhost\r\n'
        self.hosts.write_bytes(self.original)
        self.plan = network.plan_network('sr6-measured', 'eth0', ['8.8.8.9', '8.8.8.8'], ['www.weather.go.kr'])
        self.run = Mock()
        self.denied = Mock(return_value={'ipv4_tcp': True, 'ipv4_udp': True, 'ipv6': True})
        self.local_tls = Mock(return_value=True)
        self.tls = Mock(return_value=True)

    def start(self, **overrides):
        args = dict(disposable_host=True, start=True, run=self.run, hosts_path=self.hosts,
                    resolve=self.plan.bindings.__getitem__, inspect_denials=self.denied,
                    verify_loopback_tls=self.local_tls, verify_provider_tls=self.tls)
        return network.enforce_network(self.plan, **(args | overrides))

    def test_unconfirmed_stop_keeps_host_mappings_and_owned_firewall(self):
        with self.assertRaisesRegex(RuntimeError, 'isolation retained'):
            with self.start(release=lambda: False):
                self.assertIn(b'apis.data.go.kr', self.hosts.read_bytes())
        self.assertIn(b'apis.data.go.kr', self.hosts.read_bytes())
        self.assertEqual(self.run.call_count, 1)

    def test_disposable_guest_keeps_egress_rules_after_driver_exit(self):
        for fail in (False, True):
            with self.subTest(fail=fail):
                self.hosts.write_bytes(self.original)
                self.run.reset_mock()
                try:
                    with self.start(retain_until_poweroff=True):
                        if fail:
                            raise ValueError('driver failed')
                except ValueError as error:
                    self.assertEqual(str(error), 'driver failed')
                self.assertIn(b'apis.data.go.kr', self.hosts.read_bytes())
                self.assertEqual(self.run.call_count, 1)

    def test_rule_scope_and_loopback_bindings(self):
        self.assertEqual(self.plan.bindings['apis.data.go.kr'], ('8.8.8.8', '8.8.8.9'))
        self.assertEqual(self.plan.bindings['todayweather.wizardfactory.net'], ('127.0.0.2',))
        self.assertEqual(self.plan.bindings['server2-shadow-sr6-measured-state.s3.ap-northeast-2.amazonaws.com'],
                         ('127.0.0.1',))
        self.assertNotIn('apis.data.go.kr', self.plan.standin_tls_names)
        rules = self.plan.rules
        self.assertIn('type filter hook output', rules)
        self.assertIn('policy drop', rules)
        self.assertIn('oifname "lo" ip daddr 169.254.169.254 tcp dport 80 accept', rules)
        # Linux selects the local metadata address as the client's source, too.
        self.assertIn('oifname "lo" ip saddr 169.254.169.254 tcp sport 80 ct direction reply ct state established accept', rules)
        self.assertIn('oifname "eth0" ip daddr { 8.8.8.8, 8.8.8.9 } tcp dport 443 accept', rules)
        self.assertIn('meta nfproto ipv4 ct direction reply ct state established meta l4proto tcp accept', rules)
        self.assertIn('counter reject', rules)
        self.assertNotIn('udp accept', rules)
        self.assertNotIn('ip6 daddr ::1 tcp dport 9 accept', rules)
        for label in network.DENIALS:
            self.assertIn(f'counter reject comment "{label}"', rules)

    def test_refuses_unsafe_pins_and_interface(self):
        for addresses in ([], ['127.0.0.1'], ['224.0.0.1'], ['2001:4860::1'], ['192.0.2.1'],
                          ['8.8.8.8', '8.8.8.8'], ['8.8.8.8'] * 9):
            with self.subTest(addresses=addresses), self.assertRaises(ValueError):
                network.plan_network('sr6-measured', 'eth0', addresses, [])
        for interface in ('lo', 'eth0"\naccept', 'b' * 16):
            with self.subTest(interface=interface), self.assertRaises(ValueError):
                network.plan_network('sr6-measured', interface, ['8.8.8.8'], [])

    def test_mutations_require_both_explicit_flags(self):
        for flags in ({'disposable_host': False}, {'start': False}):
            with self.subTest(flags=flags), self.assertRaises(ValueError):
                with self.start(**flags):
                    self.fail('start gate opened')
        self.run.assert_not_called()
        self.assertEqual(self.hosts.read_bytes(), self.original)

    def test_gate_orders_setup_and_restores_original(self):
        def on_run(*command, **kwargs):
            self.assertEqual(self.hosts.read_bytes(), self.original)
        self.run.side_effect = on_run
        with self.start() as receipt:
            self.assertIn(b'8.8.8.8 apis.data.go.kr\n', self.hosts.read_bytes())
            self.assertEqual(receipt['provider_ipv4'], ['8.8.8.8', '8.8.8.9'])
            self.assertEqual(receipt['denied'], {'ipv4_tcp': True, 'ipv4_udp': True, 'ipv6': True})
            self.assertEqual(receipt['loopback_tls'], list(self.plan.standin_tls_names))
            self.assertEqual([args for args, _ in self.tls.call_args_list],
                             [('8.8.8.8', 'apis.data.go.kr'), ('8.8.8.9', 'apis.data.go.kr')])
        self.assertEqual(self.hosts.read_bytes(), self.original)
        self.assertEqual([args[:3] for args, _ in self.run.call_args_list],
                         [('nft', '-f', '-'), ('nft', 'delete', 'table')])

    def test_removes_owned_rules_after_failed_effective_binding(self):
        def leaked_ipv6(host):
            return self.plan.bindings[host] + ('::1',) if host == 'apis.data.go.kr' else self.plan.bindings[host]
        with self.assertRaisesRegex(ValueError, 'binding'):
            with self.start(resolve=leaked_ipv6):
                self.fail('start gate opened')
        self.denied.assert_not_called()
        self.tls.assert_not_called()
        self.assertEqual(self.hosts.read_bytes(), self.original)
        self.assertEqual(self.run.call_args.args[:3], ('nft', 'delete', 'table'))

    def test_missing_denial_or_failed_tls_keeps_workload_offline(self):
        self.denied.return_value = {'ipv4_tcp': True, 'ipv6': True}
        with self.assertRaisesRegex(ValueError, 'denial'):
            with self.start():
                self.fail('start gate opened')
        self.tls.assert_not_called()
        self.denied.return_value['ipv4_udp'] = True
        self.local_tls.return_value = False
        with self.assertRaisesRegex(ValueError, 'loopback TLS'):
            with self.start():
                self.fail('start gate opened')
        self.tls.assert_not_called()
        self.local_tls.return_value = True
        self.tls.return_value = False
        with self.assertRaisesRegex(ValueError, 'TLS'):
            with self.start():
                self.fail('start gate opened')
        self.assertEqual(self.hosts.read_bytes(), self.original)

    def test_preexisting_mapping_or_failed_atomic_install_is_left_intact(self):
        duplicate = self.original + b'127.0.0.7 OTHER Apis.Data.GO.KR. # previous scope\n'
        self.hosts.write_bytes(duplicate)
        with self.assertRaisesRegex(ValueError, 'already mapped'):
            with self.start():
                self.fail('start gate opened')
        self.run.assert_not_called()
        self.assertEqual(self.hosts.read_bytes(), duplicate)
        self.hosts.write_bytes(self.original)
        self.run.side_effect = RuntimeError('table already exists')
        with self.assertRaisesRegex(RuntimeError, 'already exists'):
            with self.start():
                self.fail('start gate opened')
        self.run.assert_called_once()
        self.assertEqual(self.hosts.read_bytes(), self.original)

    def test_teardown_preserves_separate_prefix_edits_and_keeps_rules_on_mapping_drift(self):
        prefix = b'127.0.0.5 local-test\n'
        with self.start():
            self.hosts.write_bytes(prefix + self.hosts.read_bytes())
        self.assertEqual(self.hosts.read_bytes(), prefix + self.original)
        self.run.reset_mock()
        with self.assertRaisesRegex(RuntimeError, 'mappings changed'):
            with self.start():
                self.hosts.write_bytes(self.hosts.read_bytes() + b'# Changed\n')
        self.run.assert_called_once()

    def test_harness_fixture_ca_uses_only_loopback_certificate_names(self):
        tls_path = self.hosts.parent / 'tls'
        with (patch.object(linux_check, 'TLS', tls_path), patch.object(linux_check, 'run') as run,
              patch.object(linux_check.shutil, 'copy')):
            linux_check.setup_test_tls(self.plan.standin_tls_names)
        names = (tls_path / 'ext.cnf').read_text()
        self.assertEqual(names, 'subjectAltName=' + ','.join('DNS:' + name for name in self.plan.standin_tls_names) + '\n')
        self.assertNotIn('apis.data.go.kr', names)
        self.assertEqual(run.call_args.args, ('update-ca-certificates',))

    def test_default_harness_still_maps_provider_to_its_stand_in(self):
        with (patch.object(linux_check, 'Path', return_value=self.hosts) as path,
              patch.object(linux_check, 'setup_test_tls') as setup_tls,
              patch.object(linux_check, 'remove_egress_block') as remove,
              patch.object(linux_check, 'run') as run):
            linux_check.setup_network()
        self.assertIn('apis.data.go.kr', setup_tls.call_args.args[0])
        peer_record = next(line for line in self.hosts.read_text().splitlines() if 'apis.data.go.kr' in line)
        self.assertEqual(peer_record.split()[0], '127.0.0.2')
        path.assert_called_with('/etc/hosts')
        remove.assert_called_once()
        self.assertEqual([args[-1] for args, _ in run.call_args_list], ['REJECT', 'ACCEPT'])


if __name__ == '__main__':
    unittest.main()
