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

if __name__ == '__main__': unittest.main()
