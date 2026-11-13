#!/usr/bin/env python3
"""Offline fixture for the Rust canonical-codec export acceptance check."""
import json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'integration'))
import test_shadow_supervisor as t
root=Path(sys.argv[1]);source=root/'original.json';original=json.loads(source.read_text())
body=bytes(original['body']);key=original['key'];stamp='2026-11-13T07:00:00+00:00'
def get(params,kwargs):
    assert params['Key']==key and params['VersionId']=='original-version'
    kwargs['output'].write_bytes(body)
    return t.cloud_json('GetObject',dict(VersionId='original-version',ContentLength=len(body),
        ContentRange=f'bytes 0-{len(body)-1}/{len(body)}',LastModified=stamp,
        ContentType='application/gzip',Metadata=original['metadata']))
cloud=t.FixtureCloud([
    ('ListObjectVersions',t.cloud_json('ListObjectVersions',dict(IsTruncated=False,
        Versions=[dict(Key=key,VersionId='original-version',Size=len(body))]))),
    ('GetObject',get),('ListObjectVersions',t.cloud_json('ListObjectVersions',dict(IsTruncated=False)))])
with t.J(root/'journal',create=True,run_id='test1',manifest_sha=t.DIGEST,epoch=1000) as journal:
    manifest=t.operator.export_sources(cloud,journal,t.owned_resources(),root/'export')
assert manifest['complete']
source.unlink()
assert not cloud.replies
