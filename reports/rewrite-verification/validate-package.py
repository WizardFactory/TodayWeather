"""Offline validation for the rewrite reference artifacts; never imports the server."""
import ast
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import struct
from urllib.parse import unquote, urlsplit

ROOT=Path(__file__).resolve().parents[2]
AREAS=[ROOT/'docs/rewrite',ROOT/'reports/rewrite-verification']
errors=[]
counts={'json':0,'local_links':0,'screenshots':0,'capture_diagnostics':0,'python':0}
def check_link(owner, raw):
    if raw.startswith(('http:','https:','data:','mailto:','#','javascript:')):return
    path=unquote(urlsplit(raw).path)
    if not path:return
    # Repository documentation uses GitHub-style #L anchors; check the actual file.
    target=(owner.parent/path).resolve()
    counts['local_links']+=1
    if not target.exists():errors.append(f'{owner.relative_to(ROOT)}: missing {raw}')

class Links(HTMLParser):
    def __init__(self, owner):super().__init__();self.owner=owner
    def handle_starttag(self, tag, attrs):
        for key,value in attrs:
            if key in ('src','href') and value:check_link(self.owner,value)

for area in AREAS:
    for path in area.rglob('*'):
        if not path.is_file():continue
        try:
            if path.suffix=='.json':json.loads(path.read_text());counts['json']+=1
            elif path.suffix=='.md':
                for raw in re.findall(r'\]\(([^)]+)\)',path.read_text()):check_link(path,raw)
            elif path.suffix=='.html' and path.name=='index.html':Links(path).feed(path.read_text())
            elif path.suffix=='.py':ast.parse(path.read_text());counts['python']+=1
        except Exception as exc:errors.append(f'{path.relative_to(ROOT)}: {exc}')

manifest=json.loads((ROOT/'docs/rewrite/screenshots/manifest.json').read_text())
for item in manifest:
    path=ROOT/'docs/rewrite/screenshots'/item['file'];data=path.read_bytes()
    assert data[:8]==b'\x89PNG\r\n\x1a\n'
    if hashlib.sha256(data).hexdigest()!=item['sha256']:errors.append(f'PNG hash mismatch: {item["file"]}')
    if list(struct.unpack('>II',data[16:24]))!=item['pixels']:errors.append(f'PNG dimensions mismatch: {item["file"]}')
    counts['screenshots']+=1
    if 'diagnostic' in item:
        d=json.loads((path.parent/item['diagnostic']).resolve().read_text())
        if d['errors'] or d['brokenImages'] or d['invalidSvg']:errors.append(f'Capture diagnostics: {item["file"]}')
        counts['capture_diagnostics']+=1

result={'source_commit':'ff7acf3996ccb66c912d2ed4710cf300197d6966','checks':counts,'errors':errors,'passed':not errors,'limits':'Checks local link targets, syntax and evidence bytes; does not validate every prose claim, anchor, meteorological value or live integration.'}
(ROOT/'reports/rewrite-verification/package-validation.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
raise SystemExit(1 if errors else 0)
