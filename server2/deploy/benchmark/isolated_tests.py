"""Only run via run_isolated.py; install deny-by-default before test imports."""
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest

assert os.environ.get('S09_ISOLATED') == '1'
assert os.getuid() == 0 and os.getgid() == 0
assert not Path('/run/systemd').exists() and not Path('/sys').exists()
assert not Path('/root/.aws').exists()
assert 'CapEff:\t0000000000000000' in Path('/proc/self/status').read_text()


def audit(event, args):
    if event == 'subprocess.Popen':
        exe = Path(args[0]).resolve()
        fake = exe.name == 'fake-aws' and exe.is_relative_to(Path('/scratch'))
        wrapper = (sys.argv[1] == 'functional' and args[0] == '/usr/bin/dash' and
                   args[1] == ['/usr/bin/dash', '/scratch/bootstrap-wrapper'])
        manifest = (sys.argv[1] == 'manifest-functional' and args[0] == '/worker' and
            args[1] == ['/worker', '--aws-config', '/candidate/server2/config/benchmarks/aws.json',
                '--run-manifest', '/opt/server2-s09/run/s09-20261008-approval044959/manifest.json',
                '--execute-approved-run'])
        if not (fake or wrapper or manifest):
            raise PermissionError('offline subprocess policy: reviewed adapters only')
    if event in ('os.system', 'os.exec', 'os.posix_spawn'):
        raise PermissionError('offline process escape denied')


sys.addaudithook(audit)
# An inert denied command proves enforcement before any operational import.
try:
    subprocess.run(['/usr/bin/true'], check=True)
except PermissionError:
    pass
else:
    raise AssertionError('unexpected executable admitted')

selection = sys.argv[1]
if selection == 'safety':
    print(json.dumps({'unexpected_executable_blocked': True, 'capabilities_zero': True,
        'host_systemd_bus_absent': True, 'sysfs_absent': True,
        'network_devices': Path('/proc/net/dev').read_text(),
        'namespaces': {n: os.readlink('/proc/self/ns/'+n) for n in ('pid', 'net', 'mnt', 'user')}}))
    sys.exit(0)
if selection in ('imds-functional', 'online-functional'):
    from importlib import import_module
    print(json.dumps(import_module(selection.replace('-', '_')).smoke(), indent=2))
    sys.exit(0)
if selection == 'manifest-functional':
    from test_integration import manifest_functional_smoke
    print(json.dumps(manifest_functional_smoke(), indent=2))
    sys.exit(0)
if selection == 'functional':
    import test_aws_operator as tests
    import test_lifecycle as lifecycle
    import bootstrap_functional
    results = [tests.functional_smoke(), tests.failure_functional_smoke(),
        tests.cleanup_functional_smoke(), tests.functional_smoke(retained_bucket=True),
        tests.functional_smoke(recovery=True), lifecycle.lifecycle_functional_smoke(),
        bootstrap_functional.smoke()]
    print(json.dumps(results, indent=2))
    sys.exit(0)
loader = unittest.TestLoader()
suite = loader.discover(str(Path(__file__).parent), pattern=selection) if '*' in selection else loader.loadTestsFromName(selection)
result = unittest.TextTestRunner(verbosity=2).run(suite)
print(json.dumps({'tests': result.testsRun, 'failures': len(result.failures),
    'errors': len(result.errors), 'skipped': len(result.skipped)}))
sys.exit(not result.wasSuccessful())
