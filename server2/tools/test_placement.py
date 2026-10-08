"""Synthetic Git fixture tests; no real repository mutations."""
import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
spec = importlib.util.spec_from_file_location('placement', Path(os.environ.get('SERVER2_TEST_CHECKER', Path(__file__).with_name('check_placement.py'))))
placement = importlib.util.module_from_spec(spec)
spec.loader.exec_module(placement)

class PlacementTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name)
        self.git('init', '-q'); self.git('config', 'user.name', 'fixture'); self.git('config', 'user.email', 'fixture@example.invalid')
        self.write('server2/src/lib.rs', 'pub fn fixture() {}\n'); self.commit()
        self.base = self.git('rev-parse', 'HEAD').strip()
        self.d = dict(task='S04', issue='#2689', server2_paths=['server2/'], outside=[dict(path='docs/operations/fixture.md', category='documentation', reason='operator guide'),dict(path='server/test/offline/golden-record.js',category='legacy-oracle',reason='legacy execution oracle')])
    def tearDown(self): self.temp.cleanup()
    def git(self, *args): return subprocess.check_output(['git','-C',str(self.root),*args],stderr=subprocess.DEVNULL).decode()
    def write(self, path, value):
        p=self.root/path; p.parent.mkdir(parents=True,exist_ok=True); p.write_text(value)
    def fixture_symlink(self, path, value): (self.root/path).symlink_to(value)
    def commit(self): self.git('add','.'); self.git('commit','-qm','fixture')
    def errors(self): return placement.check(self.root,self.d,self.base)
    def test_declared_docs_and_named_recorder(self):
        self.write('docs/operations/fixture.md','manual');self.write('server/test/offline/golden-record.js','oracle');self.assertEqual([],self.errors())
    def test_outside_config_tests_deploy(self):
        for path in ['config/server2.json','server/test/server2.js','deploy/server2.service']:
            self.write(path,'{}')
        self.assertEqual(3,len(self.errors()))
    def test_rename_destination(self):
        self.git('mv','server2/src/lib.rs','moved.rs');self.assertTrue(any('moved.rs' in x for x in self.errors()))
    def test_rename_source(self):
        self.write('legacy.rs','fixture');self.commit();self.base=self.git('rev-parse','HEAD').strip()
        self.git('mv','legacy.rs','server2/src/legacy.rs');self.assertTrue(any('legacy.rs' in x for x in self.errors()))
    def test_root_cargo_even_if_unchanged(self):
        self.write('Cargo.toml','[workspace]\nmembers=["server2"]');self.commit();self.base=self.git('rev-parse','HEAD').strip()
        self.assertTrue(any('root Rust' in x for x in self.errors()))
    def test_unchanged_include_escape(self):
        self.write('server2/src/lib.rs','include_str!("../../server/config/private.json");');self.commit();self.base=self.git('rev-parse','HEAD').strip()
        self.assertTrue(any('resource/include escape' in x for x in self.errors()))
    def test_runtime_relative_path_is_not_compiler_include(self):
        self.write('server2/src/lib.rs','std::fs::read("../client/config.json");')
        self.assertTrue(any('runtime filesystem' in x for x in self.errors()))
    def test_local_dependency_and_workspace_escape(self):
        self.write('server2/Cargo.toml','[dependencies]\nlegacy={path="../server"}\n[workspace]\nmembers=["../outside"]\n')
        self.assertEqual(2,len(self.errors()))
    def test_symlink_escape(self):
        self.fixture_symlink('server2/static','../server');self.git('add','server2/static')
        self.assertTrue(any('symlink escape' in x for x in self.errors()))
    def test_owned_include_allowed(self):
        self.write('server2/src/lib.rs','include_str!("../config/owned.json");');self.write('server2/config/owned.json','{}');self.assertEqual([],self.errors())
    def test_computed_include_rejected(self):
        self.write('server2/src/lib.rs','include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../server/config.json"));');self.assertTrue(self.errors())
    def test_declaration_cannot_allow_implementation_outside(self):
        self.d['outside'].append(dict(path='config/server2.json',category='documentation',reason='pretend docs'));self.assertTrue(self.errors())
    def test_exact_exception_required(self):
        self.d['outside'][0]['path']='docs/';self.assertTrue(self.errors())
    def test_shared_workflow_wiring_only(self):
        self.d['outside'].append(dict(path='.github/workflows/server2.yml',category='ci-wiring',reason='shared CI'))
        self.write('.github/workflows/server2.yml','timeout-minutes: 30\ndefaults:\n  run:\n    working-directory: server2\nsteps:\n  - uses: actions/checkout@v4\n    with:\n      fetch-depth: 0\n  - run: bash tools/ci.sh\n');self.assertEqual([],self.errors())
        self.write('.github/workflows/server2.yml','working-directory: server2\nsteps:\n  - run: |\n      python3 -c "business logic"\n');self.assertTrue(self.errors())

    def test_encoded_compiler_and_runtime_literals_rejected(self):
        for body in [r'include_str!("\x2e\x2e/\x2e\x2e/\x63lient/data.txt");',
                     r'include_str!("\u{2e}\u{2e}/\u{2e}\u{2e}/client/data.txt");',
                     r'#[path="\x2e\x2e/\x2e\x2e/client/data.rs"] mod outside;',
                     r'std::fs::read("\x2e\x2e/client/data.txt");',
                     'include_str!("../config/own\\\n ed.json");',
                     r'include_str!("../config/own\"ed.json");']:
            with self.subTest(body=body):
                self.write('server2/src/lib.rs', body)
                self.assertTrue(self.errors(), body)
    def test_raw_runtime_literals_and_matching_hash_delimiters(self):
        for literal in ['r"../../client/data.txt"', 'r#"../../client/data.txt"#', 'r##"../../client/data.txt"##']:
            with self.subTest(literal=literal):
                self.write('server2/src/lib.rs', 'std::fs::read('+literal+');')
                self.assertTrue(self.errors(), literal)
        for literal in ['r"config/owned.json"', 'r#"config/owned.json"#', 'r##"config/own\"ed.json"##']:
            self.write('server2/src/lib.rs', 'std::fs::read('+literal+');')
            self.assertEqual([], self.errors(), literal)
        self.write('server2/src/lib.rs', 'include_str!(r##"../config/own\"ed.json"##);')
        self.assertEqual([], self.errors())
    def test_unsupported_direct_compiler_arguments_fail_closed(self):
        for body in ['include_str!(asset);', '#[path=asset] mod x;', 'include_str!(r#"../config/x"##);', 'std::fs::read(/*comment*/ r"../../client/x");']:
            self.write('server2/src/lib.rs', body)
            self.assertTrue(self.errors(), body)
    def test_borrowed_and_parenthesized_runtime_literals(self):
        for literal in ['&r"../../client/x"', '&"../server/x"', '(&r##"../../client/x"##)']:
            self.write('server2/src/lib.rs', 'std::fs::read('+literal+');')
            self.assertTrue(self.errors(),literal)
        for literal in ['&r"config/owned.json"', '(&"config/owned.json")']:
            self.write('server2/src/lib.rs', 'std::fs::read('+literal+');')
            self.assertEqual([],self.errors(),literal)
    def test_nonrust_direct_resource_references(self):
        for path,body in [('server2/tools/escape.py', 'open("../client/data.txt")'),
                          ('server2/deploy/run.sh', 'cat ../server/config/config.js'),
                          ('server2/tools/subprocess_escape.py', 'import subprocess; subprocess.run(["cat","../server/config/config.js"])'),
                          ('server2/tools/encoded_escape.py', r'open("\x2e\x2e/server/config/config.js")'),
                          ('server2/config/escape.toml', 'source="../client/data.txt"'),
                          ('server2/deploy/Dockerfile', 'COPY ../server /runtime'),
                          ('server2/config/escape.json', '{"source":"../client/data.txt"}'),
                          ('server2/deploy/server2.service', 'ExecStart=cat ../server/config/config.js')]:
            with self.subTest(path=path):
                self.write(path,body);self.assertTrue(self.errors());(self.root/path).unlink()
    def test_fixture_exemption_is_exact_nonexecutable_write_payload(self):
        self.write('server2/tools/test_placement.py', 'self.write("server2/src/lib.rs", \'std::fs::read("../client/data.txt");\')')
        self.assertEqual([], self.errors())
        self.write('server2/tools/test_placement.py', 'open("../client/data.txt")')
        self.assertTrue(self.errors())

    def compiler_fixture_assets(self):
        self.write('client/data.txt','outside boundary')
        self.write('server/config.js','outside boundary')
        self.write('client/module.rs','pub fn outside() -> &\'static str { "outside boundary" }')
        self.write('server2/config/owned.txt','owned')
        self.write('server2/config/module.rs','pub fn outside() -> &\'static str { "owned" }')
        self.commit();self.base=self.git('rev-parse','HEAD').strip()
    def compile_fixture(self,source,expected='outside boundary'):
        self.write('server2/src/lib.rs','pub fn fixture() {}')
        self.write('server2/src/main.rs',source)
        binary=self.root/'fixture-executable'
        try:
            built=subprocess.run(['rustc','+1.99.0','--edition=2024',str(self.root/'server2/src/main.rs'),'-o',str(binary)],capture_output=True,text=True,timeout=20)
            self.assertEqual(0,built.returncode,built.stderr)
            ran=subprocess.run([str(binary)],cwd=self.root/'server2',capture_output=True,text=True,timeout=5)
            self.assertEqual(0,ran.returncode,ran.stderr)
            self.assertEqual(expected,ran.stdout.strip())
            print('compiled fixture -> '+ran.stdout.strip())
        finally:
            if binary.exists():binary.unlink()
    def test_char_escape_sequences_cannot_hide_resources(self):
        self.compiler_fixture_assets()
        chars = [r"'\x00'", r"'\x22'", r"'\x41'", r"'\x7f'", r"'\u{41}'",
                 r"'\u{0_0_4_1_}'", r"'\u{1F600}'", r"'\u{10ffff}'", r"'\n'",
                 r"'\r'", r"'\t'", r"'\0'", r"'\\'", r"'\''", r"'\"'", "'é'", "'😀'",
                 r"b'\x41'", r"b'\xff'", r"b'\n'", r"b'\\'", r"b'\''", r"b'\"'"]
        forms = ['fn main(){let x=include_str!("../../client/data.txt");println!("{}",x);}',
                 '#[cfg_attr(all(), path="../../client/module.rs")] mod m; fn main(){println!("{}",m::outside());}',
                 'fn main(){let x=std::fs::read_to_string("../client/data.txt").unwrap();println!("{}",x);}']
        for char in chars:
            prefix='const A:['+('u8' if char.startswith('b') else 'char')+';2]=['+char+','+('b' if char.startswith('b') else '')+'\'"\'];'
            for form in forms:
                with self.subTest(char=char,form=form):
                    source=prefix+form+'''const Q:char='"';'''
                    self.compile_fixture(source);self.assertTrue(self.errors(),source)
        owned=r'''const A:[char;2]=['\u{0_0_4_1_}','"'];
fn identity<'é>(value:&'é str)->&'é str { 'label: loop { break 'label value; } }
fn main(){println!("{}",identity(include_str!("../config/owned.txt")));}'''
        self.compile_fixture(owned,'owned');self.assertEqual([],self.errors())
        raw_lifetime='fn identity<\'r#life>(v:&\'r#life str)->&\'r#life str{v} fn main(){println!("{}",identity(include_str!("../config/owned.txt")));}'
        self.compile_fixture(raw_lifetime,'owned');self.assertEqual([],self.errors())
    def test_unclassifiable_apostrophes_fail_incomplete(self):
        for char in [r"'\x4'", r"'\q'", r"'\u{_41}'", r"'\u{D800}'", r"'\u{110000}'", r"'\u{1234567}'", "'ab'", "'", r"b'\u{41}'"]:
            self.write('server2/src/main.rs','const A='+char+';fn main(){}')
            self.assertTrue(any('incomplete Rust literal' in error for error in self.errors()),char)
    def test_compiler_macro_delimiters_and_comment_separators(self):
        self.compiler_fixture_assets()
        for name in ['include_str','include_bytes','include']:
            for left,right in [('(',')'),('[',']'),('{','}')]:
                for comments in [False,True]:
                    with self.subTest(name=name,left=left,comments=comments):
                        prefix=name+(' /* name separator */ ! /* argument separator */ ' if comments else '!')
                        path='../../client/module.rs' if name=='include' else '../../client/data.txt'
                        expression=prefix+left+'"'+path+'"'+right
                        if name=='include':source=expression+('' if left=='{' else ';')+' fn main(){println!("{}",outside());}'
                        elif name=='include_bytes':source='fn main(){println!("{}",String::from_utf8_lossy('+expression+'));}'
                        else:source='fn main(){println!("{}",'+expression+');}'
                        self.compile_fixture(source);self.assertTrue(self.errors(),source)
    def test_nested_path_attributes_and_owned_compiler_controls(self):
        self.compiler_fixture_assets()
        for attr in ['#[path="../../client/module.rs"]',
                     '#[cfg_attr(all(), path="../../client/module.rs")]',
                     '#[cfg_attr(all(), cfg_attr(all(), path /* separator */ = "../../client/module.rs"))]']:
            with self.subTest(attr=attr):
                self.compile_fixture(attr+' mod outside; fn main(){println!("{}",outside::outside());}')
                self.assertTrue(self.errors(),attr)
        for left,right in [('(',')'),('[',']'),('{','}')]:
            source='fn main(){println!("{}",include_str /* gap */ ! '+left+'r#"../config/owned.txt"#'+right+');}'
            self.compile_fixture(source,'owned');self.assertEqual([],self.errors(),source)
        source='#[cfg_attr(all(), cfg_attr(all(), path="../config/module.rs"))] mod owned; fn main(){println!("{}",owned::outside());}'
        self.compile_fixture(source,'owned');self.assertEqual([],self.errors())
    def test_path_constructor_and_command_legacy_guard_regressions(self):
        self.compiler_fixture_assets()
        for expression in ['std::path::Path::new("../client/data.txt")',
                           'std::path::PathBuf::from(r#"../client/data.txt"#)']:
            with self.subTest(expression=expression):
                source='fn main(){println!("{}",std::fs::read_to_string('+expression+').unwrap());}'
                self.compile_fixture(source);self.assertTrue(self.errors(),source)
        source='fn main(){let out=std::process::Command::new("cat").arg("../server/config.js").output().unwrap();println!("{}",String::from_utf8_lossy(&out.stdout));}'
        with self.subTest(command=True):
            self.compile_fixture(source);self.assertTrue(self.errors(),source)
        self.write('server2/src/main.rs','fn main(){let _=std::path::Path::new("config/owned.txt");}')
        self.assertEqual([],self.errors())
    def test_inert_compiler_syntax_and_comments_are_not_resource_invocations(self):
        self.write('server2/src/lib.rs', '// include_str!("../../client/x");\nconst S: &str = r#"include_str!{unknown} cfg_attr(path=unknown)"#;')
        self.assertEqual([],self.errors())
    def test_extensionless_executable_shebang_and_shell_extensions(self):
        for path,body,executable in [('server2/deploy/start','#!/bin/sh\ncat ../server/config.js',False),
                                     ('server2/deploy/run','cat ../server/config.js',True),
                                     ('server2/deploy/start.bash','cat ../server/config.js',False),
                                     ('server2/deploy/start.zsh','cat ../server/config.js',False)]:
            with self.subTest(path=path):
                self.write(path,body)
                if executable:(self.root/path).chmod(0o755);self.git('add',path)
                self.assertTrue(self.errors());(self.root/path).unlink()
                if executable:self.git('reset','-q','--',path)

    def test_valid_task_declaration_identity_is_not_a_runtime_resource(self):
        path='server2/config/tasks/S02.json'
        self.write(path,json.dumps(self.d));self.assertEqual([],self.errors())
        for bad in [dict(self.d,outside=[dict(path='server/',category='legacy-oracle',reason='blanket')]),
                    dict(self.d,outside=[dict(path='server/config/config.js',category='legacy-oracle',reason='not named')])]:
            self.write(path,json.dumps(bad));self.assertTrue(self.errors())
        self.write(path,json.dumps(dict(self.d,runtime_source='../server/config/config.js')))
        self.assertTrue(self.errors())
    def test_extra_workflow_action_and_missing_timeout_rejected(self):
        self.d['outside'].append(dict(path='.github/workflows/server2.yml',category='ci-wiring',reason='shared CI'))
        good='timeout-minutes: 30\nworking-directory: server2\nsteps:\n  - uses: actions/checkout@v4\n    with:\n      fetch-depth: 0\n  - run: bash tools/ci.sh\n'
        self.write('.github/workflows/server2.yml',good+'  - uses: third-party/side-effect@main\n')
        self.assertTrue(self.errors())
        self.write('.github/workflows/server2.yml',good.replace('timeout-minutes: 30\n',''))
        self.assertTrue(self.errors())

    def golden_fixture(self):
        return {'schema':1,'source':{'files':{'server/routes/gateway.js':'a'*64}},
                'cases':[{'id':'gateway','kind':'wire','handler':'server/routes/gateway.js','status':200,'headers':[], 'body_base64':'','body_sha256':'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'}]}
    def test_golden_handler_provenance_is_inert_identity(self):
        self.write('server2/tests/golden/records.json',json.dumps(self.golden_fixture()))
        self.assertEqual([],self.errors())
    def test_golden_role_does_not_authorize_runtime_or_unknown_handler(self):
        for mutate in [lambda d:d.update(runtime_source='../server/config/config.js'),
                       lambda d:d['cases'][0].update(handler='server/config/config.js'),
                       lambda d:d.update(schema=2),
                       lambda d:d['cases'][0].update(handler=['server/routes/gateway.js']),
                       lambda d:d['source'].update(files={})]:
            d=self.golden_fixture();mutate(d);self.write('server2/tests/golden/records.json',json.dumps(d));self.assertTrue(self.errors())
    def golden_workflow(self):
        return """name: Server2
on:
  pull_request:
    paths:
      - \"server2/**\"
      - \".github/workflows/server2.yml\"
permissions:
  contents: read
jobs:
  foundation:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    defaults:
      run:
        working-directory: server2
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - run: bash tools/ci.sh
  goldens:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    defaults:
      run:
        working-directory: server2
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: '16.20.2'
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - run: python tools/golden/ci.py --install
"""
    def test_exact_golden_job_preserves_foundation(self):
        self.d['outside'].append(dict(path='.github/workflows/server2.yml',category='ci-wiring',reason='shared CI'))
        self.write('.github/workflows/server2.yml',self.golden_workflow());self.assertEqual([],self.errors())
    def test_golden_job_rejects_unknown_action_env_or_changed_foundation(self):
        self.d['outside'].append(dict(path='.github/workflows/server2.yml',category='ci-wiring',reason='shared CI'))
        good=self.golden_workflow()
        for bad in [good.replace('actions/setup-node@v4','third-party/deploy@main'),
                    good.replace('bash tools/ci.sh','echo skip'),
                    good.replace("node-version: '16.20.2'","node-version: '20'"),
                    good.replace("python-version: '3.11'","python-version: '3.9'"),
                    good+"      - run: upload-secret\n",good+"    env:\n      TOKEN: ${{ secrets.TOKEN }}\n",
                    good.replace('timeout-minutes: 30','timeout-minutes: 300')]:
            self.write('.github/workflows/server2.yml',bad);self.assertTrue(self.errors())


    def host_policy(self):
        roles=[('Path::new','/opt/server2-s09','private-owned-manifest'),
               ('Path::new','/opt/server2-s09/run','private-owned-manifest'),
               ('read_to_string','/proc/self/status','read-only-system'),
               ('read_to_string','/proc/self/stat','read-only-system')]
        return dict(task='S09',issue='https://github.com/WizardFactory/TodayWeather/issues/2694',
                    server2_paths=['server2/tools/benchmark/aws.rs'],outside=[],
                    runtime_host_reads=[dict(source='server2/tools/benchmark/aws.rs',operation=op,path=p,category=c,reason='Fixed privately owned host or process-only read') for op,p,c in roles])
    def write_host_policy(self, policy=None):
        self.write('server2/config/tasks/S09.json',json.dumps(policy or self.host_policy()))
    def test_exact_host_read_roles_and_later_task_audit(self):
        self.write_host_policy()
        self.write('server2/tools/benchmark/aws.rs','fn main(){ let _=Path::new("/opt/server2-s09");let _=Path::new("/opt/server2-s09/run");let _=std::fs::read_to_string("/proc/self/status");let _=std::fs::read_to_string("/proc/self/stat");}')
        self.assertEqual([],self.errors())
        self.commit();self.base=self.git('rev-parse','HEAD').strip()
        self.write('server2/src/lib.rs','pub fn later_task(){}')
        self.assertEqual([],self.errors(),'unchanged S09 approved reads remain audited for later task')
    def test_host_roles_do_not_allow_other_operations_or_sources(self):
        self.write_host_policy()
        for body in ['std::fs::read("/proc/self/status");','std::fs::File::open("/proc/self/stat");',
                     'std::fs::File::create("/opt/server2-s09");','PathBuf::from("/opt/server2-s09");',
                     'Path::new("/proc/self/status");']:
            self.write('server2/tools/benchmark/aws.rs',body);self.assertTrue(self.errors(),body)
        self.write('server2/tools/benchmark/aws.rs','fn valid(){}')
        self.write('server2/src/lib.rs','std::fs::read_to_string("/proc/self/status");')
        self.assertTrue(self.errors())
    def test_host_roles_do_not_allow_encoded_compiler_or_changed_paths(self):
        self.write_host_policy()
        for body in [r'std::fs::read_to_string("\x2fproc/self/status");',
                     'include_str!("/proc/self/status");',
                     '#[path="/opt/server2-s09"] mod host;',
                     'std::fs::read_to_string("/proc/self/../status");',
                     'std::fs::read_to_string("/proc/self/other");',
                     'Path::new("/opt/server2-s09/run-other");']:
            self.write('server2/tools/benchmark/aws.rs',body);self.assertTrue(self.errors(),body)
    def test_host_policy_records_cannot_widen_reviewed_allowlist(self):
        good=self.host_policy()
        for field,value in [('source','server2/src/lib.rs'),('operation','open'),('path','/proc/self/*'),('category','documentation'),('reason','')]:
            bad=json.loads(json.dumps(good));bad['runtime_host_reads'][0][field]=value
            self.write_host_policy(bad);self.assertTrue(self.errors(),field)
        for mutate in ['unknown','duplicate','missing','nonlist','nonrecord','missingfield','wrongtask','wrongissue']:
            bad=json.loads(json.dumps(good))
            if mutate=='unknown':bad['runtime_host_reads'][0]['extra']='allow'
            elif mutate=='duplicate':bad['runtime_host_reads'][0]=bad['runtime_host_reads'][1]
            elif mutate=='missing':bad['runtime_host_reads'].pop()
            elif mutate=='nonlist':bad['runtime_host_reads']={}
            elif mutate=='nonrecord':bad['runtime_host_reads'][0]='bad'
            elif mutate=='missingfield':bad['runtime_host_reads'][0].pop('operation')
            elif mutate=='wrongtask':bad['task']='S10'
            else:bad['issue']='#wrong'
            self.write_host_policy(bad);self.assertTrue(self.errors(),mutate)
    def test_active_declaration_cannot_self_grant_host_reads(self):
        self.d['runtime_host_reads']=self.host_policy()['runtime_host_reads']
        self.assertTrue(self.errors())
    def test_host_rules_absent_are_not_implicitly_granted(self):
        self.write('server2/tools/benchmark/aws.rs','std::fs::read_to_string("/proc/self/status");')
        self.assertTrue(self.errors())
    def test_malformed_canonical_host_policy_fails_later_audit(self):
        self.write('server2/config/tasks/S09.json','{broken')
        self.assertTrue(self.errors())
        self.write_host_policy();self.commit();self.base=self.git('rev-parse','HEAD').strip()
        bad=self.host_policy();bad['runtime_host_reads'][0]['path']='/opt/server2-s09/*'
        self.write_host_policy(bad);self.commit();self.base=self.git('rev-parse','HEAD').strip()
        self.assertTrue(self.errors())

if __name__ == '__main__': unittest.main()
