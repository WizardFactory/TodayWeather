"""Loopback-only asset server and command/log channel for the isolated renderer."""
import http.server
import json
from pathlib import Path
import time

ROOT = Path(__file__).resolve().parent

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / 'www'), **kwargs)

    def do_GET(self):
        if self.path == '/__command':
            path = ROOT / 'command.json'
            body = path.read_bytes() if path.exists() else b'null'
            path.unlink(missing_ok=True)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)
        else:
            super().do_GET()

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        event = json.loads(body)
        if self.path == '/__result':
            (ROOT / 'result.json').write_text(json.dumps(event, ensure_ascii=False))
        else:
            with (ROOT / 'evidence/events.jsonl').open('a') as f:
                f.write(json.dumps({'time': time.time(), 'event': event}, ensure_ascii=False) + '\n')
        self.send_response(204)
        self.end_headers()

    def log_message(self, fmt, *args):
        if self.path.startswith('/__'):
            return
        with (ROOT / 'evidence/http.log').open('a') as f:
            f.write((fmt % args) + '\n')

http.server.ThreadingHTTPServer(('127.0.0.1', 8765), Handler).serve_forever()
