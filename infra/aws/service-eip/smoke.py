"""Offline functional journey: real loopback HTTP, fake AWS/SNS only."""
import contextlib
import io
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent/'tests'))
from test_readiness import BODY, NOW, ENV, EVENT, FakeEC2
import lambda_function as checker
import failure_observer as observer

class Handler(BaseHTTPRequestHandler):
    healthy=False
    def do_GET(self):
        body=b'OK' if self.path=='/health' else BODY if self.healthy else b'{}'
        self.send_response(200);self.end_headers();self.wfile.write(body)
    def log_message(self,*args):pass

def main():
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    calls=[];ec2=FakeEC2();sink=[]
    def http(ip,path):
        calls.append(path)
        return checker.http_get('127.0.0.1:'+str(server.server_port),path)
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            try:
                checker.handle(EVENT,ec2=ec2,env=ENV,http=http,sleep=lambda x:None,now=lambda:NOW,invocation_id='smoke-request')
                raise AssertionError('invalid weather attached')
            except checker.RetryableError as error:
                diagnostic=str(error)
            assert ec2.associations==[] and len(calls)==36
            source='arn:aws:lambda:ap-northeast-2:123456789012:function:AttachEIPToSpot'
            record={'requestContext':{'functionArn':source+':$LATEST','condition':'RetriesExhausted','requestId':'smoke-request'},'requestPayload':EVENT,'responsePayload':{'errorMessage':diagnostic}}
            observer.handle(record,env={'SOURCE_FUNCTION_ARN':source,'ALERT_TOPIC_ARN':'arn:aws:sns:ap-northeast-2:123456789012:test'},publish=lambda **x:sink.append(x))
            assert len(sink)==1 and json.loads(sink[0]['Message'])['last_probe']['stage']=='validation'
            Handler.healthy=True
            assert checker.handle(EVENT,ec2=ec2,env=ENV,http=http,sleep=lambda x:None,now=lambda:NOW)=={'status':'attached'}
            assert len(ec2.associations)==1
        print(json.dumps({'smoke':'passed','real_loopback_requests':len(calls),'fake_notifications':len(sink),'fake_associations':len(ec2.associations),'production_calls':0}))
    finally:
        server.shutdown();server.server_close();thread.join()
if __name__=='__main__':main()
