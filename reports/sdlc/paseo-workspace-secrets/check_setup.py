import json, os, subprocess, tempfile
from pathlib import Path

root=Path(__file__).resolve().parents[3]
assert (root/'paseo.json').exists(), 'Missing workspace setup configuration'
setup=json.loads((root/'paseo.json').read_text())['worktree']['setup']
with tempfile.TemporaryDirectory(prefix='tw-paseo-check-') as tmp:
    base=Path(tmp);source=base/'source checkout';source.mkdir();(source/'.aws').mkdir()
    for name in ['aleckim.pem','credentials']:(source/'.aws'/name).write_text('fixture-'+name)
    target=base/'workspace';target.mkdir();subprocess.run(['git','init','-q',str(target)],check=True)
    env=dict(os.environ,PASEO_SOURCE_CHECKOUT_PATH=str(source))
    def execute(expect=0):
        result=subprocess.run(['sh','-c',setup],cwd=target,env=env,capture_output=True,text=True)
        assert (result.returncode==0)==(expect==0), result.stderr
        assert 'fixture-' not in result.stdout+result.stderr
    execute()
    for name,mode in [('aleckim.pem',0o400),('credentials',0o600)]:
        dest=target/'.aws'/name
        assert dest.read_bytes()==(source/'.aws'/name).read_bytes()
        assert dest.stat().st_mode & 0o777==mode
        subprocess.run(['git','check-ignore','--quiet',str(dest)],cwd=target,check=True)
    assert (target/'.aws').stat().st_mode & 0o777==0o700
    (target/'.aws/credentials').write_text('keep existing')
    execute();assert (target/'.aws/credentials').read_text()=='keep existing'
    print('PASS copy, modes, Git exclusion, rerun preserves existing files, no secret output')
    target=base/'missing';target.mkdir();env['PASEO_SOURCE_CHECKOUT_PATH']=str(base/'absent');execute()
    assert not (target/'.aws/credentials').exists();print('PASS missing source safely skipped')
    target=base/'symlink';target.mkdir();(target/'.aws').symlink_to(source/'.aws',target_is_directory=True)
    env['PASEO_SOURCE_CHECKOUT_PATH']=str(source);execute(1);print('PASS destination directory symlink refused')
    target=base/'no-env';target.mkdir();env.pop('PASEO_SOURCE_CHECKOUT_PATH');execute(1);print('PASS missing source environment fails clearly')

with tempfile.TemporaryDirectory(prefix='tw-paseo-negation-') as tmp:
    base=Path(tmp);source=base/'source';source.mkdir();(source/'.aws').mkdir()
    for name in ['aleckim.pem','credentials']:(source/'.aws'/name).write_text('fixture-'+name)
    target=base/'target';target.mkdir();(target/'.aws').mkdir()
    (target/'.aws/.gitignore').write_text('*\n!credentials\n!aleckim.pem\n')
    subprocess.run(['git','init','-q',str(target)],check=True)
    result=subprocess.run(['sh','-c',setup],cwd=target,env=dict(os.environ,PASEO_SOURCE_CHECKOUT_PATH=str(source)),capture_output=True,text=True)
    assert result.returncode==0
    for name in ['aleckim.pem','credentials']:
        assert subprocess.run(['git','check-ignore','--quiet','.aws/'+name],cwd=target).returncode==0, 'Existing negation exposes '+name
    print('PASS existing Git ignore negations cannot expose copied files')
