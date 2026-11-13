#!/usr/bin/env python3
"""Bounded cloud evidence and cleanup primitives for the shadow coordinator.

The public CLI currently audits recorded evidence offline. Live acquisition is
not exposed until the host bootstrap and lifecycle connector are qualified.
No generic AWS command, credential value, shell command or device-send input is
accepted. Successful absence is distinct from an unavailable observation.
"""
from __future__ import annotations
import argparse
import base64
import datetime
import hashlib
import json
import itertools
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

# Executing a script sets its own directory first; tests import the same module.
from state import (CloudResult, Journal, StateError, absence, canonical, decode_cloud,
                   sync_directory, validate_cost_policy, validate_paid_policy, PAID_PROVIDERS, launch_expiry_units)

OPERATIONS = {
    'GetCallerIdentity': ('sts','get-caller-identity','read'),
    'GetConsoleOutput': ('ec2','get-console-output','read'),
    'DescribeSubnets': ('ec2', 'describe-subnets', 'read'),
    'DescribeImages': ('ec2', 'describe-images', 'read'),
    'DescribeKeyPairs': ('ec2', 'describe-key-pairs', 'read'),
    'CreateBucket': ('s3api', 'create-bucket', 'write'),
    'PutPublicAccessBlock': ('s3api', 'put-public-access-block', 'write'),
    'PutBucketVersioning': ('s3api', 'put-bucket-versioning', 'write'),
    'PutBucketTagging': ('s3api', 'put-bucket-tagging', 'write'),
    'CreateRole': ('iam', 'create-role', 'write'),
    'PutRolePolicy': ('iam', 'put-role-policy', 'write'),
    'CreateInstanceProfile': ('iam', 'create-instance-profile', 'write'),
    'AddRoleToInstanceProfile': ('iam', 'add-role-to-instance-profile', 'write'),
    'CreateSecurityGroup': ('ec2', 'create-security-group', 'write'),
    'AuthorizeSecurityGroupIngress': ('ec2', 'authorize-security-group-ingress', 'write'),
    'RunInstances': ('ec2', 'run-instances', 'write'),

    'ListBuckets': ('s3api','list-buckets','read'),
    'ListObjectVersions': ('s3api','list-object-versions','write'),
    'GetObject': ('s3api','get-object','read'),
    'HeadObject': ('s3api','head-object','read'),
    'GetBucketTagging': ('s3api','get-bucket-tagging','read'),
    'GetBucketVersioning': ('s3api','get-bucket-versioning','read'),
    'DeleteVolume': ('ec2','delete-volume','write'),
    'DeleteObjects': ('s3api','delete-objects','write'),
    'DeleteBucket': ('s3api','delete-bucket','write'),
    'DescribeInstances': ('ec2','describe-instances','read'),
    'TerminateInstances': ('ec2','terminate-instances','write'),
    'DescribeSecurityGroups': ('ec2','describe-security-groups','read'),
    'DeleteSecurityGroup': ('ec2','delete-security-group','write'),
    'DescribeVolumes': ('ec2','describe-volumes','read'),
    'GetRole': ('iam','get-role','read'),
    'GetInstanceProfile': ('iam','get-instance-profile','read'),
    'RemoveRoleFromInstanceProfile': ('iam','remove-role-from-instance-profile','write'),
    'DeleteInstanceProfile': ('iam','delete-instance-profile','write'),
    'DeleteRolePolicy': ('iam','delete-role-policy','write'),
    'DeleteRole': ('iam','delete-role','write'),
}

# Cleanup can inspect ownership and remove it, but cannot create resources or
# spend the protected reserve on source bodies. All source export uses work budget.
CLEANUP_OPERATIONS = frozenset({
    'GetCallerIdentity','ListBuckets','ListObjectVersions','GetBucketTagging',
    'GetBucketVersioning','DeleteVolume','DeleteObjects','DeleteBucket',
    'DescribeInstances','TerminateInstances','DescribeSecurityGroups',
    'DeleteSecurityGroup','DescribeVolumes','GetRole','GetInstanceProfile',
    'RemoveRoleFromInstanceProfile','DeleteInstanceProfile','DeleteRolePolicy','DeleteRole',
})


class CleanupCloud:
    def __init__(self, cloud):
        self.work = cloud.work if isinstance(cloud,CleanupCloud) else cloud

    def call(self, operation, params, **kwargs):
        require(operation in CLEANUP_OPERATIONS and not kwargs,'cleanup operation')
        return self.work.call(operation,params,cleanup=True)


def require(value, reason):
    if not value:
        raise StateError(reason)


def frozen_resources(value):
    """Exact run-owned identities; no wildcards, user resource names or profiles."""
    fields = {'schema','account','region','run_id','instance','security_group','volumes','buckets','role','profile','policy'}
    require(type(value) is dict and set(value)==fields,'resource fields')
    require(type(value['schema']) is int and value['schema']==1,'resource schema')
    require(isinstance(value['account'],str) and re.fullmatch('[0-9]{12}',value['account']),'account')
    require(value['region']=='ap-northeast-2','region')
    require(isinstance(value['run_id'],str) and re.fullmatch('[a-z0-9-]{1,30}',value['run_id']),'run id')
    prefix='server2-shadow-'+value['run_id']
    for key in ('role','profile','policy'):
        require(value[key]==prefix,'owned '+key)
    require(value['buckets']==[prefix+'-raw',prefix+'-state'],'owned buckets')
    for key,pattern in [('instance','i-[0-9a-f]{8,17}'),('security_group','sg-[0-9a-f]{8,17}')]:
        require(isinstance(value[key],str) and re.fullmatch(pattern,value[key]),'owned '+key)
    require(isinstance(value['volumes'],list) and len(value['volumes'])==1
            and isinstance(value['volumes'][0],str) and re.fullmatch('vol-[0-9a-f]{8,17}',value['volumes'][0]),'owned volume')
    return value


class Aws:
    """One physical CLI attempt; automatic retries/pagination are disabled.

    The coordinator must bind resources to the frozen launch receipt before
    constructing this transport. AWS identity is checked independently on open.
    Credentials are inherited by the CLI, never parsed or printed here.
    """
    def __init__(self, journal, resources, *, executable='/usr/local/bin/aws', profile=None, cleanup=False):
        self.journal=journal
        if type(resources) is dict and set(resources)=={'account','region','run_id'}:
            require(isinstance(resources['account'],str) and re.fullmatch('[0-9]{12}',resources['account']),'AWS account')
            require(resources['region']=='ap-northeast-2' and resources['run_id']==journal.snapshot()['run_id'],'AWS context')
            self.resources=dict(resources)
        else:self.resources=frozen_resources(resources)
        require(Path(executable).is_absolute() and Path(executable).is_file(),'AWS executable')
        require(profile is None or (isinstance(profile,str) and re.fullmatch('[A-Za-z0-9_-]{1,80}',profile)),'profile')
        self.executable=executable; self.profile=profile
        self.verified=False
        observed=self.call('GetCallerIdentity',{},cleanup=cleanup)
        require(observed.kind=='json' and observed.payload.get('Account')==resources['account'],'AWS account unverified')
        self.verified=True

    def call(self, operation, params, *, output=None, cleanup=False):
        require(operation in OPERATIONS,'unsupported AWS operation')
        require(type(cleanup) is bool and (not cleanup or operation in CLEANUP_OPERATIONS),'cleanup operation')
        require(self.verified or operation=='GetCallerIdentity','AWS identity required')
        require((operation=='GetObject')==(output is not None),'object output binding')
        request_json=canonical(params)
        service,command,kind=OPERATIONS[operation]
        envelope=8*1024**2 if operation in ('ListObjectVersions','DeleteObjects') else 64*1024
        self.journal.reserve_control(cleanup=cleanup,response_bytes=envelope,
                                     **({'reads':1} if kind=='read' else {'writes':1}))
        argv=[self.executable,'--no-cli-pager','--no-paginate','--output','json',
              '--region',self.resources['region'],'--cli-connect-timeout','5','--cli-read-timeout','20']
        if self.profile is not None: argv+=['--profile',self.profile]
        input_fd,input_name=tempfile.mkstemp(prefix='.aws-input-',suffix='.json',dir=self.journal.directory)
        try:
            with os.fdopen(input_fd,'w') as stream:
                stream.write(request_json);stream.flush();os.fsync(stream.fileno())
            argv += [service,command]
            if output is not None:
                # AWS CLI's customized get-object parser has no cli-input-json.
                # Exact argv values preserve the pinned identity and byte range.
                require({'Bucket','Key','VersionId'}<=set(params)<=
                        {'Bucket','Key','VersionId','Range'},'object request fields')
                for field,flag in [('Bucket','--bucket'),('Key','--key'),
                                   ('VersionId','--version-id'),('Range','--range')]:
                    if field in params:
                        require(type(params[field]) is str,'object request value')
                        argv += [flag,params[field]]
                argv.append(str(output))
            else:
                argv += ['--cli-input-json','file://'+str(Path(input_name).absolute())]
            environment=dict(os.environ, AWS_MAX_ATTEMPTS='1', AWS_RETRY_MODE='standard', AWS_PAGER='')
            completed=subprocess.run(argv,stdin=subprocess.DEVNULL,text=True,capture_output=True,
                                     env=environment,timeout=30,check=False)
        except subprocess.TimeoutExpired:
            return CloudResult('timeout',operation)
        except OSError:
            return CloudResult('command_error',operation)
        finally:
            Path(input_name).unlink(missing_ok=True)
        # Only small control envelopes are expected. Bodies go to a private file.
        if len(completed.stdout.encode())+len(completed.stderr.encode())>envelope:
            return CloudResult('malformed',operation)
        return decode_cloud(operation,completed.returncode,completed.stdout,completed.stderr)


def inventory(cloud, resources):
    """Independent exact-ID absence reads. Unknown is never converted to gone."""
    r=frozen_resources(resources)
    requests=[('instance','DescribeInstances',{'InstanceIds':[r['instance']]},r['instance']),
              ('security_group','DescribeSecurityGroups',{'Filters':[{'Name':'group-id','Values':[r['security_group']]}]},None),
              ('volumes','DescribeVolumes',{'Filters':[{'Name':'volume-id','Values':r['volumes']}]},None),
              ('role','GetRole',{'RoleName':r['role']},None),
              ('profile','GetInstanceProfile',{'InstanceProfileName':r['profile']},None)]
    result={}
    for key,operation,params,name in requests:
        answer=cloud.call(operation,params)
        result[key]={'gone':absence(answer,name=name),'kind':answer.kind,'code':answer.code}
    # ListBuckets may paginate; each explicit page must succeed and terminate.
    names=[]; token=None; seen=set(); kind='json'; code=None
    for _ in range(100):
        params={'MaxBuckets':1000}
        if token: params['ContinuationToken']=token
        answer=cloud.call('ListBuckets',params)
        kind,code=answer.kind,answer.code
        if kind!='json': break
        buckets=answer.payload.get('Buckets')
        if not isinstance(buckets,list) or not all(isinstance(b,dict) and isinstance(b.get('Name'),str) for b in buckets):
            kind='malformed'; break
        names.extend(buckets)
        token=answer.payload.get('ContinuationToken')
        if not token: break
        if not isinstance(token,str) or token in seen:
            kind='malformed'; break
        seen.add(token)
    else:
        kind='incomplete'
    whole=CloudResult(kind,'ListBuckets',{'Buckets':names},code)
    for bucket in r['buckets']:
        result[bucket]={'gone':kind=='json' and not token and absence(whole,name=bucket),'kind':kind,'code':code}
    return {'schema':1,'resources_sha256':hashlib.sha256(canonical(r).encode()).hexdigest(),
            'checks':result,'complete':all(v['gone'] for v in result.values())}


def versions(cloud,bucket):
    """Yield exact versions, including delete markers; reject incomplete pagination."""
    marker={}; seen=set()
    for _ in range(10000):
        answer=cloud.call('ListObjectVersions',{'Bucket':bucket,'MaxKeys':1000,**marker})
        require(answer.kind=='json','version listing unavailable')
        p=answer.payload
        require(type(p.get('IsTruncated')) is bool,'version listing shape')
        for field in ('Versions','DeleteMarkers'):
            items=p.get(field,[])
            require(isinstance(items,list),'version items')
            for item in items:
                require(isinstance(item,dict) and isinstance(item.get('Key'),str)
                        and 0<len(item['Key'].encode())<=1024
                        and isinstance(item.get('VersionId'),str) and 0<len(item['VersionId'].encode())<=1024,'version identity')
                if field=='Versions':
                    require(type(item.get('Size')) is int and 0<=item['Size']<=2*1024**3,'version size')
                yield dict(item,DeleteMarker=field=='DeleteMarkers')
        if not p['IsTruncated']: return
        key,version=p.get('NextKeyMarker'),p.get('NextVersionIdMarker')
        require(isinstance(key,str) and isinstance(version,str),'version continuation')
        token=(key,version)
        require(token not in seen,'version continuation repeated')
        seen.add(token); marker={'KeyMarker':key,'VersionIdMarker':version}
    raise StateError('version pagination exhausted')


def source_headers(payload, key, digest):
    """Retain the bounded original AWS representation, including raw-codec metadata.

    This is an evidence validation limit after receipt, not a wire byte cap.
    Canonical raw decoding remains the existing Rust codec's responsibility.
    """
    require(type(payload) is dict and len(canonical(payload).encode())<=64*1024,'source headers limit')
    metadata=payload.get('Metadata');stamp=payload.get('LastModified')
    require(type(metadata) is dict and all(type(k) is str and type(v) is str for k,v in metadata.items()),
            'source metadata missing')
    require(sum(len(k.encode())+len(v.encode()) for k,v in metadata.items())<=2048,'source metadata limit')
    require(type(stamp) is str and 0<len(stamp)<=64,'source timestamp missing')
    try:
        require(datetime.datetime.fromisoformat(stamp.replace('Z','+00:00')).utcoffset() is not None,
                'source timestamp timezone')
        if key.startswith('raw/v2/'):
            require(set(metadata)=={'s2-record','s2-gzip-sha256'},'raw metadata fields')
            require(metadata['s2-gzip-sha256']==digest,'raw compressed hash')
            encoded=metadata['s2-record']
            require(len(encoded)<=1900,'raw envelope limit')
            envelope=json.loads(base64.b64decode(encoded,validate=True))
            require(envelope['schema']==2,'raw envelope schema')
            identity=envelope['identity'];period=identity['period'];date=period['local_date']
            require(type(date) is int and type(identity['fetched_at_ms']) is int,'raw identity types')
            expected=(f"raw/v2/{identity['source']}/{identity['kind']}/{date//10000:04}/"
                      f"{date//100%100:02}/{date%100:02}/{period['slot']}/{identity['key_sha256']}/"
                      f"{identity['fetched_at_ms']}-{identity['raw_sha256']}.raw.gz")
            require(expected==key,'raw envelope/key disagreement')
    except (ValueError,KeyError,TypeError,UnicodeError) as error:
        raise StateError('invalid original source metadata') from error
    return payload


def export_sources(cloud,journal,resources,destination):
    """Retain original version bytes, never reconstruction; no dependency-closure claim.

    Exclusive destination prevents a failed export from being overwritten. A
    partial manifest remains evidence with complete=false. Every attempt is charged.
    """
    r=frozen_resources(resources); destination=Path(destination)
    destination.mkdir(mode=0o700)
    manifest={'schema':2,'complete':False,'dependency_closure':'unproven','objects':[]}
    def persist():
        fd,temporary=tempfile.mkstemp(prefix='.manifest-',dir=destination)
        try:
            with os.fdopen(fd,'w') as stream:
                stream.write(canonical(manifest)+'\n'); stream.flush(); os.fsync(stream.fileno())
            os.replace(temporary,destination/'manifest.json');sync_directory(destination)
        finally:
            if os.path.exists(temporary):os.unlink(temporary)
    persist()
    try:
        for bucket in r['buckets']:
            for item in versions(cloud,bucket):
                if item['DeleteMarker']: continue
                identity={'bucket':bucket,'key':item['Key'],'version':item['VersionId']}
                filename=hashlib.sha256(canonical(identity).encode()).hexdigest()+'.body'
                path=destination/filename
                require(not path.exists(),'duplicate source version')
                journal.reserve_control(export_bytes=item['Size'])
                # Precreate private output. GetObject is explicitly pinned to VersionId.
                fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600);os.close(fd)
                params={'Bucket':bucket,'Key':item['Key'],'VersionId':item['VersionId']}
                if item['Size']:
                    # Bound the physical body to its prepaid extent. An explicit
                    # range must cover the entire original, not a prefix.
                    params['Range']=f"bytes=0-{item['Size']-1}"
                    answer=cloud.call('GetObject',params,output=path)
                    require(answer.kind=='json' and answer.payload.get('ContentRange')==
                            f"bytes 0-{item['Size']-1}/{item['Size']}",'source full extent')
                else:
                    # HEAD proves an empty original without an unbounded GET.
                    answer=cloud.call('HeadObject',params)
                require(answer.kind=='json' and answer.payload.get('VersionId')==item['VersionId']
                        and answer.payload.get('ContentLength')==item['Size'],'source response identity')
                require(path.stat().st_size==item['Size'],'source byte count')
                digest=hashlib.sha256()
                with path.open('rb') as stream:
                    for block in iter(lambda:stream.read(1024**2),b''): digest.update(block)
                    os.fsync(stream.fileno())
                headers=source_headers(answer.payload,item['Key'],digest.hexdigest())
                manifest['objects'].append(dict(identity,size=item['Size'],sha256=digest.hexdigest(),
                                               file=filename,headers=headers))
                persist()
        manifest['complete']=True;persist()
    except Exception:
        persist();raise
    return manifest


def delete_versions(cloud,bucket):
    """Exact version deletes after acquisition stops; inspect per-object errors."""
    # Restart the listing after each bounded deletion batch, never continue a
    # marker through a mutated collection. Acquisition must already be stopped.
    previous=None; total=0
    for _ in range(10000):
        batch=[{'Key':i['Key'],'VersionId':i['VersionId']}
               for i in itertools.islice(versions(cloud,bucket),1000)]
        if not batch:return total
        fingerprint=hashlib.sha256(canonical(batch).encode()).hexdigest()
        require(fingerprint!=previous,'cleanup made no progress')
        previous=fingerprint
        answer=cloud.call('DeleteObjects',{'Bucket':bucket,'Delete':{'Objects':batch,'Quiet':False}})
        require(answer.kind=='json' and not answer.payload.get('Errors'),'version deletion unavailable')
        deleted=answer.payload.get('Deleted')
        require(isinstance(deleted,list) and len(deleted)==len(batch),'version deletion incomplete')
        expected={(item['Key'],item['VersionId']) for item in batch}
        require(all(isinstance(i,dict) and (i.get('Key'),i.get('VersionId')) in expected for i in deleted)
                and len({(i['Key'],i['VersionId']) for i in deleted})==len(expected),'version deletion mismatch')
        total+=len(batch)
    raise StateError('cleanup pagination exhausted')


def resource_digest(resources):
    return hashlib.sha256(canonical(frozen_resources(resources)).encode()).hexdigest()


def has_run_tag(tags,run_id):
    return (isinstance(tags,list) and sum(1 for t in tags if isinstance(t,dict)
            and t.get('Key')=='ShadowRunId' and t.get('Value')==run_id)==1
            and sum(1 for t in tags if isinstance(t,dict) and t.get('Key')=='ShadowRunId')==1)


def dispatch_recorded(cloud,journal,intent,operation,params,token,*,now):
    """One durable exact request followed by one physical call and one receipt.

    If the process dies anywhere after preparing, this function cannot dispatch
    it again. Operation-specific reconciliation consumes the retained request.
    Exceptions leave a prepared uncertain request, not a reusable permission.
    """
    journal.prepare_request(intent,operation,params,token,now=now)
    answer=cloud.call(operation,params)
    journal.record_receipt(intent,answer)
    return answer


def creation_receipts(journal,r):
    """Successful named-resource creation, not an intent or a matching tag."""
    for key,operation,expected in [('bucket-raw','CreateBucket',r['buckets'][0]),
            ('bucket-state','CreateBucket',r['buckets'][1]),('role','CreateRole',r['role']),
            ('profile','CreateInstanceProfile',r['profile']),('security-group','CreateSecurityGroup',r['security_group'])]:
        request=journal.request(key)
        require(request is not None and request['operation']==operation,'creation request missing')
        receipt=request['receipt']
        require(receipt is not None and receipt['kind']=='json' and receipt['operation']==operation,
                'successful creation receipt required')
        params=request['params'];payload=receipt['payload']
        if operation=='CreateBucket':
            require(params.get('Bucket')==expected and
                    params.get('CreateBucketConfiguration')=={'LocationConstraint':'ap-northeast-2'},'created bucket binding')
        elif operation=='CreateSecurityGroup':
            require(params.get('GroupName')=='server2-shadow-'+r['run_id']
                    and payload.get('GroupId')==expected,'created security group binding')
        else:
            field='Role' if key=='role' else 'InstanceProfile';name=field+'Name'
            require(params.get(name)==expected and type(payload.get(field)) is dict
                    and payload[field].get(name)==expected,'created IAM binding')


def bind_resources(cloud,journal,resources,*,now):
    """Bind exact IDs only after a prepared launch token and ownership readbacks.

    Exact successful creation receipts are required for non-idempotent named
    resources. An uncertain instance launch is reconciled by its original token.
    This function never repeats a launch or adopts a resource based only on tags.
    """
    r=frozen_resources(resources)
    require(journal.snapshot()['run_id']==r['run_id'],'resource run mismatch')
    prior=journal.mutation('owned-resources')
    if prior:
        require(prior=={'operation':'BindResources','params_sha':resource_digest(r),'token':r['instance']},'resource rebinding forbidden')
        return
    creation_receipts(journal,r)
    intent=journal.request('launch')
    require(intent is not None and intent['operation']=='RunInstances','prepared launch required')
    params=intent['params']
    require(params.get('ClientToken')==intent['token'] and params.get('MinCount')==1 and params.get('MaxCount')==1
            and params.get('InstanceType')=='t3.small','single launch request required')
    receipt=intent['receipt']
    require(receipt is None or receipt['kind'] in ('json','timeout','command_error','malformed'),
            'rejected launch cannot be adopted')
    answer=cloud.call('DescribeInstances',{'Filters':[{'Name':'client-token','Values':[intent['token']]}]})
    require(answer.kind=='json','launch reconciliation unavailable')
    reservations=answer.payload.get('Reservations')
    require(isinstance(reservations,list) and all(isinstance(x,dict) and isinstance(x.get('Instances'),list) for x in reservations),'launch reconciliation shape')
    instances=[i for x in reservations for i in x['Instances']]
    require(len(instances)==1 and isinstance(instances[0],dict),'exactly one launched instance required')
    instance=instances[0]
    require(instance.get('InstanceId')==r['instance'] and instance.get('ClientToken')==intent['token']
            and has_run_tag(instance.get('Tags'),r['run_id']),'launched instance ownership')
    subnet=params.get('SubnetId')
    if 'NetworkInterfaces' in params:
        interfaces=params['NetworkInterfaces']
        require(isinstance(interfaces,list) and len(interfaces)==1 and isinstance(interfaces[0],dict),'launch network shape')
        subnet=interfaces[0].get('SubnetId')
    require(instance.get('InstanceType')=='t3.small' and isinstance(params.get('ImageId'),str)
            and instance.get('ImageId')==params['ImageId'] and isinstance(subnet,str)
            and instance.get('SubnetId')==subnet,'instance launch binding')
    if receipt is not None and receipt['kind']=='json':
        created=receipt['payload'].get('Instances')
        require(isinstance(created,list) and len(created)==1 and isinstance(created[0],dict)
                and created[0].get('InstanceId')==r['instance'],'instance receipt binding')
    require(instance.get('SecurityGroups')==[{'GroupId':r['security_group'],'GroupName':'server2-shadow-'+r['run_id']}],'security group binding')
    mappings=instance.get('BlockDeviceMappings')
    require(isinstance(mappings,list) and len(mappings)==1 and mappings[0].get('Ebs',{}).get('VolumeId')==r['volumes'][0]
            and mappings[0]['Ebs'].get('DeleteOnTermination') is True,'volume binding')
    for bucket in r['buckets']:
        answer=cloud.call('GetBucketTagging',{'Bucket':bucket})
        require(answer.kind=='json' and has_run_tag(answer.payload.get('TagSet'),r['run_id']),'bucket ownership')
        version=cloud.call('GetBucketVersioning',{'Bucket':bucket})
        require(version.kind=='json' and version.payload.get('Status')=='Enabled','original versions required')
    for operation,params,field in [('GetRole',{'RoleName':r['role']},'Role'),
                                   ('GetInstanceProfile',{'InstanceProfileName':r['profile']},'InstanceProfile')]:
        answer=cloud.call(operation,params)
        obj=answer.payload.get(field) if answer.kind=='json' else None
        require(isinstance(obj,dict) and has_run_tag(obj.get('Tags'),r['run_id'])
                and isinstance(obj.get('Arn'),str) and obj['Arn'].startswith('arn:aws:iam::'+r['account']+':'),'IAM ownership')
    groups=cloud.call('DescribeSecurityGroups',{'GroupIds':[r['security_group']]})
    require(groups.kind=='json' and len(groups.payload.get('SecurityGroups',[]))==1
            and has_run_tag(groups.payload['SecurityGroups'][0].get('Tags'),r['run_id']),'group ownership')
    volumes=cloud.call('DescribeVolumes',{'VolumeIds':r['volumes']})
    require(volumes.kind=='json' and len(volumes.payload.get('Volumes',[]))==1,'volume ownership unavailable')
    volume=volumes.payload['Volumes'][0]
    require(volume.get('VolumeId')==r['volumes'][0] and volume.get('Size')==32
            and volume.get('VolumeType')=='gp3' and volume.get('Encrypted') is True
            and has_run_tag(volume.get('Tags'),r['run_id']),'volume ownership')
    journal.observe(now)
    journal.record_cleanup_ownership(resource_digest(r),r['instance'],resources=r)


def cleanup(cloud,journal,resources,*,source_destination=None):
    """Terminate exact bound instance, export stopped sources, delete owned state.

    The caller retains host-local paired evidence before this operation when
    possible. Unknown local evidence or failed source export never earns PASS.
    Every attempted deletion is followed by independent absence inventories.
    """
    cloud=CleanupCloud(cloud)
    r=frozen_resources(resources)
    require(journal.mutation('owned-resources')=={'operation':'BindResources',
            'params_sha':resource_digest(r),'token':r['instance']},'cleanup requires bound resources')
    actions=[]
    def call(operation,params):
        answer=cloud.call(operation,params)
        actions.append({'operation':operation,'kind':answer.kind,'code':answer.code})
        return answer
    call('TerminateInstances',{'InstanceIds':[r['instance']]})
    stopped=call('DescribeInstances',{'InstanceIds':[r['instance']]})
    if not absence(stopped,name=r['instance']):
        return {'schema':1,'resources_gone':False,'pending':'termination_unconfirmed','actions':actions}
    sources=None
    if source_destination is not None:
        try:sources=export_sources(cloud.work,journal,r,source_destination)['complete']
        except (StateError,OSError,ValueError):sources=False
    for bucket in r['buckets']:
        try:delete_versions(cloud,bucket)
        except (StateError,OSError,ValueError):
            actions.append({'operation':'DeleteObjects','kind':'incomplete','code':None})
        call('DeleteBucket',{'Bucket':bucket})
    call('RemoveRoleFromInstanceProfile',{'InstanceProfileName':r['profile'],'RoleName':r['role']})
    call('DeleteInstanceProfile',{'InstanceProfileName':r['profile']})
    call('DeleteRolePolicy',{'RoleName':r['role'],'PolicyName':r['policy']})
    call('DeleteRole',{'RoleName':r['role']})
    call('DeleteSecurityGroup',{'GroupId':r['security_group']})
    # A root volume should be deleted with its instance. Delete only the one
    # bound volume if AWS successfully reports it detached and available.
    answer=call('DescribeVolumes',{'Filters':[{'Name':'volume-id','Values':r['volumes']}]})
    if answer.kind=='json':
        volumes=answer.payload.get('Volumes')
        if isinstance(volumes,list) and len(volumes)==1:
            volume=volumes[0]
            if (isinstance(volume,dict) and volume.get('VolumeId')==r['volumes'][0]
                    and volume.get('State')=='available' and volume.get('Attachments')==[]):
                call('DeleteVolume',{'VolumeId':r['volumes'][0]})
    proof=inventory(cloud,r)
    return {'schema':1,'resources_gone':proof['complete'],'sources_complete':sources,
            'qualification':'not_assessed','actions':actions,'independent_inventory':proof}


HOST_ARTIFACTS={'server2','paired_read.py','guard.py','coordinator.py','state.py','bootstrap.sh','reader.json','config.env'}


def host_plan(plan):
    fields={'schema','run_id','source_commit','port','interface','artifacts','cost_policy','paid_policy','native_families'}
    require(type(plan) is dict and set(plan)==fields,'host plan fields')
    require(type(plan['schema']) is int and plan['schema']==4,'host schema')
    families=plan['native_families']
    require(type(families) is list and all(type(f) is str for f in families)
            and len(families)==len(set(families))
            and set(families)<={'geocode','notice','dsf','kma','kma-v000901','kma-v000902','town'},
            'native read families only')
    require(isinstance(plan['run_id'],str) and re.fullmatch('[a-z0-9-]{1,30}',plan['run_id']),'host run id')
    require(isinstance(plan['source_commit'],str) and re.fullmatch('[0-9a-f]{40}',plan['source_commit']),'source commit')
    require(type(plan['port']) is int and 1024<=plan['port']<=65534,'host port')
    require(isinstance(plan['interface'],str) and re.fullmatch('[A-Za-z0-9_-]{1,15}',plan['interface']),'host interface')
    require(type(plan['artifacts']) is dict and set(plan['artifacts'])==HOST_ARTIFACTS,'host artifacts')
    require(all(isinstance(v,str) and re.fullmatch('[0-9a-f]{64}',v) for v in plan['artifacts'].values()),'artifact hash')
    return plan


def launch_plan(launch):
    require(type(launch) is dict and set(launch)=={'plan','epoch','generation','allowance'},'launch fields')
    host_plan(launch['plan'])
    require(type(launch['epoch']) is int and 0<=launch['epoch']<=253402300799-170*3600,'launch epoch')
    validate_cost_policy(launch['plan']['cost_policy'],launch['epoch'])
    validate_paid_policy(launch['plan']['paid_policy'],launch['epoch'])
    require(launch['generation'] in ('initial','restart-1','restart-2'),'launch generation')
    require(type(launch['allowance']) is dict and set(launch['allowance'])==set(Journal.CAPS),'launch allowance')
    for name,cap in Journal.CAPS.items():
        value=launch['allowance'][name]
        require(type(value) is int and 0<value<=cap,'launch allocation')
    return launch


def artifact_hash(path):
    h=hashlib.sha256();size=0
    with Path(path).open('rb') as stream:
        while data:=stream.read(1024**2):
            size+=len(data);require(size<=256*1024**2,'artifact size');h.update(data)
    return h.hexdigest()


def prepare_generation(journal,plan,source,destination,generation,allowance,*,now):
    """Consume one grant before writing its exclusive, private host bundle."""
    host_plan(plan)
    pinned=hashlib.sha256(canonical(plan).encode()).hexdigest()
    current=journal.active(now)
    require(current['manifest_sha']==pinned and current['run_id']==plan['run_id'],'journal plan binding')
    require(generation==('initial','restart-1','restart-2')[current['generations']]
            if current['generations']<3 else False,'generation sequence')
    launch=launch_plan(dict(plan=plan,epoch=current['epoch'],generation=generation,allowance=allowance))
    source=Path(source);destination=Path(destination)
    require(not destination.exists() and not destination.is_symlink(),'bundle already exists')
    for name,expected in plan['artifacts'].items():
        path=source/name
        require(not path.is_symlink() and path.is_file() and artifact_hash(path)==expected,'source artifact binding')
    journal.reserve_generation(generation,allowance,now=now)
    destination.mkdir(mode=0o700)
    for name,expected in plan['artifacts'].items():
        fd=os.open(destination/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o700 if name=='server2' else 0o600)
        with os.fdopen(fd,'wb') as output,(source/name).open('rb') as input:
            for block in iter(lambda:input.read(1024**2),b''):output.write(block)
            output.flush();os.fsync(output.fileno())
        require(artifact_hash(destination/name)==expected,'copied artifact binding')
    fd=os.open(destination/'launch.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as stream:
        stream.write(canonical(launch)+'\n');stream.flush();os.fsync(stream.fileno())
    sync_directory(destination);sync_directory(destination.parent)
    return launch


def verify_bundle(path):
    path=Path(path)
    require(path.is_dir() and not path.is_symlink(),'bundle directory')
    launch_path=path/'launch.json'
    require(launch_path.is_file() and not launch_path.is_symlink() and launch_path.stat().st_size<=65536,'launch file')
    launch=launch_plan(json.loads(launch_path.read_text()))
    for name,expected in launch['plan']['artifacts'].items():
        artifact=path/name
        require(artifact.is_file() and not artifact.is_symlink()
                and artifact_hash(artifact)==expected,'bundle artifact binding')
    require((path/'config.env').stat().st_mode&0o077==0,'private configuration')
    return launch


def candidate_environment(launch):
    launch_plan(launch)
    a=launch['allowance']
    paid=launch['plan']['paid_policy']['grants'][launch['generation']]
    return {'PATH':'/usr/bin:/bin','PORT':str(launch['plan']['port']),
            'OPENSHIFT_NODEJS_IP':'127.0.0.1',
            'AWS_ACCESS_KEY':'','AWS_SECRET_KEY':'',
            'SERVER2_S3_BUCKET':'server2-shadow-'+launch['plan']['run_id']+'-raw',
            'SERVER2_S3_REGION':'ap-northeast-2',
            'SERVER2_NATIVE_FAMILIES':','.join(launch['plan']['native_families']),
            'SERVER2_GATEWAY_LEGACY_URL':'http://127.0.0.1:9',
            'SERVER2_SHADOW_S3_LIMITS':','.join(str(a[k]) for k in ('reads','writes','put_bytes')),
            'SERVER2_SHADOW_PROVIDER_UNITS':','.join(str(paid[k]) for k in PAID_PROVIDERS)}


def host_units(launch):
    """Render scoped units without touching systemd or starting a process.

    Collection stops at the original epoch, independently of the guard. The
    poweroff timer additionally requires launch-time EC2 shutdown=terminate.
    It cannot prove cloud cleanup; exact inventories remain mandatory.
    """
    import datetime
    launch_plan(launch)
    plan=launch['plan'];name='server2-shadow-'+plan['run_id'];root='/opt/server2-shadow/'+plan['run_id']
    coordinator=f'/usr/bin/python3 {root}/bin/coordinator.py'
    common='Restart=no\nTimeoutStopSec=10\nKillMode=control-group\nNoNewPrivileges=yes\n'
    candidate=f'''[Unit]
Description=Owned shadow candidate {plan['run_id']}
[Service]
Type=exec
WorkingDirectory={root}/config
ExecStart={coordinator} exec-candidate --launch {root}/launch.json
ExecStartPost={coordinator} bind-host --launch {root}/launch.json
ExecStopPost=/usr/bin/systemctl --no-block stop {name}-reader.service {name}-guard.service
{common}'''
    guardian=f'''[Unit]
Description=Owned shadow guard {plan['run_id']}
[Service]
Type=exec
ExecStart=/usr/bin/python3 {root}/bin/guard.py run --manifest {root}/state/guard.json --state {root}/state/decision.json
ExecStopPost=/usr/bin/systemctl --no-block stop {name}-reader.service {name}-candidate.service
WatchdogSec=30
WatchdogSignal=SIGKILL
NotifyAccess=main
{common}'''
    reader=f'''[Unit]
Description=Owned paired reader {plan['run_id']}
BindsTo={name}-guard.service {name}-candidate.service
After={name}-guard.service {name}-candidate.service
[Service]
Type=exec
ExecStart=/usr/bin/python3 {root}/bin/paired_read.py --manifest {root}/reader.json --candidate http://127.0.0.1:{plan['port']} --candidate-binary {root}/bin/server2 --state {root}/data/paired --execute
{common}'''
    stop=f'''[Unit]
Description=Original collection deadline {plan['run_id']}
[Service]
Type=oneshot
ExecStart=/usr/bin/systemctl --no-block stop {name}-reader.service {name}-candidate.service {name}-guard.service
'''
    off=f'''[Unit]
Description=Original host deadline {plan['run_id']}
[Service]
Type=oneshot
ExecStart=/usr/bin/systemctl poweroff
'''
    def timer(hours,service):
        when=datetime.datetime.fromtimestamp(launch['epoch']+hours*3600,datetime.timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')
        return f'[Unit]\nDescription=Immutable shadow deadline\n[Timer]\nOnCalendar={when}\nAccuracySec=1s\nPersistent=true\nUnit={name}-{service}.service\n[Install]\nWantedBy=timers.target\n'
    return {name+'-candidate.service':candidate,name+'-guard.service':guardian,name+'-reader.service':reader,
            name+'-stop.service':stop,name+'-stop.timer':timer(168,'stop'),
            name+'-poweroff.service':off,name+'-poweroff.timer':timer(170,'poweroff')}


def host_context(path):
    import time
    import guard
    require(sys.platform=='linux' and os.geteuid()==0,'Linux root host required')
    path=Path(path)
    launch=launch_plan(guard.read_json(path));root=Path('/opt/server2-shadow')/launch['plan']['run_id']
    require(path==root/'launch.json' and not path.is_symlink(),'launch path binding')
    st=path.stat();require(st.st_uid==0 and st.st_mode&0o077==0,'private launch manifest')
    require(launch['epoch']<=int(time.time())<launch['epoch']+168*3600,'original host deadline')
    for name,expected in launch['plan']['artifacts'].items():
        actual=root/'config/.env' if name=='config.env' else root/'reader.json' if name=='reader.json' else root/'bin'/name
        st=actual.stat()
        require(not actual.is_symlink() and st.st_uid==0 and st.st_mode&0o022==0,'artifact ownership')
        require(artifact_hash(actual)==expected,'installed artifact binding')
    return launch,root


def exec_candidate(path):
    """Called only by the owned unit; no ambient variables override pinned config."""
    import time
    import guard
    launch,root=host_context(path)
    # The initial host connector deliberately exposes no restart command. A new
    # generation requires a separately verified reader pause/rebind path.
    require(launch['generation']=='initial','host restart connector unavailable')
    state_dir=root/'state';state_dir.mkdir(mode=0o700,exist_ok=True)
    marker=state_dir/('used-'+launch['generation'])
    fd=os.open(marker,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as stream:
        stream.write(canonical({'launch_sha256':artifact_hash(path),'used_at':int(time.time())})+'\n')
        stream.flush();os.fsync(stream.fileno())
    sync_directory(state_dir)
    os.chdir(root/'config')
    os.execve(root/'bin/server2',[str(root/'bin/server2')],candidate_environment(launch))


def bind_host(path):
    """Check actual Linux identity before starting the guard; does not start reads."""
    import time
    import guard
    launch,root=host_context(path);plan=launch['plan'];name='server2-shadow-'+plan['run_id']
    response=subprocess.run(['/usr/bin/systemctl','show','--property=MainPID','--value',name+'-candidate.service'],
                            capture_output=True,text=True,timeout=5,check=False)
    require(response.returncode==0 and response.stdout.strip().isdigit(),'candidate unit PID')
    pid=int(response.stdout.strip());require(pid>=2,'candidate not running')
    environment=candidate_environment(launch)
    manifest=dict(schema=2,run_id=plan['run_id'],generation=launch['generation'],epoch=launch['epoch'],pid=pid,
        start_ticks=guard.process_stat((Path('/proc')/str(pid)/'stat').read_text()),
        boot_id=Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
        binary_sha256=plan['artifacts']['server2'],
        environment_sha256=guard.environment_hash(b''.join((k+'='+v).encode()+b'\0' for k,v in environment.items())),
        config_sha256=plan['artifacts']['config.env'],config_directory=str(root/'config'),
        port=plan['port'],metrics_port=plan['port']+1,tx_origin=0,interface=plan['interface'],
        data_directory=str(root/'data'),cgroup='/system.slice/'+name+'-candidate.service',allowance=launch['allowance'],cost_policy=plan['cost_policy'])
    guard.validate(manifest)
    deadline=time.monotonic()+20
    while True:
        try:
            sample=guard.collect(manifest)
            decision=guard.evaluate(manifest,sample,None,int(time.time()))
            require(decision['stop'] is None,'initial host binding rejected')
            break
        except (OSError,ValueError):
            if time.monotonic()>=deadline:raise StateError('initial host binding unavailable') from None
            time.sleep(.25)
    require(not (root/'state/guard.json').exists() and not (root/'state/decision.json').exists(),'existing host binding')
    guard.save(root/'state/guard.json',manifest);guard.save(root/'state/decision.json',decision)
    result=subprocess.run(['/usr/bin/systemctl','start',name+'-guard.service'],timeout=10,check=False,
                          stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    require(result.returncode==0,'guard start failed')


class HostSystem:
    """Fixed systemctl argv, bounded wait, no shell or output in failure logs."""
    def run(self, *args):
        answer=subprocess.run(['/usr/bin/systemctl',*args],capture_output=True,text=True,
                              timeout=90,check=False,stdin=subprocess.DEVNULL)
        # `show LoadState` of a missing unit can return a nonzero status.
        missing=args[:2]==('show','--property=LoadState') and answer.stdout.strip()=='not-found'
        require(answer.returncode==0 or missing,'systemd operation failed')
        return answer.stdout.strip()


def exclusive_copy(source,destination,mode):
    """Copy a bounded, non-symlink artifact into an exclusively created file."""
    import stat
    incoming=os.open(source,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        require(stat.S_ISREG(os.fstat(incoming).st_mode),'regular artifact required')
        outgoing=os.open(destination,os.O_WRONLY|os.O_CREAT|os.O_EXCL,mode)
        with os.fdopen(outgoing,'wb') as output:
            total=0
            while block:=os.read(incoming,1024**2):
                total+=len(block);require(total<=256*1024**2,'artifact size')
                output.write(block)
            output.flush();os.fsync(output.fileno())
    finally:os.close(incoming)


def check_reader_binding(path,launch):
    require(path.stat().st_size<=65536,'reader manifest size')
    reader=json.loads(path.read_text())
    require(type(reader) is dict and reader.get('candidate_sha256')==launch['plan']['artifacts']['server2'],
            'reader executable binding')
    for key,limit in [('duration_seconds',168*3600),('max_attempts',6000),('min_spacing_seconds',168*3600)]:
        require(type(reader.get(key)) is int and 0<reader[key]<=limit,'reader bounds')
    # The paired reader validates its fixed method/path inventory before opening
    # its ledger or sending. The independent host timer shortens a delayed start.


def verify_launch_expiry(run_id, epoch, unit_dir, system):
    for unit,content in launch_expiry_units(run_id,epoch).items():
        path=Path(unit_dir)/unit
        require(not path.is_symlink() and path.is_file() and path.read_text()==content,'launch expiry missing or changed')
        if unit.endswith('.timer'):
            require(system.run('is-enabled',unit)=='enabled','launch expiry not enabled')
            require(system.run('show','--property=ActiveState','--value',unit)=='active','launch expiry inactive')


def install_host_tree(bundle,root,unit_dir,system,*,now):
    """Initial-only installation transaction; caller supplies the fixed host paths.

    This helper permits a private test filesystem and systemd fixture. The live
    wrapper accepts neither a destination nor a clock override. A partial tree is
    a consumed installation, never a retry target. Failures retain it for audit.
    """
    bundle=Path(bundle);root=Path(root);unit_dir=Path(unit_dir)
    launch=verify_bundle(bundle);name='server2-shadow-'+launch['plan']['run_id']
    require(launch['generation']=='initial','host restart connector unavailable')
    require(type(now) is int and launch['epoch']<=now<launch['epoch']+168*3600,'original install deadline')
    require(not root.exists() and not root.is_symlink(),'existing installation')
    verify_launch_expiry(launch['plan']['run_id'],launch['epoch'],unit_dir,system)
    check_reader_binding(bundle/'reader.json',launch)
    units=host_units(launch)
    require(not unit_dir.is_symlink(),'unit directory symlink')
    for unit in units:
        require(not (unit_dir/unit).exists() and not (unit_dir/unit).is_symlink(),'existing unit file')
        require(system.run('show','--property=LoadState','--value',unit)=='not-found','existing loaded unit')
    root.mkdir(mode=0o700)
    sync_directory(root.parent)
    for directory in ('bin','config','data','state'):(root/directory).mkdir(mode=0o700)
    frozen_launch=(canonical(launch)+'\n').encode()
    status=dict(schema=1,status='installing',launch_sha256=hashlib.sha256(frozen_launch).hexdigest(),
                epoch=launch['epoch'],collection_until=launch['epoch']+168*3600,
                cleanup_until=launch['epoch']+170*3600)
    import guard
    guard.save(root/'state/install.json',status)
    try:
        for artifact,expected in launch['plan']['artifacts'].items():
            destination=root/'config/.env' if artifact=='config.env' else root/'reader.json' if artifact=='reader.json' else root/'bin'/artifact
            exclusive_copy(bundle/artifact,destination,0o700 if artifact=='server2' else 0o600)
            require(artifact_hash(destination)==expected,'installation changed artifact')
        fd=os.open(root/'launch.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'wb') as stream:
            stream.write(frozen_launch);stream.flush();os.fsync(stream.fileno())
        require(artifact_hash(root/'launch.json')==status['launch_sha256'],'installation changed manifest')
        for directory in ('bin','config','data','state'):sync_directory(root/directory)
        sync_directory(root)
        unit_dir.mkdir(mode=0o755,exist_ok=True)
        for unit,content in units.items():
            fd=os.open(unit_dir/unit,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o644)
            with os.fdopen(fd,'w') as stream:
                stream.write(content);stream.flush();os.fsync(stream.fileno())
        sync_directory(unit_dir)
        system.run('daemon-reload')
        system.run('enable',name+'-stop.timer',name+'-poweroff.timer')
        system.run('start',name+'-stop.timer',name+'-poweroff.timer')
        for suffix in ('stop.timer','poweroff.timer'):
            require(system.run('show','--property=ActiveState','--value',name+'-'+suffix)=='active','deadline timer inactive')
        system.run('start',name+'-candidate.service')
        for suffix in ('candidate','guard'):
            require(system.run('show','--property=ActiveState','--value',name+'-'+suffix+'.service')=='active','candidate binding unavailable')
        system.run('start',name+'-reader.service')
        require(system.run('show','--property=ActiveState','--value',name+'-reader.service')=='active','reader inactive')
        status['status']='started'
        guard.save(root/'state/install.json',status)
        return status
    except BaseException:
        # Timers remain installed/running. Never stop the immutable poweroff
        # safety net merely because installation or evidence saving failed.
        status['status']='failed'
        try:system.run('stop',name+'-reader.service',name+'-candidate.service',name+'-guard.service')
        except (StateError,OSError,subprocess.TimeoutExpired):status['stop_unconfirmed']=True
        guard.save(root/'state/install.json',status)
        raise


def install_host(bundle):
    """Actual Linux/root install. Cloud provisioning remains a separate gate."""
    import time
    require(sys.platform=='linux' and os.geteuid()==0,'Linux root host required')
    bundle=Path(bundle);launch=verify_bundle(bundle)
    # All parent directories and inputs are administrator-owned, non-writable
    # by group/other. No path or clock overrides are accepted by this command.
    for path in (bundle,*bundle.parents):
        st=path.lstat()
        require(not path.is_symlink() and st.st_uid==0 and st.st_mode&0o022==0,'unsafe bundle parent')
    for path in bundle.iterdir():
        st=path.lstat()
        require(not path.is_symlink() and st.st_uid==0 and st.st_mode&0o077==0,'private owned bundle')
    for parent in (Path('/opt'),Path('/etc/systemd/system')):
        for path in (parent,*parent.parents):
            st=path.lstat()
            require(not path.is_symlink() and st.st_uid==0 and st.st_mode&0o022==0,'unsafe install parent')
    parent=Path('/opt/server2-shadow')
    if not parent.exists():parent.mkdir(mode=0o700);sync_directory(parent.parent)
    st=parent.lstat()
    require(not parent.is_symlink() and st.st_uid==0 and st.st_mode&0o077==0,'private install parent')
    return install_host_tree(bundle,parent/launch['plan']['run_id'],Path('/etc/systemd/system'),
                             HostSystem(),now=int(time.time()))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=['audit-absence','render-host','exec-candidate','bind-host','install-host'])
    parser.add_argument('--resources',type=Path)
    parser.add_argument('--launch',type=Path)
    parser.add_argument('--bundle',type=Path)
    parser.add_argument('--output',type=Path)
    parser.add_argument('--evidence',type=Path)
    args=parser.parse_args()
    try:
        if args.command=='install-host':
            require(args.bundle is not None,'bundle required')
            print(canonical(install_host(args.bundle)));return 0
        if args.command in ('exec-candidate','bind-host'):
            require(args.launch is not None,'launch required')
            (exec_candidate if args.command=='exec-candidate' else bind_host)(args.launch)
            return 0
        if args.command=='render-host':
            require(args.launch is not None and args.output is not None,'launch and output required')
            require(args.launch.name=='launch.json','launch filename')
            launch=verify_bundle(args.launch.parent)
            units=host_units(launch);args.output.mkdir(mode=0o700)
            for name,content in units.items():(args.output/name).write_text(content)
            print(canonical({'units':sorted(units),'executed':False}));return 0
        require(args.resources is not None and args.evidence is not None,'resources and evidence required')
        r=frozen_resources(json.loads(args.resources.read_text()))
        entries=json.loads(args.evidence.read_text())
        class Recorded:
            def call(self,operation,params,**kwargs):
                require(entries,'missing recorded response')
                item=entries.pop(0)
                require(item['operation']==operation and item['params']==params,'recorded request mismatch')
                return decode_cloud(operation,item['returncode'],item.get('stdout',''),item.get('stderr',''),timed_out=item.get('timed_out',False))
        result=inventory(Recorded(),r)
        require(not entries,'unused recorded response')
        print(canonical(result))
        return 0 if result['complete'] else 1
    except (StateError,ValueError,OSError,KeyError,TypeError,subprocess.TimeoutExpired):
        print('{"error":"invalid or incomplete evidence"}')
        return 2


if __name__=='__main__':
    raise SystemExit(main())
