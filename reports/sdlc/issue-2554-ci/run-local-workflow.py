import os,subprocess,tempfile,yaml
from pathlib import Path
workflow=yaml.load(Path('.github/workflows/rss-offline.yml').read_text(),Loader=yaml.BaseLoader)
job=workflow['jobs']['rss-offline']
root=tempfile.mkdtemp(prefix='issue2554-ci-smoke-')
print('Local checkout/runtime represent checkout/setup actions; Node:',flush=True)
subprocess.run(['node','--version'],check=True)
for step in job['steps']:
 if 'run' not in step:continue
 env=dict(os.environ,**job['env'],RUNNER_TEMP=root)
 env.update({k:v.replace('${{ runner.temp }}',root) for k,v in step.get('env',{}).items()})
 print('STEP:',step['name'],flush=True)
 subprocess.run(['bash','--noprofile','--norc','-e','-o','pipefail','-c',step['run']],env=env,check=True)
print('PASS exact workflow shell steps; fresh isolated npm dependencies; temporary root:',root,flush=True)
