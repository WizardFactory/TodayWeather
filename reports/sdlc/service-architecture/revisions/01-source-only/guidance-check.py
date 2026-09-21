"""Dependency-free checks for the shared agent entrypoint contract."""
from pathlib import Path
import re
root = Path(__file__).resolve().parents[3]
canonical = root / 'AGENTS.md'
adapter = root / 'CLAUDE.md'
assert canonical.is_file(), 'Missing canonical AGENTS.md'
assert adapter.is_file(), 'Missing Claude adapter'
assert adapter.read_text().strip() == '@AGENTS.md', 'Adapter must import the canonical rules without duplication'
text = canonical.read_text()
for expected in ['Korean', 'English', '.agents/skills/', 'SERVER_MODE', 'docs/architecture/', 'Codex', 'Claude']:
    assert expected in text, 'Missing shared contract: ' + expected
for target in re.findall(r'\]\(([^)]+)\)', text):
    assert (root / target.split('#')[0]).exists(), 'Broken instruction link: ' + target
assert (root / adapter.read_text().strip()[1:]).resolve() == canonical.resolve()
print('PASS: Codex AGENTS.md and Claude @AGENTS.md resolve one canonical source; required rules and links present.')
