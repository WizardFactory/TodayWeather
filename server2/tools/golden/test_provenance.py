"""Owned synthetic sources and strict/property controls; never execute legacy handlers."""
from copy import deepcopy
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import provenance as p

ROOT = Path(__file__).resolve().parents[3]
REGISTRY = json.loads((ROOT/'server2/config/golden-provenance.json').read_text())
READER = ROOT.joinpath(*p.READER_PARTS).read_bytes()
DECLARATION = json.loads((ROOT/'server2/config/tasks/PROV2819.json').read_text())
NODE = shutil.which('node')


class Formats(unittest.TestCase):
    def test_explicit_registry_has_exact_current_coverage(self):
        registry = p.validate_registry(deepcopy(REGISTRY), DECLARATION)
        self.assertEqual(sum(len(f['maps']) for f in registry['fixtures']), 23)
        self.assertEqual(sum(len(m['paths']) for f in registry['fixtures'] for m in f['maps']), 1141)

    def test_registry_schema_and_coverage_mutations_fail_closed(self):
        for mutate in (lambda r:r.update(schema=True), lambda r:r.update(schema=2), lambda r:r.update(unknown=True),
                       lambda r:r['fixtures'].pop(), lambda r:r['fixtures'][0].update(path='server2/tests/unknown.json'),
                       lambda r:r['fixtures'][0].update(sha256='not-sha'),
                       lambda r:r['fixtures'][0]['maps'][0].update(pointer='/guess'),
                       lambda r:r['fixtures'][0]['maps'].append(r['fixtures'][0]['maps'][0]),
                       lambda r:r['fixtures'][0]['maps'].__setitem__(0,'unknown-map-type'),
                       lambda r:r['legacy_sources'].append(r['legacy_sources'][0]),
                       lambda r:r['legacy_sources'].__setitem__(0,'../../private'),
                       lambda r:r['fixtures'][0]['maps'][0]['paths'].append('server/private-key.json')):
            registry = deepcopy(REGISTRY)
            mutate(registry)
            with self.subTest(registry=registry.get('schema')):
                with self.assertRaises(ValueError):
                    p.validate_registry(registry, DECLARATION)

    def test_verification_export_set_cannot_widen_or_omit(self):
        for mutate in (lambda r:r['verification_exports'].pop(),
                       lambda r:r['verification_exports'].append(r['verification_exports'][0]),
                       lambda r:r['verification_exports'].reverse(),
                       lambda r:r['verification_exports'].append('server/private.js'),
                       lambda r:r['verification_exports'].append(r['legacy_sources'][0])):
            registry = deepcopy(REGISTRY); mutate(registry)
            with self.assertRaises(ValueError): p.validate_registry(registry, DECLARATION)
        declaration = deepcopy(DECLARATION)
        path = REGISTRY['verification_exports'][0]
        declaration['outside'] = [x for x in declaration['outside'] if x.get('path') != path]
        with self.assertRaises(ValueError): p.validate_registry(deepcopy(REGISTRY), declaration)

    def test_duplicate_keys_rejected_at_every_json_level(self):
        for raw in ('{"a":1,"a":2}', '{"outer":{"a":1,"a":2}}'):
            with self.assertRaisesRegex(ValueError, 'duplicate JSON key'):
                p.load_json(raw)

    def test_digest_property_controls(self):
        for character in '0123456789abcdef':
            self.assertTrue(p.is_digest(character*64))
        for value in ('F'*64,'0'*63,'0'*65,'g'*64,None,True,42):
            self.assertFalse(p.is_digest(value))


@unittest.skipUnless(NODE, 'installed Node required; not a passed reader check')
class OwnedCorpus(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.registry = deepcopy(REGISTRY)
        self.declaration = deepcopy(DECLARATION)
        # Files deliberately are not executable/evaluable modules: reader hashes only.
        source = b"throw Error('legacy source must never execute');\n"
        self.hash = hashlib.sha256(source).hexdigest()
        for name in self.registry['legacy_sources'] + self.registry['verification_exports']:
            self.write(name, source)
        self.write('/'.join(p.READER_PARTS), READER)
        self.write('.gitignore', b'reports/\n')
        for fixture in self.registry['fixtures']:
            document = {}
            for entry in fixture['maps']:
                node = document
                parts = entry['pointer'].split('/')[1:]
                for part in parts[:-1]:
                    node = node.setdefault(part,{})
                node[parts[-1]] = dict.fromkeys(entry['paths'], self.hash)
            self.fixture(fixture, document)
            self.write(fixture['provenance'], b'Owned synthetic provenance, not actual replay.\n')
        for name in self.registry['other_test_json']:
            self.write(name, b'{}')
        self.git('init','-q','--template=')
        self.git('config','user.name','Offline provenance fixture')
        self.git('config','user.email','offline@example.invalid')
        self.git('config','core.hooksPath',str(self.root/'empty-hooks'))
        self.git('add','.')
        self.git('commit','-qm','owned synthetic inputs')

    def git(self,*args):
        return subprocess.check_output(['git','-C',str(self.root),*args],stderr=subprocess.PIPE)

    def write(self,name,body):
        target=self.root/name
        target.parent.mkdir(parents=True,exist_ok=True)
        target.write_bytes(body)

    def fixture(self,fixture,document):
        raw=json.dumps(document,sort_keys=True).encode()
        if fixture['compression']=='gzip':raw=gzip.compress(raw,mtime=0)
        self.write(fixture['path'],raw)
        fixture['sha256']=p.digest(raw)

    def audit(self):
        return p.audit(self.root,self.registry,self.declaration,NODE)

    def test_current_owned_sources_are_not_semantic_parity(self):
        report=self.audit()
        self.assertEqual(report['status'],'SOURCE_CURRENT')
        self.assertEqual(report['drifted_fixtures'],0)
        self.assertEqual(report['references'],1141)
        self.assertEqual(report['semantics'],'NOT_EVALUATED')

    def test_reader_has_narrow_environment_and_invalid_response_fails_closed(self):
        with patch.object(p,'bounded_child',wraps=p.bounded_child) as child:
            self.audit()
        self.assertEqual(child.call_args.args[1],{'PATH':os.defpath,'TZ':'UTC','LANG':'C'})
        for raw in (b'[]',b'{"schema":true}',b'{"schema":1,"node":"v1.2.3","files":{},"total_bytes":0}'):
            with patch.object(p,'bounded_child',return_value=raw):
                with self.assertRaisesRegex(ValueError,'fingerprint response schema|fingerprint map'):
                    self.audit()

    def test_one_changed_source_reports_every_affected_map_without_rewriting_fixture(self):
        before={f['path']:p.digest((self.root/f['path']).read_bytes()) for f in self.registry['fixtures']}
        name=self.registry['legacy_sources'][0]
        self.write(name,b'changed source bytes, no execution')
        report=self.audit()
        mismatches=[m for f in report['fixtures'] for entry in f['maps'] for m in entry['mismatches']]
        self.assertEqual(report['status'],'DRIFT')
        self.assertTrue(mismatches)
        self.assertEqual({m['path'] for m in mismatches},{name})
        self.assertTrue(all(m['recorded_sha256']==self.hash for m in mismatches))
        self.assertEqual(before,{f['path']:p.digest((self.root/f['path']).read_bytes()) for f in self.registry['fixtures']})

    def test_relocated_air_helpers_have_exact_air_only_hash_bindings(self):
        helpers = {
            'server/test/offline/oracle-provenance/air/air-fixtures.js',
            'server/test/offline/oracle-provenance/air/sections-air.js',
        }
        air_path = 'server2/tests/domestic/fixtures/air.json.gz'
        self.assertEqual(len(self.registry['legacy_sources']), 187)
        for helper in helpers:
            references = [f['path'] for f in self.registry['fixtures']
                          for m in f['maps'] if helper in m['paths']]
            self.assertEqual(references, [air_path])
            self.write(helper, b"throw Error('changed helper must only be hashed');\n")
        report = self.audit()
        changed = [f for f in report['fixtures'] if f['status'] == 'DRIFT']
        self.assertEqual([f['fixture'] for f in changed], [air_path])
        self.assertEqual({m['path'] for e in changed[0]['maps'] for m in e['mismatches']}, helpers)
        self.git('rm', '--cached', sorted(helpers)[0])
        self.assertEqual(self.audit()['status'], 'DRIFT')  # Declared helper stays hash-checked.

    def test_untracked_declared_export_is_hashed_and_drift_is_isolated(self):
        name = self.registry['verification_exports'][-1]
        self.git('rm','--cached',name)
        before = self.audit()
        self.assertEqual(before['status'],'SOURCE_CURRENT')
        self.assertEqual(len(before['legacy_sources']),187)
        self.assertEqual(set(before['verification_exports']),set(self.registry['verification_exports']))
        self.write(name,b'changed export bytes')
        after = self.audit()
        changed = {f['fixture'] for f in after['fixtures'] if f['status']=='DRIFT'}
        expected = {f['path'] for f in self.registry['fixtures'] if any(name in m['paths'] for m in f['maps'])}
        self.assertEqual(changed,expected)

    def test_export_symlink_directory_and_size_are_rejected(self):
        name = next(n for n in self.registry['verification_exports'] if '/core/' in n)
        target = self.root/name
        target.unlink(); target.symlink_to(self.root/'.gitignore')
        with self.assertRaisesRegex(ValueError,'symlink'): self.audit()
        target.unlink(); target.mkdir()
        with self.assertRaisesRegex(ValueError,'regular file'): self.audit()
        target.rmdir(); self.write(name,b'x'*(p.SOURCE_FILE_LIMIT+1))
        with self.assertRaisesRegex(ValueError,'input size limit'): self.audit()

    def test_reader_exports_have_one_hash_authority(self):
        with patch.object(p,'read_bounded',wraps=p.read_bounded) as bounded:
            report=self.audit()
        python_reads={str(call.args[0].resolve().relative_to(self.root.resolve())) for call in bounded.call_args_list}
        self.assertFalse(p.READER_EXPORTS & python_reads)
        self.assertTrue(all(report['verification_exports'][name]==self.hash for name in p.READER_EXPORTS))

    def test_export_aggregate_cap_is_separate_from_product_reader(self):
        for name in set(self.registry['verification_exports']) - p.READER_EXPORTS:
            self.write(name,b'x'*600000)
        with self.assertRaisesRegex(ValueError,'aggregate verification export size'):
            self.audit()

    def test_missing_source_rejected(self):
        (self.root/self.registry['legacy_sources'][0]).unlink()
        with self.assertRaisesRegex(ValueError,'fingerprint reader rejected input:.*ENOENT'):
            self.audit()

    def test_untracked_source_rejected_before_reader(self):
        self.git('rm','--cached',self.registry['legacy_sources'][0])
        with self.assertRaisesRegex(ValueError,'untracked legacy source'):
            self.audit()

    def test_source_leaf_symlink_rejected(self):
        source=self.root/self.registry['legacy_sources'][0]
        source.unlink();source.symlink_to(self.root/'.gitignore')
        with self.assertRaisesRegex(ValueError,'symlink source rejected'):
            self.audit()

    def test_source_ancestor_symlink_rejected(self):
        original=self.root/'server/controllers'
        original.rename(self.root/'relocated-controllers')
        original.symlink_to(self.root/'relocated-controllers',target_is_directory=True)
        with self.assertRaisesRegex(ValueError,'symlink source rejected'):
            self.audit()

    def test_reader_identity_and_declaration_cannot_widen(self):
        self.write('/'.join(p.READER_PARTS),READER+b'\n')
        with self.assertRaisesRegex(ValueError,'reader identity mismatch'):
            self.audit()
        next(x for x in self.declaration['outside'] if x['path']=='/'.join(p.READER_PARTS))['path']='server/private.js'
        with self.assertRaisesRegex(ValueError,'exact named fingerprint export'):
            self.audit()

    def test_other_named_towns_exports_never_widen_fingerprint_reader(self):
        self.declaration['outside'].extend([
            {'path':'server/test/offline/record-towns.js','category':'legacy-export'},
            {'path':'server/test/offline/towns-oracle-guard.js','category':'legacy-export'}])
        self.assertEqual(self.audit()['status'],'SOURCE_CURRENT')
        self.declaration['outside'].append(next(x for x in self.declaration['outside'] if x['path']=='/'.join(p.READER_PARTS)))
        with self.assertRaisesRegex(ValueError,'exact named fingerprint export'):
            self.audit()

    def test_source_file_and_aggregate_caps(self):
        name=self.registry['legacy_sources'][0]
        self.write(name,b'x'*(p.SOURCE_FILE_LIMIT+1))
        with self.assertRaisesRegex(ValueError,'source type/size rejected'):
            self.audit()
        # 189 bounded files can still exceed the independent aggregate cap.
        for name in self.registry['legacy_sources']:
            self.write(name,b'x'*100000)
        with self.assertRaisesRegex(ValueError,'source type/size rejected|aggregate source size'):
            self.audit()

    def test_unknown_fixture_does_not_silently_escape_registry(self):
        self.write('server2/tests/new-unknown.json',b'{}')
        with self.assertRaisesRegex(ValueError,'uncovered/missing test JSON fixture'):
            self.audit()

    def test_fixture_identity_and_missing_map_rejected(self):
        fixture=self.registry['fixtures'][0]
        self.write(fixture['path'],b'not the recorded fixture')
        with self.assertRaisesRegex(ValueError,'fixture identity mismatch'):
            p.fixture_document(self.root,fixture)
        self.fixture(fixture,{})
        with self.assertRaisesRegex(ValueError,'missing source map'):
            self.audit()

    def test_duplicate_and_bad_map_value_rejected(self):
        fixture=self.registry['fixtures'][0]
        raw=b'{"a":1,"a":2}'
        if fixture['compression']=='gzip':raw=gzip.compress(raw,mtime=0)
        self.write(fixture['path'],raw);fixture['sha256']=p.digest(raw)
        with self.assertRaisesRegex(ValueError,'duplicate JSON key'):
            p.fixture_document(self.root,fixture)
        entry=fixture['maps'][0];document={'source':{'files':dict.fromkeys(entry['paths'],'g'*64)}}
        self.fixture(fixture,document)
        with self.assertRaisesRegex(ValueError,'invalid source map'):
            self.audit()

    def test_compressed_and_inflated_caps(self):
        fixture=next(f for f in self.registry['fixtures'] if f['compression']=='gzip')
        self.write(fixture['path'],b'x'*(p.COMPRESSED_LIMIT+1))
        with self.assertRaisesRegex(ValueError,'input size limit exceeded'):
            p.fixture_document(self.root,fixture)
        raw=gzip.compress(b' '*(p.INFLATED_LIMIT+1),mtime=0)
        self.write(fixture['path'],raw);fixture['sha256']=p.digest(raw)
        with self.assertRaisesRegex(ValueError,'inflated fixture size limit exceeded'):
            p.fixture_document(self.root,fixture)

    def test_fixture_symlink_and_traversal_rejected(self):
        fixture=self.registry['fixtures'][0];path=self.root/fixture['path']
        path.unlink();path.symlink_to(self.root/'.gitignore')
        with self.assertRaisesRegex(ValueError,'symlink rejected'):
            p.fixture_document(self.root,fixture)
        with self.assertRaisesRegex(ValueError,'canonical relative path'):
            p.regular(self.root,'../private')

    def test_child_deadline_and_output_caps(self):
        env={'PATH':os.defpath}
        with patch.object(p,'DEADLINE',0.05):
            with self.assertRaisesRegex(ValueError,'deadline exceeded'):
                p.bounded_child([NODE,'-e','setTimeout(()=>{},10000)'],env)
        with patch.object(p,'RESPONSE_LIMIT',100):
            with self.assertRaisesRegex(ValueError,'response size limit exceeded'):
                p.bounded_child([NODE,'-e','process.stdout.write("x".repeat(101))'],env)


if __name__=='__main__':
    unittest.main()
