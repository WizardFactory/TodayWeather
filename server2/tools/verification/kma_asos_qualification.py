#!/usr/bin/env python3
"""Bounded source feasibility only. Never a client/full-response latency sample."""
import argparse, collections, datetime as dt, hashlib, json, pathlib, sys, time
from urllib.parse import urlencode, unquote
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError
from zoneinfo import ZoneInfo
from kma_cold_measure import private_key_list
class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs): return None
LIMIT=8*1024*1024

def main():
    p=argparse.ArgumentParser();p.add_argument('--env-file',required=True);p.add_argument('--out',required=True);p.add_argument('--mode',choices=['basics','boundaries'],default='basics');a=p.parse_args()
    out=pathlib.Path(a.out);out.mkdir(parents=True,exist_ok=False)
    keys=json.loads(private_key_list(a.env_file))
    if not isinstance(keys,list) or not keys or not isinstance(keys[0],str): raise ValueError('key-list shape')
    now=dt.datetime.now(ZoneInfo('Asia/Seoul'));end=now.date()-dt.timedelta(days=1);start=end-dt.timedelta(days=6)
    opener=build_opener(NoRedirect());report={'scope':'ASOS source qualification only; no AWS, client, cache or tail measurement','observed_at':now.isoformat(),'attempt_cap':4,'attempts':[]}
    for kind,service in ([('hourly','AsosHourlyInfoService'),('daily','AsosDalyInfoService')] if a.mode=='basics' else [('hourly-today','AsosHourlyInfoService'),('hourly-winter','AsosHourlyInfoService')]):
        hourly=kind.startswith('hourly')
        q=dict(serviceKey=unquote(keys[0]),pageNo=1,numOfRows=999,dataType='JSON',dataCd='ASOS',dateCd='HR' if hourly else 'DAY',startDt=start.strftime('%Y%m%d'),endDt=end.strftime('%Y%m%d'),stnIds='108')
        if hourly:q.update(startHh='00',endHh='23')
        if kind=='hourly-today':q.update(startDt=now.strftime('%Y%m%d'),endDt=now.strftime('%Y%m%d'),startHh='00',endHh='00')
        if kind=='hourly-winter':q.update(startDt='20260101',endDt='20260107')
        entry={'kind':kind,'station':'108','start':q['startDt'],'end':q['endDt']};t=time.monotonic()
        try:
            req=Request('https://apis.data.go.kr/1360000/'+service+'/getWthrDataList?'+urlencode(q),headers={'User-Agent':'TodayWeather-server2-source-qualification/1'})
            with opener.open(req,timeout=10) as response:
                body=response.read(LIMIT+1);entry.update(status=response.status,bytes=len(body))
            if len(body)>LIMIT: raise ValueError('response cap')
            entry['sha256']=hashlib.sha256(body).hexdigest();path=out/(kind+'.json');path.write_bytes(body)
            data=json.loads(body);head=data.get('response',{}).get('header',{});entry['result_code']=head.get('resultCode')
            payload=data.get('response',{}).get('body',{});rows=payload.get('items',{}).get('item',[])
            if isinstance(rows,dict):rows=[rows]
            entry.update(total=payload.get('totalCount'),rows=len(rows),first=rows[0].get('tm') if rows else None,last=rows[-1].get('tm') if rows else None)
            fields=['ta','hm','rn','dc10Tca','dmstMtphNo','rnQcflg'] if hourly else ['minTa','maxTa','sumRn','sumRnDur','iscs']
            entry['fields']={f:dict(collections.Counter('missing' if f not in r else 'blank' if str(r[f]).strip()=='' else 'value' for r in rows)) for f in fields}
            entry['codes']=dict(collections.Counter(r.get('dmstMtphNo','MISSING') for r in rows)) if hourly else None
        except HTTPError as exc:entry.update(status=exc.code,error='HTTPError')
        except Exception as exc:entry['error']=type(exc).__name__
        entry['provider_http_ms']=round((time.monotonic()-t)*1000,3);report['attempts'].append(entry)
    if a.mode=='boundaries':
        for name,hour in [('aws-d7',dt.datetime.combine(start,dt.time(12))),('aws-midnight',dt.datetime.combine(now.date(),dt.time(0)))]:
            entry={'kind':name,'requested_kst':hour.isoformat()};t=time.monotonic()
            try:
                req=Request('https://www.weather.go.kr/cgi-bin/aws/nph-aws_txt_min?'+hour.strftime('%Y%m%d%H%M')+'&0&MINDB_60M&0&m',headers={'User-Agent':'TodayWeather-server2-source-qualification/1'})
                with opener.open(req,timeout=10) as response:body=response.read(LIMIT+1);entry.update(status=response.status,bytes=len(body))
                if len(body)>LIMIT:raise ValueError('response cap')
                entry['sha256']=hashlib.sha256(body).hexdigest();(out/(name+'.html')).write_bytes(body)
                entry['circle_no_rain']=body.count('○'.encode('euc-kr'))
                entry['circle_rain']=body.count('●'.encode('euc-kr'))
            except HTTPError as exc:entry.update(status=exc.code,error='HTTPError')
            except Exception as exc:entry['error']=type(exc).__name__
            entry['provider_http_ms']=round((time.monotonic()-t)*1000,3);report['attempts'].append(entry)
    (out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False,indent=2))
if __name__=='__main__':
    try:main()
    except Exception as exc:print(json.dumps({'setup_error':type(exc).__name__}),file=sys.stderr);sys.exit(1)
