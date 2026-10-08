"""Bounded local-only benchmark peers; no TLS/SigV4/IAM/AWS performance claims.

All bodies and versions are volatile. Dummy keys and sanitized aggregate counters
only; never log signed URLs, query strings, provider keys or raw provider bodies.
"""
import importlib.util
import json
import socket
from pathlib import Path
import sys
import threading
import time
from urllib.parse import parse_qs, urlsplit

OWNED = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('s09_local_s3_base', OWNED/'deploy/local/peer.py')
base = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = base
spec.loader.exec_module(base)


class Handler(base.Handler):
    def send(self, status, body=b'', headers=None):
        # Explicit local-only failure fixture: commit one provider raw body, lose
        # its reply and reconciliation. Normal benchmark mode is unchanged.
        if (self.server.fault_mode == 'uncertain-provider-publication'
                and getattr(self, 'method_kind', '') == 'PUT:raw'
                and status == 200 and self.server.provider_fault_armed):
            self.server.provider_fault_armed = False
            self.server.drop_raw_reconciliation = True
            self.close_connection = True
            try: self.connection.shutdown(socket.SHUT_RDWR)
            except OSError: pass
            return
        if getattr(self, 'measured', False):
            with self.server.metrics_lock:
                self.server.metrics['response_bytes'] += 0 if self.command == 'HEAD' else len(body)
                k = f'{self.method_kind}:{status}'
                self.server.metrics['statuses'][k] = self.server.metrics['statuses'].get(k, 0)+1
        super().send(status, body, headers)

    def dispatch(self):
        split = urlsplit(self.path)
        if split.path == '/__benchmark/status' and self.command == 'GET':
            with self.server.metrics_lock:
                result = json.loads(json.dumps(self.server.metrics))
                result['operation_latency_us']={}
                for k,values in self.server.latencies.items():
                    ordered=sorted(values)
                    result['operation_latency_us'][k]={'retained_samples':len(ordered),'total_calls':result['requests'].get(k,0),'sample_cap':20000,'p50':ordered[(len(ordered)*50+99)//100-1] if ordered else None,'p95':ordered[(len(ordered)*95+99)//100-1] if ordered else None,'p99':ordered[(len(ordered)*99+99)//100-1] if ordered else None,'complete':len(ordered)==result['requests'].get(k,0)}
            with self.server.lock:
                result['objects'] = len(self.server.objects)
                result['current_body_bytes'] = sum(len(o.body) for o in self.server.objects.values())
                result['version_body_bytes'] = sum(len(o.body) for v in self.server.versions.values() for o in v)
                result['catalog_current_bytes'] = sum(len(o.body) for k,o in self.server.objects.items() if k.startswith('index/v2/') and not k.startswith('index/v2/groups/'))
                result['catalog_version_bytes'] = sum(len(o.body) for k,v in self.server.versions.items() if k.startswith('index/v2/') and not k.startswith('index/v2/groups/') for o in v)
            return self.send(200,json.dumps(result).encode(),{'Content-Type':'application/json'})
        if split.path == '/__benchmark/forget' and self.command == 'POST':
            if self.headers.get('X-Server2-Test-Key') != 'server2-local': return self.error(403,'OnlyLocalTestControl')
            key = parse_qs(split.query).get('key',[''])[0]
            if not key.startswith('index/v2/') or not base.valid_key(key): return self.error(400,'InvalidTestKey')
            with self.server.lock: self.server.objects.pop(key,None)
            return self.send(204)
        # Label by semantic prefix, never retain object identity/query.
        query=parse_qs(split.query)
        key=split.path.split('/',2)[-1]
        prefix='budget' if key.startswith('budgets/v2/') else ('raw' if key.startswith('raw/v2/') else ('group' if key.startswith('index/v2/groups/') else 'catalog'))
        method='LIST' if query.get('list-type') == ['2'] else self.command
        if split.path == '/provider': method,prefix='PROVIDER','provider'
        self.method_kind=f'{method}:{prefix}'
        self.measured=True
        started=time.monotonic_ns()
        with self.server.metrics_lock:
            m=self.server.metrics
            m['requests'][self.method_kind]=m['requests'].get(self.method_kind,0)+1
            m['request_bytes']+=int(self.headers.get('Content-Length','0'))
            m['active']+=1
            m['peak_inflight']=max(m['peak_inflight'],m['active'])
        try:
            if self.method_kind == 'HEAD:raw' and self.server.drop_raw_reconciliation:
                self.close_connection = True
                try: self.connection.shutdown(socket.SHUT_RDWR)
                except OSError: pass
                return
            if split.path == '/provider':
                if self.command != 'GET' or query.get('serviceKey') != ['benchmark-only'] or query.get('dataType') != ['JSON']:
                    return self.error(403,'OnlySyntheticRequest')
                mode=query.get('mode',['data'])[0]
                if mode=='nodata': body=b'{"response":{"header":{"resultCode":"03"}}}'
                elif mode=='error': body=b'{"response":{"header":{"resultCode":"10"}}}'
                elif mode=='data':
                    body=b'{"ok":true,"value":42}'
                    self.server.provider_fault_armed = True
                else: return self.error(400,'OnlySyntheticMode')
                return self.send(200,body,{'Content-Type':'application/json'})
            return super().dispatch()
        finally:
            with self.server.metrics_lock:
                m=self.server.metrics
                m['active']-=1
                elapsed=(time.monotonic_ns()-started)//1000
                m['duration_us'][self.method_kind]=m['duration_us'].get(self.method_kind,0)+elapsed
                values=self.server.latencies.setdefault(self.method_kind,[])
                if len(values)<20000:values.append(elapsed)
            self.measured=False

    do_GET = do_HEAD = do_PUT = do_POST = do_OPTIONS = dispatch


def make(fault_mode=None):
    config=base.load_config(OWNED/'config/local-stack.json')
    # Test-only resource cap, independent of production admission/transport pools.
    config.update(max_store_bytes=256*1024*1024,max_versions=256,max_connections=128,max_objects=8192,socket_timeout_seconds=3)
    peer=base.Peer('s3',config,{})
    peer.RequestHandlerClass=Handler
    peer.metrics_lock=threading.Lock()
    peer.latencies={}
    peer.fault_mode=fault_mode
    peer.provider_fault_armed=False
    peer.drop_raw_reconciliation=False
    peer.metrics={'requests':{},'statuses':{},'duration_us':{},'request_bytes':0,'response_bytes':0,'active':0,'peak_inflight':0}
    return peer


if __name__ == '__main__':
    fault_mode = None
    if sys.argv[1:]:
        if sys.argv[1:] != ['--fault', 'uncertain-provider-publication']:
            raise SystemExit('only explicit local failure fixture is supported')
        fault_mode = sys.argv[2]
    peer=make(fault_mode)
    print(f'http://127.0.0.1:{peer.server_port}/',flush=True)
    try: peer.serve_forever()
    finally: peer.server_close()
