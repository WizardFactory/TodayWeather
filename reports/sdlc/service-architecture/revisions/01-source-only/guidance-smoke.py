"""Exercise the actual local documentation navigation from both agent entrypoints.

This is a file-based functional check, not a Codex/Claude launcher test.
"""
from pathlib import Path
import re
root=Path(__file__).resolve().parents[3]
journeys={
 'mobile API change':('mobile-api.md',['client/www/js/service.weatherutil.js','server/app.js','server/routes/v000903/index.js']),
 'collection freshness investigation':('weather-collection.md',['server/controllers/controllerManager.js','server/routes/v000001/routeGather.js','server/controllers/worldWeather/dsf.controller.js']),
}
resolved=[]
for entry in ['AGENTS.md','CLAUDE.md']:
    current=root/entry
    if current.read_text().strip().startswith('@'):
        current=current.parent/current.read_text().strip()[1:]
    resolved.append(current.resolve())
    text=current.read_text()
    for scenario,(document,sources) in journeys.items():
        rel='docs/architecture/'+document
        assert rel in text
        doc=root/rel
        destinations={(doc.parent/t.split('#')[0]).resolve() for t in re.findall(r'\]\(([^)]+)\)',doc.read_text()) if '://' not in t}
        for source in sources:
            p=root/source
            assert p.resolve() in destinations, (entry,scenario,source)
            assert p.read_text().strip()
        print(f'PASS {entry}: {scenario} reaches {document} and {len(sources)} actual implementation sources')
    assert '.agents/skills/<name>/' in text and 'hooks for both' in text and 'discovery and execution' in text
    print(f'PASS {entry}: shared skill task resolves canonical scope, both CLI links/hooks and verification requirement')
assert len(set(resolved))==1
print('PASS: 6 local guidance journeys; same canonical file, no runtime/provider actions, no CLI launch claim.')
