"""Verify publication cleanup without executing application or cloud code."""
from pathlib import Path
import hashlib,json,re,subprocess
r=Path('reports/sdlc/service-architecture');d=r/'publication-cleanup'
manifest=json.loads((d/'removed-snapshots.json').read_text());base=manifest['preserved_git_commit']
old=json.loads((r/'candidate.json').read_text())
for f in old['files']:
 if f['path']=='docs/architecture/README.md':continue
 assert hashlib.sha256(Path(f['path']).read_bytes()).hexdigest()==f['sha256'],f['path']
for f in manifest['files']:
 assert not Path(f['path']).exists()
 assert hashlib.sha256(subprocess.check_output(['git','show',base+':'+f['path']])).hexdigest()==f['sha256']
deleted=set(subprocess.check_output(['git','diff','--name-only','--diff-filter=D',base],text=True).splitlines())
assert deleted=={f['path'] for f in manifest['files']};assert len(deleted)==59
index=Path('docs/architecture/README.md').read_text();prior=subprocess.check_output(['git','show',base+':docs/architecture/README.md'],text=True)
assert index==prior.replace('6. [EC2 SSH access]','7. [EC2 SSH access]')
assert re.findall(r'^([0-9]+)\. ',index,re.M)==[str(i) for i in range(1,8)]
count=0
for p in [Path('AGENTS.md'),Path('CLAUDE.md'),Path('README.md'),*Path('docs/architecture').glob('*.md'),*list((r/'revisions').glob('*/README.md'))]:
 for link in re.findall(r'\]\(([^)]+)\)',p.read_text()):
  if '://' in link or link.startswith('#'):continue
  assert (p.parent/link.split('#')[0]).exists(),(str(p),link);count+=1
for item in json.loads((r/'diagram-handoff.json').read_text()):
 p=Path(item['output']);assert p.exists();assert hashlib.sha256(p.read_bytes()).hexdigest()==item['artifact_sha256']
 assert hashlib.sha256(p.with_suffix('.json').read_bytes()).hexdigest()==item['specification_sha256']
 assert json.loads((r/item['browser_receipt']).read_text())['artifact']['sha256']==item['artifact_sha256']
for name in ['01-source-only','02-aws-correlated']:
 p=r/'revisions'/name
 assert f'tree/{base}/{p}/deliverables' in (p/'README.md').read_text()
 for f in ['candidate.json','independent-verification.md','test-results.json']:
  assert (p/f).read_bytes()==subprocess.check_output(['git','show',base+':'+str(p/f)])
for f in ['AGENTS.md','CLAUDE.md','paseo.json']:
 assert Path(f).read_bytes()==subprocess.check_output(['git','show',base+':'+f])
assert not subprocess.check_output(['git','diff',base,'--','server','client','tw.ios','ta.ios','applewatch'])
for p in Path('docs/architecture/diagrams').iterdir():
 if p.suffix in ['.html','.json']:assert subprocess.run(['git','check-ignore','-q',str(p)]).returncode==1
print(f'PASS: {len(deleted)} deletions exactly; {sum(f["bytes"] for f in manifest["files"])} historical bytes recoverable; {count} local links; numbering1–7; six unchanged diagram bindings; historical evidence/current guidance/paseo/product preserved; HTML/JSON retained.')
