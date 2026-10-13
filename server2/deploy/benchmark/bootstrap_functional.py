"""Actual wrapper + harmless synthetic bootstrap; mandatory OS isolation.

Never execute cloud-init, apt, systemctl, nft or a real bootstrap here. The only
shell admitted by isolated_tests.py runs /scratch/bootstrap-wrapper below.
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile

assert os.environ.get('S09_ISOLATED') == '1' and not Path('/sys').exists()


def smoke():
    import bootstrap_diagnostics as d
    from test_user_data_wire import controller
    results = []
    for mode, code in (('success', 0), ('failure', 17), ('timeout', 124), ('export_failure', 17)):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            private = root/'private'
            private.mkdir()
            c = controller(directory, None)
            original = c.bootstrap_command()
            # Explicit fixture-only relocation; actual shell structure/helper bytes
            # remain unchanged. Only timeout duration is shortened for timeout mode.
            wrapper = original.replace('/opt/server2-s09/private', str(private))
            if mode == 'timeout': wrapper = wrapper.replace('2070 ', '0.1 ')
            bootstrap = private/'bootstrap.sh'
            bootstrap.write_text('#!/bin/sh\nset -eu\nprintf "cargo_build\\n" >'+str(private/'bootstrap-stage')+'\n'
                +'printf "error[E0432]: private-secret\\n" >'+str(private/'host-build.log')+'\n'
                +'printf "AssertionError: private-secret\\n"\n'
                +('sleep 3\n' if mode == 'timeout' else 'exit '+str(code)+'\n'))
            bootstrap.chmod(0o700)
            env = dict(os.environ)
            if mode == 'export_failure':
                fake = root/'python3'
                fake.write_text('#!/bin/sh\nprintf "private-secret\\n" >&2\nexit 19\n')
                fake.chmod(0o700)
                env['PATH'] = str(root)+':/usr/bin'
            path = Path('/scratch/bootstrap-wrapper')
            path.write_text(wrapper)
            try:
                result = subprocess.run(['/usr/bin/dash', str(path)], env=env,
                    capture_output=True, text=True, timeout=5)
            finally:
                path.unlink()
            assert result.returncode == code, (mode, result.returncode)
            assert not result.stderr and 'private-secret' not in result.stdout
            assert len(result.stdout.encode()) < 4096
            record = d.decode(result.stdout)
            if mode == 'export_failure':
                assert record == {'status': 'unavailable'}
            else:
                assert record['stage'] == 'cargo_build'
                assert record['logs']['bootstrap.log']['signals'] == ['AssertionError']
                assert record['logs']['host-build.log']['signals'] == ['rust:E0432']
            # Feed the real wrapper's output through the production SSM terminal
            # path and lifecycle; read persisted evidence inside ordinary cleanup.
            import aws_operator as op
            c.state.data['resources'] = {'instance': 'i-offline'}
            actions = []
            def call(service, action, args):
                actions.append(action)
                if action == 'send-command': return {'Command': {'CommandId': 'a'*36}}
                assert action == 'get-command-invocation'
                return {'Status': 'Success' if code == 0 else 'Failed',
                    'ResponseCode': code, 'StandardOutputContent': result.stdout,
                    'StandardErrorContent': result.stderr}
            c.call = call
            c.capture_admission_diagnostics = lambda **kw: None
            def cleanup():
                saved = json.loads(c.state.path.read_text())['bootstrap_diagnostics']
                assert saved['diagnostics'] == record and saved['ResponseCode'] == code
                actions.append('cleanup')
                return {'status': 'cleaned_host_resources_S3_retained'}
            c.cleanup = cleanup
            try:
                c.run_lifecycle(lambda: c.ssm([original], seconds=2100, bootstrap=True))
                assert code == 0
            except op.OperatorError as error:
                assert code != 0 and str(error) == 'SSM task failed'
            assert actions == ['send-command', 'get-command-invocation', 'cleanup']
            results.append({'case': mode, 'preserved_before_cleanup': True, 'original_rc': result.returncode,
                'output_bytes': len(result.stdout.encode()), 'diagnostics': record['status']})
    return {'bootstrap_wrapper': results, 'actual_AWS_calls': 0,
            'actual_bootstrap_executions': 0, 'synthetic_shell_executions': len(results)}
