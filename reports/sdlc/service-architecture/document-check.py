"""Read-only artifact, local-link and source-preservation checks."""
from pathlib import Path
import hashlib, json, re, subprocess
root = Path(__file__).resolve().parents[3]
files = [root/'AGENTS.md', root/'CLAUDE.md', root/'README.md', *sorted((root/'docs/architecture').glob('*.md'))]
count = 0
for p in files:
    for target in re.findall(r'\]\(([^)]+)\)', p.read_text()):
        if '://' in target or target.startswith('#'):
            continue
        dest = (p.parent/target.split('#')[0]).resolve()
        assert dest.exists(), f'{p.relative_to(root)}: broken link {target}'
        count += 1
r = root/'reports/sdlc/service-architecture'
for name, short in [('service-overview','overview'), ('weather-collection','collection'), ('mobile-weather-request','mobile'), ('kaq-image-pipeline','kaq'), ('aws-infrastructure','aws'), ('ec2-internals','ec2')]:
    p = root/'docs/architecture/diagrams'/f'{name}.json'
    spec = json.loads(p.read_text())
    for node in spec.get('components', []):
        for source in node.get('sources', []):
            assert (root/source['path']).is_file(), source
    receipt = json.loads((r/f'{short}-validation.json').read_text())
    assert receipt['ok'], name
    checks = receipt['checks']
    assert len(checks) == 9 and all(c['ok'] for c in checks), name
    assert receipt['composition']['summary'] == {'errors': 0, 'warnings': 0}
    browser = json.loads((r/f'{name}-browser-command.json').read_text())
    html = p.with_suffix('.html')
    assert browser['status'] == 'pass'
    assert browser['artifact']['sha256'] == hashlib.sha256(html.read_bytes()).hexdigest()
    handoff = next(d for d in json.loads((r/'diagram-handoff.json').read_text()) if d['output'].endswith(name+'.html'))
    assert handoff['artifact_sha256'] == browser['artifact']['sha256']
    assert handoff['specification_sha256'] == hashlib.sha256(p.read_bytes()).hexdigest()
# Product source remains identical to the baseline; tracked edits are README navigation and authorized ignore rules.
changed = subprocess.check_output(['git','diff','--name-only'], cwd=root, text=True).splitlines()
assert changed == ['.gitignore', 'README.md'], changed
subprocess.run(['git','diff','--check'], cwd=root, check=True)
old = subprocess.check_output(['git','show','HEAD:README.md'], cwd=root, text=True)
new = (root/'README.md').read_text()
insert = '\n## Architecture documentation\n\nSee the [service architecture guide](docs/architecture/README.md) for the overall structure, weather collection pipeline, mobile API calls, and interactive Archify diagrams. Shared contributor and agent guidance is maintained in [AGENTS.md](AGENTS.md).\n'
assert new.replace(insert, '', 1) == old, 'Existing README material changed'
print(f'PASS: {count} local links; 6 evidence sources/specs/HTML/browser bindings; 54 showcase checks; original product files and README content preserved.')

for p in (root/'docs/architecture/diagrams').iterdir():
    if p.suffix in ['.html', '.json']:
        assert subprocess.run(['git','check-ignore','-q',str(p)],cwd=root).returncode == 1, str(p)
    elif '.visual-check.' in p.name and p.suffix == '.png':
        assert subprocess.run(['git','check-ignore','-q',str(p)],cwd=root).returncode == 0, str(p)
assert subprocess.run(['git','check-ignore','-q','.aws/aleckim.pem'],cwd=root).returncode == 0
print('PASS: HTML/JSON retained; visual-check PNGs and SSH private key ignored.')
