"""Expected wire behavior of the S03 test peer, not AWS conformance."""
import base64
import concurrent.futures
import hashlib
import http.client
import json
import socket
import time
from pathlib import Path
import threading
import unittest
import xml.etree.ElementTree as ET

from peer import make_peer, load_config, load_fixtures

OWNED = Path(__file__).resolve().parents[2]


class LocalContract(unittest.TestCase):
    def setUp(self):
        self.config = load_config(OWNED / 'config/local-stack.json')
        self.peer = make_peer('s3', self.config)
        self.thread = threading.Thread(target=self.peer.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.peer.shutdown(); self.peer.server_close(); self.thread.join(3)

    def call(self, method, path, body=None, headers=None):
        client = http.client.HTTPConnection(*self.peer.server_address, timeout=3)
        try:
            client.request(method, path, body, dict({'X-Server2-Test-Key':'server2-local'}, **(headers or {})))
            reply = client.getresponse(); return reply.status, dict(reply.getheaders()), reply.read()
        finally: client.close()

    def put(self, key, body=b'raw gzip bytes', **headers):
        headers.update({'Content-MD5':base64.b64encode(hashlib.md5(body).digest()).decode(),
                        'If-None-Match':'*', 'Content-Type':'application/gzip'})
        return self.call('PUT', '/server2-local/'+key, body, headers)

    def test_immutable_metadata_md5_and_missing(self):
        self.assertEqual(self.call('GET','/server2-local/missing')[0],404)
        self.assertEqual(self.call('PUT','/server2-local/a',b'x',{'Content-MD5':'wrong','If-None-Match':'*'})[0],400)
        self.assertEqual(self.call('GET','/server2-local/a')[0],404)
        status, headers, _ = self.put('raw/a', **{'x-amz-meta-s2-record':'eyJ2IjoxfQ==','x-amz-meta-s2-gzip-sha256':'abc'})
        self.assertEqual(status,200)
        self.assertEqual(self.put('raw/a',b'changed')[0],412)
        for method in ['HEAD','GET']:
            status, info, body = self.call(method,'/server2-local/raw/a')
            self.assertEqual(status,200); self.assertEqual(info['ETag'],headers['ETag'])
            self.assertEqual(info['x-amz-meta-s2-record'],'eyJ2IjoxfQ==')
            self.assertEqual(int(info['Content-Length']),14)
            self.assertEqual(body,b'' if method=='HEAD' else b'raw gzip bytes')
        self.assertNotIn('Content-Encoding',info)

    def test_parallel_create_and_cas(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(lambda _:self.put('catalog/a')[0],range(2)))
        self.assertEqual(sorted(results),[200,412])
        etag=self.call('HEAD','/server2-local/catalog/a')[1]['ETag']
        data=b'new catalog';md5=base64.b64encode(hashlib.md5(data).digest()).decode()
        self.assertEqual(self.call('PUT','/server2-local/catalog/a',data,{'If-Match':'"wrong"','Content-MD5':md5})[0],412)
        self.assertEqual(self.call('PUT','/server2-local/catalog/a',data,{'If-Match':etag,'Content-MD5':md5})[0],200)
        self.assertEqual(self.call('GET','/server2-local/catalog/a')[2],data)
        self.assertEqual(self.call('GET','/server2-local/catalog/a?versionId=1')[2],b'raw gzip bytes')
        self.assertEqual(self.call('GET','/server2-local/catalog/a?versionId=999')[0],404)

    def test_fault_after_commit_and_pagination(self):
        self.assertEqual(self.call('POST','/__test/fault/error-after-put?key=raw%2Fa')[0],204)
        self.assertEqual(self.put('raw/a')[0],500)
        self.assertEqual(self.call('GET','/server2-local/raw/a')[2],b'raw gzip bytes')
        self.put('raw/b');self.put('unrelated')
        response=self.call('GET','/server2-local?list-type=2&prefix=raw%2F&max-keys=1')
        xml=ET.fromstring(response[2]);ns={'s':'http://s3.amazonaws.com/doc/2006-03-01/'}
        self.assertEqual(xml.find('s:Contents/s:Key',ns).text,'raw/a')
        token=xml.find('s:NextContinuationToken',ns).text
        response=self.call('GET','/server2-local?list-type=2&prefix=raw%2F&max-keys=1&continuation-token='+token)
        self.assertIn(b'raw/b',response[2]);self.assertNotIn(b'unrelated',response[2])

    def test_boundary_limits_and_unknown_credentials(self):
        self.assertEqual(self.call('GET','/other/x')[0],404)
        self.assertEqual(self.call('GET','/server2-local/../x')[0],400)
        self.assertEqual(self.call('GET','/server2-local/x',headers={'X-Server2-Test-Key':'production-looking'})[0],403)
        self.assertEqual(self.call('DELETE','/server2-local/x')[0],405)
        self.assertEqual(self.call('PUT','/server2-local/raw/large',headers={'Content-Length':str(self.config['max_object_bytes']+1),'If-None-Match':'*'})[0],413)
        self.assertEqual(self.call('GET','/server2-local/raw/large')[0],404)
        self.assertEqual(self.put('raw/meta',**{'x-amz-meta-extra':'x'*2043})[0],200)
        self.assertEqual(self.put('raw/meta-large',**{'x-amz-meta-extra':'x'*2044})[0],400)

    def test_fixture_bytes_and_no_unknown_proxy(self):
        provider=make_peer('provider',self.config,load_fixtures(OWNED/'config/fixtures/providers.json'))
        thread=threading.Thread(target=provider.serve_forever,daemon=True);thread.start()
        original=self.peer;self.peer=provider
        try:
            status,_,raw=self.call('GET','/kma/pwn-status');self.assertEqual(status,200)
            self.assertEqual(raw,(OWNED/'config/fixtures/pwn-status.json').read_bytes())
            self.assertEqual(self.call('GET','/https://data.go.kr/live')[0],404)
            self.assertEqual(self.call('POST','/kma/pwn-status',b'x')[0],405)
        finally:
            provider.shutdown();provider.server_close();thread.join(3);self.peer=original

    def test_empty_bodies_cannot_bypass_store_or_object_caps(self):
        self.peer.config['max_objects']=1
        self.assertEqual(self.put('zero/a',b'')[0],200)
        self.assertEqual(self.put('zero/b',b'')[0],507)
        self.peer.config['max_objects']=4096
        self.peer.config['max_store_bytes']=self.peer.stored_bytes
        self.assertEqual(self.put('zero/b',b'')[0],507)
        self.assertEqual(self.call('GET','/server2-local/zero/b')[0],404)

    def test_presigned_dummy_credential_shape(self):
        path='/server2-local/missing?X-Amz-Credential=server2-local%2F20261006%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Signature='+('a'*64)
        self.assertEqual(self.call('GET',path,headers={'X-Server2-Test-Key':''})[0],404)
        self.assertEqual(self.call('GET',path.replace('server2-local%2F','not-local%2F'),headers={'X-Server2-Test-Key':''})[0],403)

    def test_unsupported_list_parameters_are_rejected(self):
        for argument in ['delimiter=%2F','start-after=d%2Fb','fetch-owner=true','encoding-type=url','unknown=value']:
            with self.subTest(argument=argument):
                self.assertEqual(self.call('GET','/server2-local?list-type=2&'+argument)[0],501)
        self.assertEqual(self.call('GET','/server2-local?list-type=2&prefix=a&prefix=b')[0],400)

    def test_utf8_metadata_counts_original_wire_bytes(self):
        def raw_put(key,value,extra=b''):
            body=b'x';md5=base64.b64encode(hashlib.md5(body).digest())
            request=(b'PUT /server2-local/'+key+b' HTTP/1.0\r\nHost: 127.0.0.1:'+str(self.peer.server_port).encode()+b'\r\nX-Server2-Test-Key: server2-local\r\nContent-Length: 1\r\nContent-MD5: '+md5+b'\r\nIf-None-Match: *\r\nx-amz-meta-k: '+value+b'\r\n'+extra+b'\r\nx')
            with socket.create_connection(self.peer.server_address,timeout=3) as client:
                client.sendall(request);reply=b''
                while True:
                    chunk=client.recv(4096)
                    if not chunk:break
                    reply+=chunk
            return int(reply.split(b' ')[1]),reply
        value=('가'*600).encode('utf-8')
        self.assertEqual(raw_put(b'utf8/valid',value)[0],200)
        status,_,_=self.call('HEAD','/server2-local/utf8/valid');self.assertEqual(status,200)
        boundary=('가'*682).encode('utf-8')+b'x' # 2047 value + one user-key byte.
        self.assertEqual(raw_put(b'utf8/limit',boundary)[0],200)
        self.assertEqual(raw_put(b'utf8/over',boundary+b'x')[0],400)
        self.assertEqual(raw_put(b'utf8/header-over',b'x',b'X-Test: '+b'a'*8192+b'\r\n')[0],400)

    def test_dripping_connections_release_all_slots_by_absolute_deadline(self):
        self.peer.config['socket_timeout_seconds']=1
        self.peer.slots=threading.BoundedSemaphore(2)
        stop=threading.Event();closed=[];started=time.monotonic()
        def drip():
            with socket.create_connection(self.peer.server_address,timeout=3) as client:
                client.sendall(b'GET /')
                while not stop.wait(0.05):
                    try:client.sendall(b'x')
                    except OSError:closed.append(time.monotonic()-started);return
        threads=[threading.Thread(target=drip) for _ in range(2)]
        for thread in threads:thread.start()
        try:
            time.sleep(1.4)
            self.assertEqual(self.call('GET','/server2-local/missing')[0],404)
            self.assertEqual(len(closed),2)
            self.assertTrue(all(0.7 <= elapsed <= 1.35 for elapsed in closed),closed)
        finally:
            stop.set()
            for thread in threads:thread.join(3)

    def test_bad_config_never_binds_external(self):
        invalid=dict(self.config,bind='0.0.0.0')
        with self.assertRaises(ValueError):make_peer('s3',invalid)


class StagingContract(unittest.TestCase):
    def test_runtime_role_is_prefix_scoped_without_delete_or_admin(self):
        policy=json.loads((OWNED/'deploy/staging/role-policy.template.json').read_text())
        allowed={'s3:ListBucket','s3:GetObject','s3:PutObject','s3:GetObjectVersion','s3:ListBucketVersions'}
        for statement in policy['Statement']:
            self.assertEqual(statement['Effect'],'Allow')
            self.assertTrue(set(statement['Action']) <= allowed)
            resources=statement['Resource'] if isinstance(statement['Resource'],list) else [statement['Resource']]
            self.assertTrue(all(x.startswith('arn:aws:s3:::${BucketName}') for x in resources))
            if any(x in statement['Action'] for x in ['s3:ListBucket','s3:ListBucketVersions']):
                self.assertTrue(statement['Condition']['StringLike']['s3:prefix'])
                self.assertNotIn('*',statement['Condition']['StringLike']['s3:prefix'])
            else:self.assertTrue(all(not x.endswith('${BucketName}/*') for x in resources))

    def test_no_resource_or_secret_is_silently_selected(self):
        plan=json.loads((OWNED/'deploy/staging/prerequisites.json').read_text())
        for key in ['account_id','region','bucket_name','runtime_role_arn','monthly_spend_ceiling_usd']:
            self.assertIsNone(plan[key])
        self.assertFalse(plan['host_candidate']['measured_target'])
        self.assertFalse(plan['bucket']['lifecycle_deletes'])
        self.assertTrue(plan['provider_keys']['separate_from_legacy'])
        self.assertFalse(plan['provider_keys']['values_in_git'])
        gate=plan['readiness']['missing_key_iam_validation']
        self.assertIn('unverified',gate['status'])
        self.assertIn('404',gate['required_check']);self.assertIn('403',gate['required_check'])
        self.assertIn('Block readiness',gate['failure'])
        policy=json.loads((OWNED/'deploy/staging/bucket-policy.template.json').read_text())
        by_id={s['Sid']:s for s in policy['Statement']}
        self.assertEqual(by_id['RequireTLS']['Condition']['Bool']['aws:SecureTransport'],'false')
        self.assertEqual(by_id['RequireConditionalRawCreate']['Condition']['Null']['s3:if-none-match'],'true')
        self.assertEqual(by_id['RequireConditionalMutablePublication']['Condition']['Null'],{'s3:if-match':'true','s3:if-none-match':'true'})


if __name__=='__main__':unittest.main(verbosity=2)
