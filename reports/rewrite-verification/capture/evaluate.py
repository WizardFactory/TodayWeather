"""Evaluate one diagnostic expression in the running WKWebView harness."""
from pathlib import Path
import json
import sys
import time
import uuid

root = Path(__file__).resolve().parent
ident = str(uuid.uuid4())
code = Path(sys.argv[2]).read_text() if sys.argv[1] == '--file' else sys.argv[1]
(root / 'command.json').write_text(json.dumps({'id': ident, 'code': code}))
deadline = time.monotonic() + 20
while time.monotonic() < deadline:
    try:
        result = json.loads((root / 'result.json').read_text())
        if result['id'] == ident:
            print(json.dumps(result, ensure_ascii=False, indent=2))
            sys.exit(1 if 'error' in result else 0)
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    time.sleep(0.25)
raise SystemExit('No response from rendering harness within 20 seconds')
