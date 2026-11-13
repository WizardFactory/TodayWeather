#!/usr/bin/env python3
"""Single-host provisioning and explicit bounded lifecycle CLI.

Every mutation has one durable exact request and acknowledgement. Resume skips
successful mutations and reconciles an uncertain EC2 launch by the original
client token. Named-resource conflicts are never adopted. Live dispatch requires a qualified candidate, frozen cost and paid-provider
policies, and retained evidence. Preparation and inspection are offline.
"""
from __future__ import annotations
import ipaddress
import re
import subprocess
import time
from pathlib import Path
from coordinator import (require, dispatch_recorded, bind_resources, frozen_resources,
                         has_run_tag, delete_versions, inventory, cleanup, CleanupCloud)
from state import CloudResult, StateError, canonical, absence, Journal, launch_user_data


def cloud_plan(value):
    fields={'schema','run_id','account','region','image','vpc','subnet','key_name','operator_cidr','root_device'}
    require(type(value) is dict and set(value)==fields,'cloud plan fields')
    require(type(value['schema']) is int and value['schema']==1,'cloud plan schema')
    for key,pattern in [('run_id','[a-z0-9-]{1,30}'),('account','[0-9]{12}'),
            ('image','ami-[0-9a-f]{8,17}'),('vpc','vpc-[0-9a-f]{8,17}'),
            ('subnet','subnet-[0-9a-f]{8,17}'),('key_name','[A-Za-z0-9_.-]{1,100}')]:
        require(isinstance(value[key],str) and re.fullmatch(pattern,value[key]),'cloud '+key)
    require(value['region']=='ap-northeast-2','cloud region')
    require(value['root_device'] in ('/dev/xvda','/dev/sda1'),'root device')
    require(type(value['operator_cidr']) is str,'operator CIDR')
    address=ipaddress.ip_network(value['operator_cidr'],strict=True)
    require(address.version==4 and address.prefixlen==32 and address.network_address.is_global,'single public operator address')
    return value


def receipt_result(request):
    receipt=request['receipt']
    require(receipt is not None,'uncertain named request; reconcile before proceeding')
    return CloudResult(receipt['kind'],receipt['operation'],receipt['payload'],receipt['code'])


def once(cloud,journal,key,operation,params,*,now,allow_empty=False):
    """Skip only a matching successful request. Never retry an uncertain effect."""
    journal.active(now)
    existing=journal.request(key)
    if existing is None:
        answer=dispatch_recorded(cloud,journal,key,operation,params,key,now=now)
    else:
        require(existing['operation']==operation and existing['params']==params,'request changed on resume')
        answer=receipt_result(existing)
    require(answer.kind=='json' or (allow_empty and answer.kind=='empty_success'),'provisioning request did not succeed: '+key)
    return answer.payload or {}


def freeze_plan(journal,plan,now):
    cloud_plan(plan)
    require(journal.snapshot()['run_id']==plan['run_id'],'cloud/journal identity')
    existing=journal.request('cloud-plan')
    if existing is None:
        journal.prepare_request('cloud-plan','FreezeCloudPlan',plan,'cloud-plan',now=now)
        journal.record_receipt('cloud-plan',CloudResult('json','FreezeCloudPlan',{'frozen':True}))
    else:require(existing['params']==plan,'cloud plan changed')


def initial_preflight(cloud,journal,p,now):
    """Persist successful absence/AMI/network observations before any creation."""
    done=journal.request('cloud-preflight')
    if done is not None:
        require(done['receipt'] is not None and done['receipt']['payload']=={'complete':True},'incomplete original preflight')
        return
    prefix='server2-shadow-'+p['run_id']
    def read(op,params):
        answer=cloud.call(op,params)
        require(answer.kind=='json','preflight observation unavailable: '+op)
        return answer.payload
    identity=read('GetCallerIdentity',{})
    require(identity.get('Account')==p['account'],'preflight account mismatch')
    subnets=read('DescribeSubnets',{'SubnetIds':[p['subnet']]}).get('Subnets')
    require(isinstance(subnets,list) and len(subnets)==1 and subnets[0].get('SubnetId')==p['subnet']
            and subnets[0].get('VpcId')==p['vpc'] and subnets[0].get('State')=='available','subnet binding')
    images=read('DescribeImages',{'ImageIds':[p['image']],'Owners':['amazon']}).get('Images')
    require(isinstance(images,list) and len(images)==1 and images[0].get('ImageId')==p['image']
            and images[0].get('Architecture')=='x86_64' and images[0].get('State')=='available'
            and images[0].get('RootDeviceType')=='ebs' and images[0].get('RootDeviceName')==p['root_device'], 'Amazon image binding')
    keys=read('DescribeKeyPairs',{'KeyNames':[p['key_name']]}).get('KeyPairs')
    require(isinstance(keys,list) and len(keys)==1 and keys[0].get('KeyName')==p['key_name'],'existing SSH key binding')
    for op,field in [('GetRole','RoleName'),('GetInstanceProfile','InstanceProfileName')]:
        answer=cloud.call(op,{field:prefix})
        require(absence(answer),'existing or unknown named IAM resource')
    groups=read('DescribeSecurityGroups',{'Filters':[{'Name':'group-name','Values':[prefix]},
                                                   {'Name':'vpc-id','Values':[p['vpc']]}]}).get('SecurityGroups')
    require(groups==[],'existing or unknown security group')
    token=None;seen=set()
    for _ in range(100):
        params={'MaxBuckets':1000}
        if token:params['ContinuationToken']=token
        page=read('ListBuckets',params);buckets=page.get('Buckets')
        require(isinstance(buckets,list) and all(isinstance(b,dict) and isinstance(b.get('Name'),str) for b in buckets),'bucket inventory shape')
        require(not any(b['Name'] in (prefix+'-raw',prefix+'-state') for b in buckets),'existing task bucket')
        token=page.get('ContinuationToken')
        if not token:break
        require(isinstance(token,str) and token not in seen,'bucket continuation');seen.add(token)
    else:raise StateError('bucket preflight exhausted')
    # This receipt is a local aggregate of read-only observations. It is not
    # interchangeable with any named-resource creation acknowledgement.
    journal.prepare_request('cloud-preflight','CloudPreflight',{'plan':p},'cloud-preflight',now=now)
    journal.record_receipt('cloud-preflight',CloudResult('json','CloudPreflight',{'complete':True}))


def reconcile_instance(cloud,token):
    answer=cloud.call('DescribeInstances',{'Filters':[{'Name':'client-token','Values':[token]}]})
    require(answer.kind=='json','launch observation unavailable')
    reservations=answer.payload.get('Reservations')
    require(isinstance(reservations,list) and all(isinstance(r,dict) and isinstance(r.get('Instances'),list) for r in reservations),'launch observation shape')
    instances=[instance for r in reservations for instance in r['Instances']]
    require(len(instances)<=1,'more than one instance for original token')
    if not instances:return None
    require(isinstance(instances[0],dict) and instances[0].get('ClientToken')==token,'launch token mismatch')
    return instances[0]


def provision_resources(cloud,journal,plan,*,now=None):
    """Advance one immutable provisioning sequence; all calls are scoped by plan.

    A propagated IAM role is checked afresh on resume. An uncertain launch with
    no visible instance returns pending, without another RunInstances attempt.
    No host process or production API read starts here.
    """
    def moment():return int(time.time()) if now is None else int(now() if callable(now) else now)
    p=cloud_plan(plan);freeze_plan(journal,p,moment());journal.active(moment())
    initial_preflight(cloud,journal,p,moment())
    prefix='server2-shadow-'+p['run_id'];buckets=[prefix+'-raw',prefix+'-state']
    tags=[{'Key':'ShadowRunId','Value':p['run_id']},
          {'Key':'ExpiresAtEpoch','Value':str(journal.snapshot()['cleanup_until'])}]
    def step(key,op,params,empty=False):return once(cloud,journal,key,op,params,now=moment(),allow_empty=empty)
    for kind,bucket in zip(('raw','state'),buckets):
        step('bucket-'+kind,'CreateBucket',{'Bucket':bucket,'CreateBucketConfiguration':{'LocationConstraint':p['region']},'ObjectOwnership':'BucketOwnerEnforced'})
        step('bucket-public-'+kind,'PutPublicAccessBlock',{'Bucket':bucket,'PublicAccessBlockConfiguration':{
            'BlockPublicAcls':True,'IgnorePublicAcls':True,'BlockPublicPolicy':True,'RestrictPublicBuckets':True}},True)
        step('bucket-version-'+kind,'PutBucketVersioning',{'Bucket':bucket,'VersioningConfiguration':{'Status':'Enabled'}},True)
        step('bucket-tags-'+kind,'PutBucketTagging',{'Bucket':bucket,'Tagging':{'TagSet':tags}},True)
    trust={'Version':'2012-10-17','Statement':[{'Effect':'Allow','Principal':{'Service':'ec2.amazonaws.com'},'Action':'sts:AssumeRole'}]}
    step('role','CreateRole',{'RoleName':prefix,'AssumeRolePolicyDocument':canonical(trust),'Tags':tags})
    policy={'Version':'2012-10-17','Statement':[
        {'Effect':'Allow','Action':['s3:ListBucket'],'Resource':['arn:aws:s3:::'+b for b in buckets]},
        {'Effect':'Allow','Action':['s3:GetObject','s3:PutObject'],'Resource':['arn:aws:s3:::'+b+'/*' for b in buckets]}]}
    step('role-policy','PutRolePolicy',{'RoleName':prefix,'PolicyName':prefix,'PolicyDocument':canonical(policy)},True)
    step('profile','CreateInstanceProfile',{'InstanceProfileName':prefix,'Tags':tags})
    step('profile-role','AddRoleToInstanceProfile',{'InstanceProfileName':prefix,'RoleName':prefix},True)
    sg=step('security-group','CreateSecurityGroup',{'GroupName':prefix,'Description':'Temporary bounded server2 qualification',
        'VpcId':p['vpc'],'TagSpecifications':[{'ResourceType':'security-group','Tags':tags}]}).get('GroupId')
    require(isinstance(sg,str) and re.fullmatch('sg-[0-9a-f]{8,17}',sg),'created group ID')
    step('ssh-ingress','AuthorizeSecurityGroupIngress',{'GroupId':sg,'IpPermissions':[
        {'IpProtocol':'tcp','FromPort':22,'ToPort':22,'IpRanges':[{'CidrIp':p['operator_cidr']}]}]})
    profile=cloud.call('GetInstanceProfile',{'InstanceProfileName':prefix})
    obj=profile.payload.get('InstanceProfile') if profile.kind=='json' else None
    if not (isinstance(obj,dict) and obj.get('InstanceProfileName')==prefix
            and isinstance(obj.get('Roles'),list) and len(obj['Roles'])==1 and obj['Roles'][0].get('RoleName')==prefix):
        return {'status':'pending','reason':'instance_profile_propagation','launch_dispatched':False}
    token='shadow-'+p['run_id']+'-initial'
    params={'ClientToken':token,'ImageId':p['image'],'InstanceType':'t3.small','MinCount':1,'MaxCount':1,
        'KeyName':p['key_name'],'IamInstanceProfile':{'Name':prefix},
        'UserData':launch_user_data(p['run_id'],journal.snapshot()['epoch']),
        'NetworkInterfaces':[{'DeviceIndex':0,'SubnetId':p['subnet'],'Groups':[sg],'AssociatePublicIpAddress':True,'DeleteOnTermination':True}],
        'BlockDeviceMappings':[{'DeviceName':p['root_device'],'Ebs':{'VolumeSize':32,'VolumeType':'gp3','Encrypted':True,'DeleteOnTermination':True}}],
        'MetadataOptions':{'HttpTokens':'required','HttpEndpoint':'enabled'},'Monitoring':{'Enabled':False},
        'CreditSpecification':{'CpuCredits':'unlimited'},'InstanceInitiatedShutdownBehavior':'terminate',
        'TagSpecifications':[{'ResourceType':kind,'Tags':tags} for kind in ('instance','volume')]}
    journal.active(moment())
    request=journal.request('launch')
    if request is None:
        dispatch_recorded(cloud,journal,'launch','RunInstances',params,token,now=moment())
        request=journal.request('launch')
    require(request['params']==params and request['token']==token,'launch parameters changed')
    if request['receipt'] is not None:
        require(request['receipt']['kind'] in ('json','timeout','command_error','malformed'),'launch rejected; no replacement')
    instance=reconcile_instance(cloud,token)
    if instance is None:return {'status':'pending','reason':'uncertain_launch','launch_dispatched':True}
    mappings=instance.get('BlockDeviceMappings')
    if mappings==[] or mappings is None:
        return {'status':'pending','reason':'root_volume_pending','launch_dispatched':True}
    require(isinstance(mappings,list) and len(mappings)==1 and isinstance(mappings[0].get('Ebs'),dict),'root volume observation malformed')
    resources=frozen_resources(dict(schema=1,account=p['account'],region=p['region'],run_id=p['run_id'],instance=instance.get('InstanceId'),
        security_group=sg,volumes=[mappings[0]['Ebs'].get('VolumeId')],buckets=buckets,role=prefix,profile=prefix,policy=prefix))
    bind_resources(cloud,journal,resources,now=moment())
    return {'status':'bound','resources':resources,'launch_dispatched':True,'host_installed':False}


def cleanup_partial(cloud,journal,*,now,source_destination=None):
    """Clean acknowledged creations after a failed provision; never acquire.

    Unknown creation acknowledgements remain named, unresolved outcomes. In
    particular an empty token query after an uncertain launch is NOT proof that
    a launch never happened. Keep dependencies until termination is confirmed.
    """
    cloud=CleanupCloud(cloud)
    frozen=journal.request('cloud-plan')
    require(frozen is not None,'original cloud plan missing')
    p=cloud_plan(frozen['params']);prefix='server2-shadow-'+p['run_id']
    if journal.mutation('owned-resources') is not None:
        owned=journal.request('owned-resources')
        resources=frozen_resources(owned['params'])
        result=cleanup(cloud,journal,resources,source_destination=source_destination)
        return dict(result,complete=result['resources_gone'])
    launch=journal.request('launch')
    if launch is not None:
        instance=reconcile_instance(cloud,launch['token'])
        if instance is None:
            if launch['receipt'] is None or launch['receipt']['kind']!='service_error':
                return {'complete':False,'pending':['uncertain_launch'],'actions':[]}
        else:
            sg=journal.request('security-group')
            require(sg is not None,'created group request missing')
            group=receipt_result(sg);require(group.kind=='json','created group unknown')
            mappings=instance.get('BlockDeviceMappings')
            require(isinstance(mappings,list) and len(mappings)==1,'launched volume unavailable')
            resources=frozen_resources(dict(schema=1,account=p['account'],region=p['region'],run_id=p['run_id'],
                instance=instance.get('InstanceId'),security_group=group.payload.get('GroupId'),
                volumes=[mappings[0].get('Ebs',{}).get('VolumeId')],buckets=[prefix+'-raw',prefix+'-state'],role=prefix,profile=prefix,policy=prefix))
            bind_resources(cloud,journal,resources,now=now)
            result=cleanup(cloud,journal,resources,source_destination=source_destination)
            return dict(result,complete=result['resources_gone'])
    owned={};unknown=[];actions=[]
    for key in ('bucket-raw','bucket-state','role','profile','security-group'):
        request=journal.request(key)
        if request is None:continue
        result=request['receipt']
        if result is None or result['kind'] in ('timeout','command_error','malformed'):
            unknown.append(key);continue
        if result['kind']=='service_error':continue
        require(result['kind']=='json','unexpected creation acknowledgement')
        params=request['params'];payload=result['payload']
        if key.startswith('bucket-'):
            expected=prefix+'-'+key.removeprefix('bucket-')
            require(params.get('Bucket')==expected,'created bucket mismatch');owned[key]=expected
        elif key=='security-group':
            require(params.get('GroupName')==prefix,'created group mismatch')
            value=payload.get('GroupId');require(isinstance(value,str) and re.fullmatch('sg-[0-9a-f]{8,17}',value),'created group ID')
            owned[key]=value
        else:
            field='Role' if key=='role' else 'InstanceProfile';name=field+'Name'
            require(params.get(name)==prefix and isinstance(payload.get(field),dict)
                    and payload[field].get(name)==prefix,'created IAM mismatch');owned[key]=prefix
    def call(op,params):
        result=cloud.call(op,params);actions.append({'operation':op,'kind':result.kind,'code':result.code});return result
    for key in ('bucket-raw','bucket-state'):
        if key in owned:
            try:delete_versions(cloud,owned[key])
            except StateError:actions.append({'operation':'DeleteObjects','kind':'incomplete','code':None})
            call('DeleteBucket',{'Bucket':owned[key]})
    if 'profile' in owned:
        if 'role' in owned:call('RemoveRoleFromInstanceProfile',{'InstanceProfileName':prefix,'RoleName':prefix})
        call('DeleteInstanceProfile',{'InstanceProfileName':prefix})
    if 'role' in owned:
        call('DeleteRolePolicy',{'RoleName':prefix,'PolicyName':prefix})
        call('DeleteRole',{'RoleName':prefix})
    if 'security-group' in owned:call('DeleteSecurityGroup',{'GroupId':owned['security-group']})
    checks={}
    for key,op,field in [('role','GetRole','RoleName'),('profile','GetInstanceProfile','InstanceProfileName')]:
        if key in owned:checks[key]=absence(call(op,{field:prefix}))
    if 'security-group' in owned:
        checks['security-group']=absence(call('DescribeSecurityGroups',{'Filters':[{'Name':'group-id','Values':[owned['security-group']]}]}))
    bucket_names=[owned[k] for k in ('bucket-raw','bucket-state') if k in owned]
    if bucket_names:
        token=None;seen=set();listed=[];valid=True
        for _ in range(100):
            params={'MaxBuckets':1000}
            if token:params['ContinuationToken']=token
            result=call('ListBuckets',params)
            items=result.payload.get('Buckets') if result.kind=='json' else None
            if not isinstance(items,list) or not all(isinstance(i,dict) and isinstance(i.get('Name'),str) for i in items):valid=False;break
            listed.extend(i['Name'] for i in items);token=result.payload.get('ContinuationToken')
            if not token:break
            if not isinstance(token,str) or token in seen:valid=False;break
            seen.add(token)
        else:valid=False
        checks.update({b:valid and not token and b not in listed for b in bucket_names})
    return {'complete':not unknown and all(checks.values()),'pending':unknown,'checks':checks,'actions':actions}


def finish_run(cloud,remote,journal,destination,*,now=None):
    """Retain stopped-host evidence first; always attempt independent cloud cleanup.

    Complete file retention is separate from product qualification. Unknown raw
    dependency closure cannot become a qualification PASS here.
    """
    from remote import retain_host_evidence
    destination=Path(destination);destination.mkdir(mode=0o700)
    evidence={'complete':False,'reason':'host_evidence_unavailable'}
    cleanup_result={'complete':False,'reason':'cleanup_unavailable'}
    try:
        if remote is not None:evidence=retain_host_evidence(remote,journal,destination/'host')
    except (StateError,OSError,ValueError):pass
    finally:
        try:
            cleanup_result=cleanup_partial(cloud,journal,now=int(time.time()) if now is None else now,
                                           source_destination=destination/'sources')
        except (StateError,OSError,ValueError):pass
    report={'schema':1,'host_evidence':evidence,'cleanup':cleanup_result,'qualification':'not_assessed'}
    with (destination/'result.json').open('x') as stream:
        import os
        os.chmod(destination/'result.json',0o600)
        stream.write(canonical(report)+'\n');stream.flush();os.fsync(stream.fileno())
    return report


def prepare_run(plan,source,directory,bundle,*,now):
    """Freeze cloud and host inputs and spend the initial grant, offline only.

    A partial preparation retains its journal. Never delete/reinitialize it to
    reclaim a grant. Inspection exposes the state without dispatching anything.
    """
    import hashlib
    from coordinator import launch_plan, prepare_generation
    from state import Journal, estimate_cost
    require(type(plan) is dict and set(plan)=={'host','cloud','allowance'},'run plan fields')
    cloud_plan(plan['cloud'])
    host=plan['host']
    launch_plan(dict(plan=host,epoch=now,generation='initial',allowance=plan['allowance']))
    require(host['run_id']==plan['cloud']['run_id'],'run identity')
    require(estimate_cost(host['cost_policy'],now,now,cpu_seconds=0)['stop'] is None,'projected budget')
    digest=hashlib.sha256(canonical(host).encode()).hexdigest()
    with Journal(directory,create=True,run_id=host['run_id'],manifest_sha=digest,epoch=now) as journal:
        freeze_plan(journal,plan['cloud'],now)
        prepare_generation(journal,host,source,bundle,'initial',plan['allowance'],now=now)
        return {'state':journal.snapshot(),'cloud_called':False,'ready_for_live_run':False}


def inspect_run(directory,bundle):
    import hashlib
    from coordinator import verify_bundle
    from state import Journal
    launch=verify_bundle(bundle)
    digest=hashlib.sha256(canonical(launch['plan']).encode()).hexdigest()
    with Journal(directory,run_id=launch['plan']['run_id'],manifest_sha=digest) as journal:
        current=journal.snapshot()
        require(launch['epoch']==current['epoch'],'bundle epoch')
        record=journal.request('cloud-plan')
        require(record is not None and receipt_result(record).payload=={'frozen':True},'frozen cloud plan')
        cloud_plan(record['params'])
        require(record['params']['run_id']==current['run_id'],'cloud identity')
        grant=journal.db.execute('SELECT reads,writes,put_bytes FROM generations WHERE id=?',
                                 (launch['generation'],)).fetchone()
        require(grant==tuple(launch['allowance'][k] for k in Journal.CAPS),'bundle grant')
        return {'state':current,'cloud_called':False,'ready_for_live_run':False}


class BudgetedRemote:
    """Reserve small SSH control envelopes; final stop uses cleanup reserve.

    The one host evidence export has its separate prepaid two-GiB body allowance
    and durable one-use intent. No retry after an uncertain export is introduced.
    """
    def __init__(self,remote,journal):
        self.remote=remote;self.journal=journal;self.binding=remote.binding;self.finalizing=False
    def invoke(self,action,**kwargs):
        self.journal.reserve_control(response_bytes=65536,cleanup=self.finalizing and action in ('stop','inspect'))
        return self.remote.invoke(action,**kwargs)


def connect_remote(cloud,journal,resources,identity,*,now):
    from remote import bind_target,scan_host,Remote
    try:binding=bind_target(cloud,journal,resources,scan_host,now=now)
    except StateError as error:
        if str(error) in ('SSH instance state','SSH endpoint','console has no SHA256 host fingerprints',
                          'host key scan unavailable'):
            return None
        raise
    return BudgetedRemote(Remote(binding,identity,journal.directory/'known_hosts'),journal)


def lifecycle(cloud,journal,plan,bundle,destination,connector,*,clock=time.time,sleep=time.sleep,progress=lambda event:None):
    """One host, one install, bounded startup, then observation until original expiry.

    A separate process restart is deliberately unsupported. Resumption observes
    the recorded install and cannot issue it again. All exits attempt retention
    and exact-owned cleanup, including cancellation before SSH is available.
    """
    from coordinator import verify_bundle
    from remote import install_remote,inspect_install
    launch=verify_bundle(bundle)
    require(launch['generation']=='initial','only initial host generation is supported')
    require(not Path(destination).exists(),'finish destination already exists')
    remote=None;reason='collection_deadline';failure=None
    try:
        # Each resumed call reconciles exact original requests; elapsed run time
        # and generation grants are never refreshed by this startup allowance.
        until=min(int(clock())+180,journal.snapshot()['collection_until'])
        while True:
            journal.active(int(clock()))
            provisioned=provision_resources(cloud,journal,plan,now=int(clock()))
            if provisioned['status']=='bound':break
            progress({'phase':'provision_pending','reason':provisioned['reason']})
            require(clock()<until,'startup timeout')
            sleep(5)
        while remote is None:
            journal.active(int(clock()))
            remote=connector(cloud,journal,provisioned['resources'],now=int(clock()))
            if remote is None:
                require(clock()<until,'SSH readiness timeout');sleep(5)
        while True:
            installed=install_remote(remote,journal,bundle,now=int(clock()))
            if installed['status']=='started':break
            require(installed['status'] in ('pending','installing'),'host installation stopped')
            require(clock()<until,'installation timeout');sleep(5)
        progress({'phase':'collecting','collection_until':journal.snapshot()['collection_until']})
        while clock()<journal.snapshot()['collection_until']:
            journal.active(int(clock()))
            observed=inspect_install(remote,journal,launch)
            require(observed['status']=='started','host acquisition stopped or unobservable')
            sleep(min(60,max(0,journal.snapshot()['collection_until']-clock())))
    except (StateError,OSError,ValueError,subprocess.TimeoutExpired) as error:
        reason='acquisition_failed';failure=type(error).__name__
    except KeyboardInterrupt:
        reason='operator_interrupted'
    finally:
        if remote is not None and isinstance(remote,BudgetedRemote):remote.finalizing=True
        progress({'phase':'finishing','reason':reason})
        report=finish_run(cloud,remote,journal,destination,now=int(clock()))
        # Termination/role removal may still be propagating. Retry observations
        # and exact cleanup only, without repeating evidence export or launches.
        attempts=[]
        for _ in range(3):
            if report['cleanup'].get('complete'):break
            if clock()>=journal.snapshot()['cleanup_until']:break
            sleep(15)
            # A pending termination has not started source export. Preserve that
            # first opportunity; an existing export (even partial) is not retried.
            sources=Path(destination)/'sources'
            try:observed=cleanup_partial(cloud,journal,now=int(clock()),
                                        source_destination=None if sources.exists() else sources)
            except (StateError,OSError,ValueError):break
            attempts.append(observed);report['cleanup']=observed
        report.update(stop_reason=reason,failure_class=failure,cleanup_rechecks=attempts)
        retain_result(Path(destination)/'lifecycle.json',report)
    return report


def retain_result(path,value):
    import os
    from state import sync_directory
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as stream:
        stream.write(canonical(value)+'\n');stream.flush();os.fsync(stream.fileno())
    sync_directory(path.parent)


def live_command(args):
    """Explicit public dispatch; callers must complete candidate qualification first."""
    import hashlib
    from coordinator import Aws,verify_bundle
    from state import Journal
    from remote import Remote
    require(args.execute,'live dispatch requires --execute')
    require(args.output is not None and not args.output.exists(),'new evidence output required')
    with Journal(args.state) as journal:
        frozen=journal.request('cloud-plan')
        require(frozen is not None and receipt_result(frozen).payload=={'frozen':True},'frozen cloud plan')
        plan=cloud_plan(frozen['params'])
        require(plan['run_id']==journal.snapshot()['run_id'],'run identity')
        if args.command=='run':
            require(args.bundle is not None and args.identity is not None,'bundle and SSH identity required')
            require(args.identity.is_absolute() and args.identity.is_file() and not args.identity.is_symlink()
                    and args.identity.stat().st_mode&0o077==0,'private SSH identity')
            launch=verify_bundle(args.bundle)
            require(launch['epoch']==journal.snapshot()['epoch']
                    and hashlib.sha256(canonical(launch['plan']).encode()).hexdigest()==journal.snapshot()['manifest_sha'],
                    'run bundle identity')
            require(launch['plan']['native_families'],'native read coverage required')
            grant=journal.db.execute('SELECT reads,writes,put_bytes FROM generations WHERE id=?',('initial',)).fetchone()
            require(journal.snapshot()['generations']==1 and grant==tuple(launch['allowance'][k] for k in Journal.CAPS),
                    'initial generation grant')
            journal.active(int(time.time()))
        context={key:plan[key] for key in ('run_id','region','account')}
        cloud=Aws(journal,context,executable=args.aws_executable,profile=args.profile,cleanup=args.command=='finish')
        if args.command=='run':
            return lifecycle(cloud,journal,plan,args.bundle,args.output,
                lambda c,j,r,now:connect_remote(c,j,r,args.identity,now=now),
                progress=lambda event:print(canonical(event),flush=True))
        remote=None
        binding=journal.request('ssh-target')
        if binding is not None and args.identity is not None:
            try:
                remote=BudgetedRemote(Remote(binding['params'],args.identity,journal.directory/'known_hosts'),journal)
                remote.finalizing=True
            except (StateError,OSError):pass
        # Missing/invalid local bundle or SSH key must not prevent cloud cleanup.
        return finish_run(cloud,remote,journal,args.output)


def main():
    """Preparation/inspection CLI; live dispatch remains gated on qualification."""
    import argparse
    import json
    import sqlite3
    parser=argparse.ArgumentParser(description='Bounded shadow lifecycle. prepare/inspect are offline; run/finish require --execute.')
    parser.add_argument('command',choices=['prepare','inspect','run','finish'])
    parser.add_argument('--state',type=Path,required=True)
    parser.add_argument('--bundle',type=Path)
    parser.add_argument('--plan',type=Path)
    parser.add_argument('--source',type=Path)
    parser.add_argument('--execute',action='store_true')
    parser.add_argument('--identity',type=Path)
    parser.add_argument('--output',type=Path)
    parser.add_argument('--aws-executable',default='/usr/local/bin/aws')
    parser.add_argument('--profile')
    args=parser.parse_args()
    try:
        if args.command in ('run','finish'):
            result=live_command(args);print(canonical(result))
            return 0 if result['cleanup'].get('complete') else 1
        require(args.bundle is not None,'bundle required')
        if args.command=='prepare':
            require(args.plan is not None and args.source is not None,'plan/source required')
            require(args.plan.stat().st_size<=65536,'plan size')
            result=prepare_run(json.loads(args.plan.read_text()),args.source,args.state,args.bundle,now=int(time.time()))
        else:result=inspect_run(args.state,args.bundle)
        print(canonical(result));return 0
    except (StateError,OSError,ValueError,KeyError,TypeError,sqlite3.Error,subprocess.TimeoutExpired):
        print('{"error":"run command rejected; inspect retained journal and cleanup evidence"}')
        return 2


if __name__=='__main__':
    raise SystemExit(main())
