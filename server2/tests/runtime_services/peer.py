"""Owned S20b HTTP/S3/OAuth/FCM peer; synthetic payloads only, never relays traffic."""
import gzip, json, sys, threading
from pathlib import Path
from urllib.parse import urlsplit, unquote
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'tests/storage'))
import catalog_peer

class Handler(catalog_peer.Handler):
    def event(self, kind, **fields):
        with self.server.test_lock:
            self.server.events.append(dict(kind=kind, **fields))
    def hold(self, phase):
        if self.server.phase == phase:
            self.event('held', phase=phase)
            self.server.release.wait(40)
    def dispatch(self):
        path = unquote(urlsplit(self.path).path)
        if path == '/status':
            with self.server.test_lock: events = list(self.server.events)
            return self.send(200, json.dumps(events).encode(), {'Content-Type':'application/json'})
        if path == '/release':
            self.server.release.set()
            return self.send(204)
        if path == '/native':
            self.event('native', path=self.headers.get('x-native-path'), language=self.headers.get('accept-language'))
            self.hold('weather')
            body = self.server.alert_weather if 'Busan' in self.headers.get('x-native-path','') else self.server.weather
            return self.send(200, body, {'Content-Type':'application/json'})
        if path == '/o/oauth2/token':
            self.rfile.read(int(self.headers.get('content-length', 0)))
            self.event('oauth')
            self.hold('oauth')
            self.server.oauth_done = True
            return self.send(200, b'{"access_token":"synthetic-token","expires_in":3600}', {'Content-Type':'application/json'})
        if path.endswith('/messages:send'):
            self.rfile.read(int(self.headers.get('content-length', 0)))
            with self.server.lock:
                claims = [k for k in self.server.objects if '/delivery/' in k and k.endswith('.json') and not k.endswith('.result.json')]
            self.event('post', claims=claims)
            self.hold('post')
            if self.server.phase == 'ambiguous':
                self.event('ambiguous')
                self.close_connection = True
                return
            return self.send(200, b'{"name":"projects/synthetic/messages/one"}', {'Content-Type':'application/json'})
        key = path.split('/', 2)[2] if len(path.split('/', 2)) == 3 else ''
        if self.command == 'PUT' and '/state/journal/' in key:
            self.hold('registration')
        if self.command == 'GET' and '/state/journal/' in key and self.server.oauth_done:
            self.hold('before-post')
        if self.command == 'PUT' and key.endswith('.result.json'):
            self.hold('result')
        return super().dispatch()
    do_GET = do_HEAD = do_PUT = do_POST = do_DELETE = do_OPTIONS = dispatch

def make(phase='idle'):
    peer = catalog_peer.make()
    peer.config["socket_timeout_seconds"] = 40
    peer.RequestHandlerClass = Handler
    peer.phase, peer.oauth_done = phase, False
    peer.events, peer.test_lock, peer.release = [], threading.Lock(), threading.Event()
    alarm = json.load(gzip.open(ROOT/'tests/delivery/fixtures/alarm-oracle.json.gz'))
    peer.weather = json.dumps(alarm['cases'][0]['weather']['kma']['body']).encode()
    alerts = json.load(gzip.open(ROOT/'tests/delivery/fixtures/alerts-oracle.json.gz'))
    wet = next(c for c in alerts['cases'] if c['id']=='current-ko-1')
    peer.alert_weather = json.dumps(wet['body']).encode()
    return peer
