"""Capture one state of the isolated WKWebView harness; never contacts production."""
import argparse
import json
import os
from pathlib import Path
import subprocess

p = argparse.ArgumentParser()
p.add_argument('harness', type=Path)
p.add_argument('device')
p.add_argument('name')
p.add_argument('--state')
p.add_argument('--params', default='{}')
p.add_argument('--before', default='')
args = p.parse_args()
root = Path(__file__).resolve().parents[3]
harness = args.harness.resolve()
def evaluate(code=None, file=None):
    cmd = ['python3', str(harness/'evaluate.py')]
    cmd += ['--file', str(file)] if file else [code]
    result = subprocess.run(cmd, check=True, capture_output=True, text=True)
    return json.loads(result.stdout)['value']

code = '''new Promise(function(resolve,reject){
var i=angular.element(document).injector(); window.__renderErrors=[];
console.log({capture:NAME,phase:"begin"});
i.get("$rootScope").$apply(function(){ BEFORE
var result=STATE ? i.get("$state").go(STATE,PARAMS) : Promise.resolve();
Promise.resolve(result).then(function(){setTimeout(function(){resolve(i.get("$state").current.name)},1400)},reject);
});});'''.replace('NAME', json.dumps(args.name)).replace('BEFORE', args.before).replace('STATE', json.dumps(args.state)).replace('PARAMS', args.params)
state = evaluate(code)
diagnostic = evaluate(file=Path(__file__).with_name('inspect.js'))
out = root/'docs/rewrite/screenshots'/f'{args.name}.png'
env = dict(os.environ, DEVELOPER_DIR='/Applications/Xcode.app/Contents/Developer')
subprocess.run(['xcrun','simctl','io',args.device,'screenshot',str(out)],env=env,check=True,capture_output=True)
(root/'reports/rewrite-verification'/f'{args.name}.json').write_text(json.dumps(diagnostic,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'screenshot':str(out.relative_to(root)),'state':state,'errors':diagnostic['errors'],'invalidSvg':diagnostic['invalidSvg'],'brokenImages':diagnostic['brokenImages']},ensure_ascii=False))
