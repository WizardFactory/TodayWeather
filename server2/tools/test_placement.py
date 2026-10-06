"""Synthetic Git fixture tests; no real repository mutations."""
import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
spec = importlib.util.spec_from_file_location('placement', Path(__file__).with_name('check_placement.py'))
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
        (self.root/'server2/static').symlink_to('../server');self.git('add','server2/static')
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
        self.write('.github/workflows/server2.yml','defaults:\n  run:\n    working-directory: server2\nsteps:\n  - run: bash tools/ci.sh\n');self.assertEqual([],self.errors())
        self.write('.github/workflows/server2.yml','working-directory: server2\nsteps:\n  - run: |\n      python3 -c "business logic"\n');self.assertTrue(self.errors())

if __name__ == '__main__': unittest.main()
